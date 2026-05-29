# Deposit Safety Checkpoint

> Last updated: 2026-05-26

This document records the current stable deposit verification rules, known schema facts, and guardrails that must not be violated.

---

## Stable Deposit Rules

### Input Trust

1. **User-submitted amount is untrusted.** The amount a user enters on the deposit form is treated as a claim, never as the credited value.

### Automatic Verification

2. **Automatic verifiers credit only the extracted official receipt amount.** When a receipt image is processed, the system extracts the amount from the receipt itself — the user-submitted value is ignored.

### Manual Admin Approval

3. **Manual admin approval requires an admin-entered `verifiedAmount`.** The admin must explicitly type the verified amount before approving; there is no auto-fill from the user's claimed amount.

### RPC Constraints (`approve_deposit_tx`)

4. **`approve_deposit_tx` requires `p_amount > 0` for approve.** The RPC will reject any approval call where the amount is zero or negative.
5. **`approve_deposit_tx` must never fall back to `deposits.amount`.** The credited amount must always come from the caller (verifier or admin), never from the row the user created.
6. **Reject does not require `p_amount`.** A rejection path does not need an amount parameter.

### TeleBirr Receipt Automation

7. **Valid fresh receipt → auto-approve.** A TeleBirr receipt that passes validation and is recent is automatically approved using the extracted amount.
8. **Old receipt → `manual_review`.** A TeleBirr receipt with a stale timestamp is routed to manual review instead of being auto-approved.
9. **Wrong receiver → auto-reject.** If the receipt's receiver does not match the expected merchant, the deposit is automatically rejected.
10. **Invalid / unreadable receipt → auto-reject.** Receipts that cannot be parsed or fail structural validation are automatically rejected.

### Admin & Notification Confirmation

11. **Manual admin approval tested and working.** The admin approval flow (enter verified amount → call RPC → credit wallet) has been end-to-end verified.
12. **Notifications confirmed for approve/reject.** Users receive notifications on both approval and rejection outcomes.

---

## Known Schema Fact

13. **The `deposits` table does NOT have a `reviewed_by` column.** Any code that references `reviewed_by` on the deposits table will fail at runtime. Do not add this column without a database migration.

---

## Do-Not-Break Guardrails

14. The following invariants must be preserved across all future changes:

| Guardrail | Rationale |
|---|---|
| Do not re-add a `deposits.amount` fallback in the RPC | The user-submitted amount is untrusted; falling back to it would bypass verification. |
| Do not add `reviewed_by` unless the database schema is migrated first | Referencing a non-existent column crashes the RPC. |
| Do not let the frontend `verifiedAmount` be cosmetic only | The value the admin enters must be the value passed to the RPC and credited to the wallet. |
| Do not let the Android client call Supabase directly | All writes must go through server-side RPC; the client is not a trusted boundary. |
| Backend / RPC remains the final authority | No client-side logic may override the RPC's credit or reject decision. |

---

## Recent Repair Summary

- **Issue:** A bad `reviewed_by` reference was added to the `approve_deposit_tx` RPC. Because the `deposits` table has no `reviewed_by` column, all admin approvals broke at runtime.
- **Repair:** The RPC was updated to remove the `reviewed_by` reference while keeping the strict `p_amount` rule intact. Approvals and rejections were re-verified end-to-end after the fix.

---

## Canonical Migration

The source-of-truth migration file for the current live `approve_deposit_tx` RPC is:

**`supabase/migrations/20260526000000_align_approve_deposit_tx_with_live_rpc.sql`**

Older migrations that defined this RPC are superseded and should not be trusted:
- `20260518000000_remove_rpc_notification_inserts.sql` — contains the unsafe `COALESCE` fallback + `reviewed_by`
- `20260519000000_harden_approve_deposit_amount.sql` — removed `COALESCE` but still references `reviewed_by`
