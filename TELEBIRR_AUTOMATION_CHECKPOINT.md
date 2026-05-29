# TeleBirr Automation Verification Checkpoint

> Stable checkpoint documentation for the automated TeleBirr deposit verification system.
> This file is documentation only — no application, backend, or database changes.

---

## 1. End-to-End Flow

1. User submits a TeleBirr deposit via the app, providing a transaction reference and amount.
2. The deposit record is created in Supabase with status `pending`.
3. An Android verifier device polls the backend for pending TeleBirr deposits.
4. For each pending deposit, the Android app opens the official TeleBirr receipt URL and parses the receipt page.
5. The Android app submits the parsed result back to the backend.
6. The backend applies approval, rejection, or manual-review rules and updates the deposit accordingly.
7. The backend is the final authority — the Android device never writes to Supabase directly.

---

## 2. Android Verifier Role

The Android verifier is a lightweight client that:

- Polls `GET /api/verifier/pending-telebirr` for deposits awaiting verification.
- Opens each receipt URL in a headless or embedded browser context.
- Parses the rendered receipt page to extract structured fields.
- Submits the extraction result to `POST /api/verifier/submit-telebirr-result`.
- Has **no direct Supabase access** — all state changes go through the backend.

---

## 3. Backend Endpoints

### `GET /api/verifier/pending-telebirr`

Returns pending TeleBirr deposits that have not yet been verified or flagged for manual review.

- **Auth header:** `X-Verifier-Api-Key`
- **Excludes:** deposits where `admin_note` starts with `"Verifier review:"`

### `POST /api/verifier/submit-telebirr-result`

Receives the parsed receipt data from the Android verifier and applies approval/rejection/manual-review logic.

- **Auth header:** `X-Verifier-Api-Key`
- **Body:** parsed receipt fields (receiver name, amount, payment date, success/failure indicator)

---

## 4. API Key Header

All verifier requests are authenticated with:

```
X-Verifier-Api-Key: <server-side secret>
```

---

## 5. Receipt URL Format

```
https://transactioninfo.ethiotelecom.et/receipt/{TRANSACTION_REFERENCE}
```

The `TRANSACTION_REFERENCE` comes from the user's deposit submission.

---

## 6. Android Parser Extracts

The Android receipt parser extracts three fields used for verification:

| Field | Description |
|---|---|
| **Receiver name** | The name of the account that received the payment |
| **Official receipt amount** | The monetary amount shown on the receipt |
| **Payment date** | The date/time the payment was made |

---

## 7. Backend Approval Rules

A deposit is **auto-approved** when all of the following are true:

- Receiver name matches the `account_name` in the `payment_methods` table.
- Extracted amount is greater than zero.
- Payment date is within the last 60 minutes.

The credited amount is the **extracted official receipt amount**, not the user-submitted amount.

---

## 8. Auto-Reject Rules

A deposit is **auto-rejected** when:

- The transaction reference is unreadable or non-functional (receipt page cannot be loaded or parsed).
- The receiver name does not match `payment_methods.account_name`.

---

## 9. Manual-Review Rules

A deposit is sent to **manual review** when:

- The receipt is valid but the payment date is older than 60 minutes.
- The payment date is invalid, in the future, or missing — but the receipt is partially readable.
- A system error, RPC failure, or admin-level issue prevents automated processing.

Manual-review deposits are marked with an `admin_note` that starts with `"Verifier review:"`.

---

## 10. Amount Rule

- **Credit only the extracted official receipt amount.**
- The user-submitted amount is ignored for crediting purposes.

---

## 11. Fields Not Used for Approval

The following extracted fields are **not** used in approval/rejection decisions:

- **Extracted status** — informational only.
- **Extracted transaction ID** — informational only; not used for approval logic.

---

## 12. Manual-Review Marker

Deposits flagged for manual review have:

```
admin_note LIKE 'Verifier review:%'
```

This prefix is used by both the backend (to flag) and the pending endpoint (to exclude from future polling).

---

## 13. Pending Endpoint Exclusion

`GET /api/verifier/pending-telebirr` excludes any deposit whose `admin_note` starts with `"Verifier review:"`, preventing the Android verifier from re-processing deposits already under manual review.

---

## 14. Notifications

| Outcome | User Notification |
|---|---|
| Auto-approved | Deposit Approved notification created |
| Auto-rejected | Deposit Rejected notification created |
| Manual review | No user notification created |

---

## 15. Supabase Tables Involved

| Table | Role |
|---|---|
| `deposits` | Stores deposit records and verification status |
| `payment_methods` | Provides `account_name` for receiver name matching |
| `wallets` | Credited on approval |
| `transactions` | Records the financial transaction on approval |
| `notifications` | Stores user-facing notifications for approved/rejected deposits |

---

## 16. Schema Status

No schema changes are required for the current TeleBirr verifier system. All necessary columns and tables already exist.

---

## 17. Stable Test Results

| Scenario | Expected Outcome |
|---|---|
| Fresh valid receipt (< 60 min) | Approved |
| Old valid receipt (> 60 min) | Manual review |
| Wrong receiver name | Rejected |
| Invalid / unreadable transaction reference | Rejected |

---

## 18. Do-Not-Break Guardrails

These invariants must be preserved in any future changes:

1. **Do not trust user-submitted amount** — always use the extracted official receipt amount.
2. **Do not use extracted transaction ID for approval** — it is informational only.
3. **Do not use extracted status for approval** — it is informational only.
4. **Do not approve receipts older than 60 minutes** — route to manual review instead.
5. **Do not let Android update Supabase directly** — all writes go through the backend.
6. **Backend remains the final authority** — the Android verifier is a data collector, not a decision maker.

---

## 19. Future Improvements

- **Android background polling** — move from manual trigger to automated background polling with configurable intervals.
- **Verifier key hardening** — rotate keys, add IP allowlisting, or move to short-lived tokens.
- **Audit log table** — dedicated table for recording every verification attempt and outcome for compliance and debugging.
- **CBE verifier** — extend the same verification architecture to Commercial Bank of Ethiopia deposits.
