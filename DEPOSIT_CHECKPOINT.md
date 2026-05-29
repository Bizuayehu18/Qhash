# QHash Deposit System Checkpoint

> Captured: 2026-05-21
> Status: **Stable** — do not modify deposit logic or database schema without reviewing this document.

---

## 1. TeleBirr Is Manual-First

TeleBirr receipt URLs (`https://transactioninfo.ethiotelecom.et/receipt/{txRef}`) are **geo-blocked outside Ethiopia**. Netlify Functions cannot reliably fetch them, so all TeleBirr deposits go through **manual admin approval only**.

- On submit, the deposit is set to `auto_verified: false` with `admin_note: "TeleBirr receipt requires manual verification."`
- The `telebirr-verify.ts` module exists but is **isolated and never called** from any production path.
- Future automation options are documented in that file: Ethiopian VPS, HTTP proxy, or Android bridge.
- Transaction IDs must start with `"D"`.

**File**: `src/lib/server/deposits.ts` lines 141–166, `src/lib/server/telebirr-verify.ts` (isolated)

---

## 2. TeleBirr receipt_url Is Still Generated

Even though TeleBirr verification is manual, a `receipt_url` is always generated and stored on the deposit record:

```
https://transactioninfo.ethiotelecom.et/receipt/{transactionReference}
```

This allows admins inside Ethiopia to open the receipt link from the admin panel to verify manually.

**File**: `src/lib/server/deposits.ts` lines 21–33

---

## 3. CBE Is Automatic

CBE deposits trigger **immediate automatic receipt verification** on submit:

1. Fetch the receipt from the CBE endpoint.
2. Detect response format (PDF via `%PDF` magic bytes or `application/pdf` content type, otherwise HTML/JSON).
3. Extract transaction ID, amount, and receiver name using a multi-strategy parser.
4. Verify receiver name matches `payment_methods.account_name`.
5. If verified: update deposit to `approved`, credit wallet, create transaction record, send notification.
6. If verification fails: set `auto_verified: false`, add `admin_note` with failure reason, leave as `pending` for manual review.

Transaction IDs must start with `"FT"` and are **uppercased** before storage (see item 5).

**File**: `src/lib/server/deposits.ts` lines 169–232, `src/lib/server/cbe-verify.ts`

---

## 4. CBE Receipt URL Format

The CBE receipt URL is constructed from the transaction ID **plus** `payment_methods.account_last_8`:

```
https://apps.cbe.com.et:100/?id={transactionReference}{account_last_8}
```

- `account_last_8` is the last 8 digits of the receiver's CBE account number, stored on the `payment_methods` row.
- If `account_last_8` is null, the receipt URL is null and auto-verification cannot proceed.

**File**: `src/lib/server/deposits.ts` lines 21–33

---

## 5. CBE Transaction IDs Are Uppercased

Before validation and storage, CBE transaction references are converted to uppercase:

```typescript
if (method.type === "cbe") {
  data.transactionReference = data.transactionReference.toUpperCase();
}
```

This happens before the `"FT"` prefix check and before duplicate detection.

**File**: `src/lib/server/deposits.ts` lines 89–91

---

## 6. CBE Receipts Are PDFs

The CBE receipt endpoint returns **PDF documents**. Detection uses both content type and magic bytes:

```typescript
const isPdf = contentType.includes("application/pdf")
  || responseBuffer.subarray(0, 5).toString("ascii").startsWith("%PDF");
```

When a PDF is detected, text is extracted using `unpdf` before parsing. If the response is not a PDF, it falls back to HTML/JSON parsing.

**File**: `src/lib/server/cbe-verify.ts` lines ~580–653

---

## 7. PDF Extraction Uses unpdf

The `unpdf` library extracts text from PDF receipt documents:

```typescript
const { extractText } = await import("unpdf");
const result = await extractText(new Uint8Array(responseBuffer), { mergePages: true });
```

- `mergePages: true` combines all pages into a single text blob.
- The result may be a string or an array of strings; both cases are handled.
- Extracted text is then fed to `parseCBEReceiptFromText()`, which runs 4 strategies:
  1. Colon-separated key:value pairs
  2. Line-proximity matching (label on one line, value on next)
  3. Regex fallbacks for amount (`ETB`, `birr` patterns)
  4. Regex fallbacks for receiver name (Amharic character support)

**File**: `src/lib/server/cbe-verify.ts` lines ~590–653

---

## 8. Real Receipt Amount Replaces User-Entered Amount

