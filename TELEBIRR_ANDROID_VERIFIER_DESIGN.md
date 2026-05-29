# TeleBirr Android Verifier Bridge — Phase 1 MVP Design

## 1. Purpose

TeleBirr deposits currently land in the system as `status = 'pending'` and require a human admin to manually review the uploaded receipt screenshot, confirm the sender name and amount, then approve or reject via the admin dashboard. This is slow and does not scale.

The **TeleBirr Android Verifier Bridge** is a dedicated Android application that runs on a phone inside Ethiopia. It polls the QHash backend for pending TeleBirr deposits, fetches each deposit's official TeleBirr receipt via the receipt URL, extracts structured data (transaction ID, amount, receiver full name), and reports verification results back to the QHash backend via two REST endpoints. The backend then decides whether to auto-approve, auto-reject, or flag for manual review.

The Android app is an **observer and reporter only**. It never credits wallets, never changes deposit statuses, and never touches financial state. All approval authority stays on the backend.

---

## 2. Core Principle: Backend Is the Approval Authority

| Responsibility | Android App | Backend |
|---|---|---|
| Poll for pending TeleBirr deposits | Yes | No |
| Fetch official TeleBirr receipt URL | Yes | No |
| Extract transaction ID + amount + receiver name from receipt | Yes | No |
| Report structured result to backend | Yes | No |
| Match result to a pending deposit | No | Yes |
| Decide approve / reject / manual-review | No | Yes |
| Credit wallet | No | Yes |
| Create transactions | No | Yes |
| Create user notifications | No | Yes |

The Android app has **zero write access** to any financial table. It only calls two endpoints (GET + POST), both authenticated with a static API key.

---

## 3. Android Must Never Credit Wallets

This is a hard architectural constraint, not a soft guideline:

- The Android app has no Supabase credentials, no service-role key, and no direct database access.
- The API key (`TELEBIRR_VERIFIER_API_KEY`) grants access to exactly two endpoints. Neither endpoint exposes wallet or transaction mutations.
- Even if the Android device is compromised, the attacker can only submit verification reports. The backend validates every report against its own pending-deposit records before taking any action.
- Wallet crediting happens exclusively inside the existing `approve_deposit_tx` RPC, called only by backend code running with the Supabase service-role key.

---

## 4. Receipt-Link Verification Flow

### How It Works

1. **User creates a TeleBirr deposit** on QHash. The backend stores the deposit as `status = 'pending'` with a `receipt_url` pointing to the official TeleBirr receipt page.
2. **Android polls the backend** via `GET /api/verifier/pending-telebirr-deposits` to retrieve pending deposits and their receipt URLs.
3. **Android fetches the official TeleBirr receipt** at `https://transactioninfo.ethiotelecom.et/receipt/{TRANSACTION_ID}` from inside Ethiopia (geo-restricted endpoint).
4. **Android extracts structured data** from the receipt page:
   - Transaction ID
   - Amount (ETB)
   - Receiver full name
5. **Android submits the verification result** via `POST /api/verifier/submit-verification` with the extracted data.
6. **Backend validates and decides**: auto-approve, flag for manual review, or auto-reject based on rule matching (Section 7).

The receipt URL is the single source of truth. The Android app must be physically located in Ethiopia because the TeleBirr receipt endpoint (`transactioninfo.ethiotelecom.et`) is geo-restricted to Ethiopian IP addresses.

---

## 5. GET Pending TeleBirr Deposits Endpoint

### `GET /api/verifier/pending-telebirr-deposits`

Returns all deposits that are:
- `status = 'pending'`
- Linked to a `payment_methods` row where `type = 'telebirr'`
- Not yet verified by the Android bridge (i.e., no verification result recorded)

**Authentication**: `X-Verifier-Api-Key` header must match `TELEBIRR_VERIFIER_API_KEY` env var.

**Response shape**:

```json
{
  "deposits": [
    {
      "id": "uuid",
      "amount": 500.00,
      "transaction_reference": "FT24XXXXXXXXX",
      "receipt_url": "https://transactioninfo.ethiotelecom.et/receipt/FT24XXXXXXXXX",
      "receiver_name": "Abebe Kebede",
      "created_at": "2026-05-20T10:00:00Z"
    }
  ]
}
```

**Field notes**:
- `receiver_name` is sourced from `payment_methods.account_name` (the QHash platform receiver's full name that should appear on the TeleBirr receipt).
- `receipt_url` is the official TeleBirr receipt link. The Android app **must** fetch this URL to perform verification.
- `amount` is the user-declared deposit amount from the `deposits.amount` column.

**Query logic (pseudocode)**:

```sql
SELECT d.id, d.amount, d.transaction_reference, d.receipt_url,
       pm.account_name AS receiver_name, d.created_at
  FROM deposits d
  JOIN payment_methods pm ON d.payment_method_id = pm.id
 WHERE d.status = 'pending'
   AND pm.type = 'telebirr'
   AND d.auto_verified = false
 ORDER BY d.created_at ASC
 LIMIT 50;
```

**Rate limiting**: Max 1 request per 10 seconds from the verifier. Enforce via a simple in-memory timestamp check in the function.

---

## 6. POST Verification Result Endpoint

### `POST /api/verifier/submit-verification`

The Android app calls this after it fetches a TeleBirr receipt and extracts the relevant data.

**Authentication**: Same `X-Verifier-Api-Key` header.

**Request body**:

```json
{
  "deposit_id": "uuid",
  "verified": true,
  "extracted_receiver_name": "Abebe Kebede",
  "extracted_amount": 500.00,
  "extracted_transaction_id": "FT24XXXXXXXXX",
  "confidence": "high",
  "receipt_fetch_status": "success",
  "verified_at": "2026-05-20T10:05:00Z"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `deposit_id` | UUID | Yes | The deposit being verified |
| `verified` | boolean | Yes | `true` = receipt data matches pending deposit, `false` = mismatch or receipt not found |
| `extracted_receiver_name` | string | No | Receiver full name parsed from TeleBirr receipt page |
| `extracted_amount` | number | No | Amount parsed from TeleBirr receipt page |
| `extracted_transaction_id` | string | No | Transaction ID parsed from TeleBirr receipt page |
| `confidence` | enum | Yes | `"high"`, `"medium"`, or `"low"` |
| `receipt_fetch_status` | string | Yes | `"success"`, `"not_found"`, `"geo_blocked"`, `"timeout"`, or `"parse_error"` |
| `verified_at` | ISO timestamp | Yes | When the Android app fetched and parsed the receipt |

**Response**:

```json
{
  "success": true,
  "action_taken": "approved" | "flagged_for_review" | "rejected" | "no_action",
  "message": "Deposit auto-approved."
}
```

---

## 7. API Key Authentication

Both endpoints use a single shared secret: `TELEBIRR_VERIFIER_API_KEY`, stored as a Netlify environment variable.

**Auth check (both endpoints)**:

```
Header: X-Verifier-Api-Key: <key>
```

- If the header is missing or does not match, return `401 Unauthorized`.
- Use constant-time string comparison to prevent timing attacks.
- The key is a 64-character random hex string generated once and configured on both the server and the Android device.

**Why not OAuth/JWT?** This is a single trusted device talking to two endpoints. API key auth is simpler, sufficient, and avoids token refresh complexity. If multiple verifier devices are needed in the future, rotate to per-device keys or mTLS.

---

## 8. Verification Rules

When the backend receives a POST verification result, it applies the following rule chain:

### Auto-Approve (all must be true):
1. `verified = true`
2. `confidence = "high"`
3. `receipt_fetch_status = "success"`
4. `extracted_amount` matches `deposits.amount` exactly
5. `extracted_transaction_id` matches `deposits.transaction_reference` (case-insensitive)
6. `extracted_receiver_name` matches `payment_methods.account_name` (fuzzy match — case-insensitive, trimmed)
7. Deposit is still `status = 'pending'`
8. Deposit age is less than 24 hours

### Flag for Manual Review (any one triggers):
1. `verified = true` but `confidence = "medium"`
2. `extracted_amount` differs from `deposits.amount` by more than 0 but less than 10%
3. `extracted_transaction_id` does not match but `extracted_amount` + receiver name are close
4. `extracted_receiver_name` does not match `payment_methods.account_name` but amount + transaction ID match
5. `receipt_fetch_status` is `"parse_error"` (receipt loaded but data extraction was unreliable)
6. Deposit age is between 24 and 72 hours

### Auto-Reject:
1. `verified = false` and `confidence = "high"` and `receipt_fetch_status = "not_found"` (the receipt URL returned no valid transaction)
2. Deposit age exceeds 72 hours with no positive verification

### No Action (return `no_action`):
1. Deposit has already been approved/rejected by an admin
2. Deposit ID not found
3. `confidence = "low"` (not enough data to decide — wait for retry or manual review)
4. `receipt_fetch_status` is `"geo_blocked"` or `"timeout"` (transient failure — will retry on next poll)

---

## 9. Approval Flow

When auto-approve rules pass:

```
Android POST /submit-verification (verified=true, high confidence, receipt data matches)
  |
  v
Backend validates rules (Section 8)
  |
  v  (all auto-approve rules pass)
Backend calls approve_deposit_tx RPC:
  - p_deposit_id = deposit.id
  - p_admin_id   = system admin UUID (a dedicated "verifier-bot" profile)
  - p_action     = 'approve'
  - p_admin_note = 'Auto-approved by TeleBirr verifier bridge (receipt verified)'
  - p_amount     = extracted_amount (receipt-verified amount; p_amount > 0 is required for approve)
  |
  v
approve_deposit_tx atomically:
  - Sets deposit status to 'approved'
  - Sets reviewed_at timestamp
  - Credits user wallet
  - Creates transaction record
  (Note: No reviewed_by column — see DEPOSIT_SAFETY_CHECKPOINT.md rule 13)
  |
  v
Backend creates notification:
  - user_id: deposit owner
  - title: "Deposit Approved"
  - message: "Your deposit of X ETB has been approved..."
  - metadata: { type: "deposit_approved", deposit_id, auto_verified: true }
  |
  v
Backend sets deposits.auto_verified = true, deposits.verification_note = summary
  |
  v
Returns { action_taken: "approved" } to Android
```

A dedicated `verifier-bot` profile row must be created in the `profiles` table with `is_admin = true`. This profile's UUID is used as `p_admin_id` so the RPC's admin checks pass. The bot profile should have a recognizable name (e.g., `username: "telebirr-verifier-bot"`) so admin dashboards can distinguish automated approvals from human ones.

---

## 10. Failure and Manual-Review Flow

### Flagged for Manual Review

```
Backend determines manual review is needed (Section 8 rules)
  |
  v
Backend updates deposit:
  - verification_note = "Flagged: receiver name mismatch (expected 'Abebe Kebede', got 'Abebe K.')"
  - auto_verified remains false
  - status remains 'pending' (admin must act)
  |
  v
Backend creates admin notification:
  - user_id: each admin profile (or a known admin channel)
  - title: "Deposit Needs Review"
  - message: "TeleBirr verifier flagged deposit <ref> for manual review: <reason>"
  - metadata: { type: "admin_review_required", deposit_id, reason, extracted_data }
  |
  v
Returns { action_taken: "flagged_for_review" } to Android
```

The admin then reviews normally via the existing admin dashboard and calls `POST /api/admin/approve-deposit`.

### Auto-Reject

```
Backend determines auto-reject (Section 8 rules)
  |
  v
Backend calls approve_deposit_tx with p_action = 'reject':
  - p_admin_note = 'Auto-rejected: TeleBirr receipt not found after 72h'
  |
  v
Backend creates user notification:
  - metadata: { type: "deposit_rejected", deposit_id, auto_verified: true, reason }
  |
  v
Returns { action_taken: "rejected" } to Android
```

### Android App Offline / Errors

If the Android app crashes, loses network, or the phone is turned off:
- Pending deposits simply remain pending. The existing manual admin review process is the fallback.
- The GET endpoint will continue to return unverified deposits when the app comes back online.
- No timeout auto-rejects should fire during known downtime windows. Consider an `app_settings` key (`verifier_active = true/false`) that the admin can toggle to pause auto-reject timers.

### Receipt Fetch Failures

If the Android app cannot fetch a receipt URL (geo-blocked, timeout, server error):
- It reports `receipt_fetch_status` with the appropriate error code.
- The backend takes no action on transient failures and waits for the next poll cycle.
- Persistent fetch failures (e.g., `geo_blocked` on every attempt) should trigger an admin alert after 3 consecutive failures for the same deposit.

---

## 11. Logging

All verifier activity must be logged to Netlify Functions console output in structured JSON format, consistent with existing function logging patterns.

### Log events for GET endpoint:
```json
{ "fn": "verifier-pending-deposits", "step": "request", "ts": "...", "count": 12 }
{ "fn": "verifier-pending-deposits", "step": "auth_failed", "ts": "..." }
```

### Log events for POST endpoint:
```json
{ "fn": "verifier-submit", "step": "received", "ts": "...", "deposit_id": "...", "verified": true, "confidence": "high", "receipt_status": "success" }
{ "fn": "verifier-submit", "step": "rule_check", "ts": "...", "deposit_id": "...", "result": "auto_approve" }
{ "fn": "verifier-submit", "step": "rpc_called", "ts": "...", "deposit_id": "...", "action": "approve" }
{ "fn": "verifier-submit", "step": "rpc_success", "ts": "...", "deposit_id": "...", "balance_after": 1500 }
{ "fn": "verifier-submit", "step": "rpc_error", "ts": "...", "deposit_id": "...", "error": "..." }
{ "fn": "verifier-submit", "step": "flagged", "ts": "...", "deposit_id": "...", "reason": "receiver_name_mismatch" }
{ "fn": "verifier-submit", "step": "receipt_fetch_failed", "ts": "...", "deposit_id": "...", "status": "geo_blocked" }
{ "fn": "verifier-submit", "step": "notification_created", "ts": "...", "deposit_id": "..." }
```

**Sensitive data rules**:
- Never log full receipt page content.
- Never log the API key.
- Log deposit IDs, amounts, receipt fetch status, and action outcomes.

---

## 12. Security Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **API key leaked** | Attacker can submit fake verifications | Rotate key immediately. Key only grants report-submission access, never wallet credit. Backend still validates all rules. |
| **Replay attack** | Same verification submitted twice | Backend checks deposit status before acting. If already approved/rejected, returns `no_action`. Idempotent by design. |
| **Android device stolen** | Key extracted from device | Key stored in Android Keystore (hardware-backed). Remote wipe capability. Immediate key rotation on loss. |
| **Fake verification (verified=true)** | Fraudulent deposit approved | Backend cross-checks `extracted_amount`, `extracted_transaction_id`, and `extracted_receiver_name`. A high-confidence fake still needs all three fields to match a real pending deposit. |
| **Man-in-the-middle** | Intercepted/tampered requests | All traffic over HTTPS. API key in header, not URL. Consider certificate pinning in Android app for both QHash API and TeleBirr receipt endpoints. |
| **Denial of service** | Flood of fake requests | Rate limit both endpoints. API key required. Block key after N auth failures per minute. |
| **Receipt URL spoofing** | Attacker serves fake receipt page | Android must validate TLS certificate for `transactioninfo.ethiotelecom.et`. Use certificate pinning. Only accept responses from the exact expected domain. |
| **Bot profile compromise** | Attacker with bot UUID could call approve RPC | Bot profile UUID is only used server-side. The verifier endpoints never expose it. RPC requires service-role key which the Android app never has. |
| **Geo-restriction bypass** | Receipt fetched from outside Ethiopia returns different content | Android must run on a device physically in Ethiopia. Backend can optionally require the Android app to report its IP for cross-validation. |

---

## 13. Android App Responsibilities

The Android app is a lightweight background service with these duties:

### Must Do:
1. **Poll for pending deposits** — Call `GET /api/verifier/pending-telebirr-deposits` on a configurable interval (default: every 30 seconds).
2. **Fetch official TeleBirr receipts** — For each pending deposit, fetch the receipt page at `https://transactioninfo.ethiotelecom.et/receipt/{TRANSACTION_ID}` using the `receipt_url` from the pending deposit response.
3. **Parse receipt data** — Extract transaction ID, amount (ETB), and receiver full name from the TeleBirr receipt page using HTML parsing tuned to the known receipt page structure.
4. **Match and report** — Compare extracted receipt data against the pending deposit's expected values. Report the match (or non-match) via `POST /api/verifier/submit-verification`.
5. **Store API key securely** — Use Android Keystore. Never hardcode in APK.
6. **Handle offline gracefully** — Queue verification results locally if network is unavailable. Submit when connectivity returns. Deduplicate before sending.
7. **Self-monitor** — Send a heartbeat or health-check signal so the backend (or admin dashboard) can detect if the verifier is offline.
8. **Handle receipt page changes** — The TeleBirr receipt page structure may change. The parsing rules should be configurable or updatable without rebuilding the APK.
9. **Report fetch failures** — If a receipt URL returns an error, geo-block, or timeout, report the failure status so the backend can track reliability.

### Must NOT Do:
1. Never store Supabase credentials.
2. Never call any endpoint other than the two verifier endpoints.
3. Never attempt to modify deposit status directly.
4. Never display or store user personal data beyond what is needed for matching (flush parsed data after reporting).
5. Never update wallets, deposit statuses, or transaction records.

### Recommended Architecture:
- **Foreground service** with persistent notification (prevents Android from killing the background process).
- **WorkManager** for periodic polling with exponential backoff on failures.
- **Room database** for local queue of unsubmitted verification results.
- **Retrofit + OkHttp** for API calls with certificate pinning (both QHash API and `transactioninfo.ethiotelecom.et`).
- **Jsoup or similar HTML parser** for extracting structured data from the TeleBirr receipt page.
- Minimum SDK: Android 8.0 (API 26).

---

## 14. Future: Database Audit Table (Not in Phase 1)

In a future phase, a `verification_audit_log` table should be created to persist every verification attempt:

```sql
-- NOT for Phase 1 — design sketch only
CREATE TABLE verification_audit_log (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id             UUID NOT NULL REFERENCES deposits (id),
  verified               BOOLEAN NOT NULL,
  confidence             TEXT NOT NULL,
  extracted_receiver     TEXT,
  extracted_amount       NUMERIC(18, 2),
  extracted_txn_id       TEXT,
  receipt_fetch_status   TEXT NOT NULL,
  action_taken           TEXT NOT NULL,
  rule_details           JSONB NOT NULL DEFAULT '{}',
  verified_at            TIMESTAMPTZ NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

This enables:
- Full audit trail of every verification attempt per deposit.
- Analytics on verification accuracy and false-positive rates.
- Dispute resolution when a user claims their deposit was wrongly rejected.
- Monitoring verifier health (detection of receipt parsing failures over time).

**Phase 1 workaround**: Store verification metadata in the existing `deposits.verification_note` column as a JSON string or short summary. This is lossy (only the last result is stored) but sufficient for MVP.

---

## Summary

The TeleBirr Android Verifier Bridge is a receipt-link verification satellite. It polls the QHash backend for pending TeleBirr deposits, fetches each deposit's official receipt from `https://transactioninfo.ethiotelecom.et/receipt/{TRANSACTION_ID}` (which requires the device to be inside Ethiopia), extracts structured data (transaction ID, amount, receiver full name), and submits verification results to the backend. The backend owns all approval logic: it validates the extracted receipt data against its own records, calls the existing `approve_deposit_tx` RPC for approvals/rejections, and falls back to manual admin review for ambiguous cases. The Android app never touches wallets, transactions, or deposit statuses directly. Two new Netlify Function endpoints are required, both authenticated with a single rotatable API key. No database schema changes are needed for Phase 1.