When CBE auto-verification succeeds, the **amount extracted from the receipt** replaces whatever the user originally entered:

```typescript
// In deposits.ts — after successful verification:
amount: result.amount ?? deposit.amount,

// In cbe-verify.ts — deposit update payload:
amount: receiptAmount,
```

The receipt amount is authoritative. The user-entered amount is only a fallback if verification fails and admin reviews manually.

**File**: `src/lib/server/deposits.ts` line 198, `src/lib/server/cbe-verify.ts` line 849

---

## 9. Receiver Full Name Verification

The receiver name extracted from the receipt is compared against `payment_methods.account_name`:

```typescript
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const normalizedReceipt = normalizeName(receiptData.receiverName);
const normalizedExpected = normalizeName(method.account_name);

if (normalizedReceipt !== normalizedExpected) {
  // Verification fails — deposit stays pending for manual review
}
```

- Both names are lowercased, stripped of non-alpha characters (including Amharic), and whitespace-normalized.
- An exact normalized match is required.
- Mismatch sets the deposit to `auto_verified: false` with an admin note showing the discrepancy.

**File**: `src/lib/server/cbe-verify.ts` lines 33–39, 701–718

---

## 10. Wallet Credit and Transaction Creation

When a deposit is auto-approved (CBE) or manually approved (admin), the system:

### CBE Auto-Approval (cbe-verify.ts):
1. Fetches the user's current wallet balance.
2. Calculates `balance_after = balance_before + receiptAmount`.
3. Updates wallet balance directly.
4. Creates a `transactions` record with:
   - `type: "deposit"`, `status: "completed"`
   - `balance_before`, `balance_after`
   - `description: "CBE deposit auto-verified — {txRef}"`
   - `reference_id: depositId`
   - `metadata: { deposit_id, transaction_reference, auto_verified: true, receipt_url }`

### Admin Manual Approval (approve_deposit_tx RPC):
1. Locks the deposit row (`FOR UPDATE`).
2. Validates admin permissions and deposit status.
3. Updates deposit status to `approved`, sets `reviewed_at`. (Note: the `reviewed_by` column does not exist on the deposits table — see DEPOSIT_SAFETY_CHECKPOINT.md rule 13.)
4. Locks wallet row, updates balance.
5. Inserts transaction record.
6. Returns `balance_before`, `balance_after`, `transaction_id`.

**Files**: `src/lib/server/cbe-verify.ts` lines 763–843, `netlify/functions/admin-approve-deposit.mts`

---

## 11. Admin Approve/Reject Flow

The admin approval endpoint is a Netlify Function at `/api/admin/approve-deposit` (POST).

**Request:**
```json
{
  "depositId": "uuid",
  "action": "approve" | "reject",
  "adminNote": "optional reason"
}
```
Header: `Authorization: Bearer {supabase_token}`

**Flow:**
1. Validate auth token via `supabase.auth.getUser()`.
2. Call `approve_deposit_tx()` RPC with `p_deposit_id`, `p_admin_id`, `p_action`, `p_admin_note`, `p_amount`. (Note: `p_amount > 0` is required for approve — see DEPOSIT_SAFETY_CHECKPOINT.md rule 4.)
3. RPC performs atomic approval/rejection (wallet + transaction + status update).
4. On success, the Netlify function creates the notification (not the RPC).
5. Return result to admin UI.

**Error codes from RPC:** `admin_not_found`, `not_admin`, `admin_frozen`, `deposit_not_found`, `already_reviewed`, `invalid_amount`, `internal_error` — each mapped to an HTTP status and user-friendly message.

**File**: `netlify/functions/admin-approve-deposit.mts`

---

## 12. Deposit Notification Rules

Notifications are inserted into the `notifications` table. The `type` field lives **inside `metadata` JSONB**, not as a top-level column.

### On Approval (admin or auto):
```json
{
  "title": "Deposit Approved",
  "message": "Your deposit of {amount} ETB has been approved and credited to your wallet.",
  "metadata": {
    "type": "deposit_approved",
    "deposit_id": "...",
    "amount": 1000,
    "auto_verified": true | false
  }
}
```

### On Rejection (admin only):
```json
{
  "title": "Deposit Rejected",
  "message": "Your deposit of {amount} ETB was rejected. Please check the details and submit again.",
  "metadata": {
    "type": "deposit_rejected",
    "deposit_id": "...",
    "amount": 1000
  }
}
```

### Critical rules:
- Notification failures are **caught and logged but never block** the approval/rejection.
- CBE auto-approval creates its own notification in `cbe-verify.ts`.
- Admin approval/rejection creates notifications in `admin-approve-deposit.mts` (moved out of the RPC in migration `20260518000000`).

**Files**: `src/lib/server/cbe-verify.ts` lines 882–908, `netlify/functions/admin-approve-deposit.mts` lines 150–209

---

## 13. No "Deposit Submitted" Notifications

When a user submits a deposit, **no notification is created**. Notifications are only created on approval or rejection. There is no `deposit_submitted` or `deposit_pending` notification type.

---

## 14. Files Involved

| File | Purpose |
|------|---------|
| `src/routes/_app/deposit.tsx` | User deposit form (3-step flow + history) |
| `src/routes/_app/admin.tsx` | Admin dashboard with deposit review panel |
| `src/lib/server/deposits.ts` | `submitDepositFn`, `getUserDepositsFn`, `getAdminDepositsFn` |
| `src/lib/server/cbe-verify.ts` | CBE auto-verification (PDF/HTML parsing, wallet credit, txn) |
| `src/lib/server/telebirr-verify.ts` | TeleBirr verification (isolated, not called) |
| `src/lib/server/payment-methods.ts` | Payment method CRUD |
| `src/lib/server/notifications.ts` | `getNotificationsFn`, `getUnreadCountFn`, `markNotificationsReadFn` |
| `netlify/functions/admin-approve-deposit.mts` | Admin approval Netlify Function |
| `src/lib/database.types.ts` | TypeScript types for all tables |

### Relevant Migrations

| Migration | Purpose |
|-----------|---------|
| `20260512000000_qhash_schema.sql` | Base schema (deposits, payment_methods, wallets, notifications) |
| `20260512100000_deposits_phase4.sql` | Deposit enhancements |
| `20260512200000_deposit_stabilization.sql` | Deposit stabilization |
| `20260513000000_add_deposit_verification.sql` | Verification columns |
| `20260513100000_fix_verification_rls_and_rpc.sql` | RLS and RPC fixes |
| `20260514000000_remove_deposit_verification.sql` | Schema cleanup |
| `20260514100000_add_telebirr_auto_verification.sql` | TeleBirr verification support |
| `20260514200000_add_account_last_8.sql` | `account_last_8` column for CBE receipt URLs |
| `20260514300000_approve_deposit_transaction.sql` | `approve_deposit_tx()` RPC |
| `20260515000000_fix_deposit_amount_and_approval.sql` | Amount/approval fixes |
| `20260515300000_stabilize_approval_schema.sql` | Add metadata, balance cols, error handling |
| `20260518000000_remove_rpc_notification_inserts.sql` | Move notifications from RPC to Netlify function **(SUPERSEDED — contains unsafe COALESCE fallback + reviewed_by)** |
| `20260519000000_harden_approve_deposit_amount.sql` | Remove COALESCE fallback **(SUPERSEDED — still references reviewed_by)** |
| `20260526000000_align_approve_deposit_tx_with_live_rpc.sql` | **Canonical** live-safe RPC: strict p_amount, no fallback, no reviewed_by |

---

## 15. Tests Completed

No automated test suite (Jest/Vitest) exists for the deposit system. Verification has been done through:

- TypeScript type safety across all deposit modules.
- Input validation in all server functions (`inputValidator` on every `createServerFn`).
- Structured JSON logging at every step in `cbe-verify.ts` and `admin-approve-deposit.mts`.
- Manual end-to-end testing of both CBE and TeleBirr flows.
- Admin approval/rejection tested via the admin panel.

---

## 16. Important Future Rules

The following columns/patterns **do not exist** and must not be added to the database or referenced in code:

| Column / Pattern | Why It Must Not Exist |
|---|---|
| `notifications.type` | Type is stored inside `metadata` JSONB as `metadata.type`. There is no top-level `type` column on the `notifications` table. |
| `deposits.receipt_amount` | The receipt amount is written directly to `deposits.amount`, replacing the user-entered value. There is no separate `receipt_amount` column. |
| `deposits.reviewed_by` (column) | **This column does NOT exist on the live deposits table** (see DEPOSIT_SAFETY_CHECKPOINT.md rule 13). The `approve_deposit_tx()` RPC was repaired to remove references to it. Do not reference it in code. |

Any future schema changes must be **additive migrations only** — never edit or delete existing applied migrations.
