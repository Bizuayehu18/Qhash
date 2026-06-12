# Withdrawal Launch Hardening Checkpoint

Date: 2026-06-12
Status: Production verified
Scope: Documentation-only checkpoint for the QHash withdrawal launch hardening work.

## Purpose

This checkpoint records the final stable withdrawal launch state after production Supabase RPC hardening and live app testing.

The main security and correctness goal was to make withdrawal submission safe for launch by moving the one-withdrawal-per-Ethiopia-day protection into the database transaction itself, while preserving the existing wallet deduction, admin approval, and admin rejection behavior.

## Final production result

The withdrawal system is considered launch-ready as of this checkpoint.

Verified production behavior:

- A user can submit a withdrawal request.
- The wallet is deducted once when a pending withdrawal is created.
- A second withdrawal attempt during the same Ethiopia calendar day is blocked.
- The second same-day attempt does not create another withdrawal row.
- The second same-day attempt does not deduct the wallet again.
- Admin approval works.
- Admin rejection works.
- Admin rejection refunds the gross withdrawal amount.
- Admin approval does not apply a second wallet change.

## Important schema finding

Production Supabase withdrawal-related identity columns are UUID-based.

Confirmed production column types:

- `public.profiles.id` is `uuid`.
- `public.wallets.user_id` is `uuid`.
- `public.withdrawals.user_id` is `uuid`.
- `public.transactions.user_id` is `uuid`.
- `public.transactions.reference_id` is `uuid`.

Because of this, withdrawal RPCs must use UUID comparisons and UUID inserts for user and withdrawal identifiers.

## Final request withdrawal RPC state

Only one `request_withdrawal_tx` function should exist in production:

```text
request_withdrawal_tx(uuid,numeric,payment_method_type,text,text)
```

The old/incompatible text overload must not exist:

```text
request_withdrawal_tx(text,numeric,payment_method_type,text,text)
```

Reason: keeping both overloads caused Supabase/PostgREST RPC ambiguity:

```text
PGRST203: Could not choose the best candidate function
```

Reason the UUID signature is required: the production schema stores the relevant user and reference identifiers as UUID. A text-based RPC caused PostgreSQL comparison failures such as:

```text
operator does not exist: uuid = text
```

## Critical database hardening now present in `request_withdrawal_tx`

The production `request_withdrawal_tx(uuid,numeric,payment_method_type,text,text)` function must continue to include the following properties:

- `p_user_id` is typed as `uuid`.
- The wallet row is locked with `FOR UPDATE` before the daily-limit check.
- The one-withdrawal-per-day rule is checked inside the RPC, not only in TypeScript.
- The daily-limit window uses Ethiopia calendar day via `Africa/Addis_Ababa`.
- The daily-limit exception text remains exactly:

```text
Daily withdrawal limit reached
```

This exact phrase is intentionally preserved because the frontend/server error handling maps it to the user-facing message:

```text
You can only submit one withdrawal request per day. Please try again tomorrow.
```

## Why wallet lock placement matters

The wallet row lock must happen before the database daily-limit check.

This serializes concurrent withdrawal requests for the same user. Without the lock, two nearly simultaneous requests could both pass a pre-check before either request inserts a withdrawal row. With the lock in place, the second request must wait until the first transaction finishes, then sees the new same-day withdrawal row and is blocked.

## Preserved financial behavior

The production submit flow remains:

1. Validate the authenticated user.
2. Validate amount, withdrawal method, account name, and account number.
3. Reject frozen or unavailable users.
4. Lock the user's wallet row.
5. Check the Ethiopia-day daily withdrawal limit inside the transaction.
6. Check wallet balance.
7. Deduct the gross withdrawal amount immediately.
8. Insert a pending withdrawal row.
9. Insert a pending withdrawal transaction.
10. Do not send a notification on submit.

The production admin review flow remains:

- Approval marks the withdrawal approved and marks the matching withdrawal transaction completed.
- Approval does not change the wallet again.
- Rejection marks the withdrawal rejected, marks the original withdrawal transaction failed, and refunds the gross withdrawal amount.
- Rejection inserts an admin adjustment transaction for the refund.
- Approval and rejection send user notifications.

## Admin RPC UUID verification

The admin review RPCs are confirmed UUID-safe:

```text
approve_withdrawal_tx(uuid,uuid,text)
reject_withdrawal_tx(uuid,uuid,text)
```

Both functions compare transaction `reference_id` using UUID semantics:

```sql
reference_id = p_withdrawal_id
```

They must not compare using a text cast:

```sql
reference_id = p_withdrawal_id::text
```

## Production tests completed

The following live tests were completed successfully after the final RPC correction:

- User withdrawal submission succeeded.
- One pending withdrawal row was created.
- Wallet was deducted once at the same timestamp as the pending withdrawal creation.
- Repeated same-day withdrawal attempts returned the expected daily-limit message.
- Repeated same-day withdrawal attempts did not create extra withdrawal rows.
- Repeated same-day withdrawal attempts did not deduct wallet again.
- Admin approval was tested and worked.
- Admin rejection was tested for a different user and worked.
- Reject refund behavior was confirmed working.

## Known non-blocking follow-up

Expected daily-limit blocks currently appear in Netlify logs as `ERROR` entries because the shared safe-error path logs business-rule exceptions as errors.

This is not a financial or launch blocker. The user-facing behavior is correct.

Optional future polish:

- Treat expected daily-limit blocks as a normal business-rule rejection in logs.
- Avoid logging expected daily-limit blocks as scary `ERROR` noise.

## Guardrails for future AI or maintenance work

Do not edit, delete, rename, regenerate, or reformat the already-applied Netlify migration:

```text
netlify/database/migrations/20260608170000_create_withdrawal_rpc_functions/migration.sql
```

That migration is protected history. Netlify tracks applied migration checksums, so even whitespace or comment changes can break future deploys.

If future changes are needed, use one of these safe paths:

1. A new migration with a new timestamped folder/file, or
2. A deliberate manual Supabase SQL patch, followed by documentation.

Do not reintroduce a text overload for `request_withdrawal_tx` unless PostgREST ambiguity is explicitly accounted for. The current safe production target is a single UUID request RPC.

Do not move the daily-limit rule back to TypeScript-only enforcement. TypeScript may keep a friendly pre-check, but the database RPC must remain the source of truth.

Do not remove the wallet `FOR UPDATE` lock before the daily-limit check.

Do not change the daily-limit exception phrase unless the frontend/server mapping is updated at the same time.

## Stable checkpoint summary

Current launch-ready withdrawal state:

```text
PASS: Submit RPC uses UUID schema
PASS: Text overload removed
PASS: PostgREST ambiguity fixed
PASS: UUID/text mismatch fixed
PASS: Daily withdrawal limit enforced inside RPC
PASS: Ethiopia-day window used for daily limit
PASS: Wallet row locked before daily-limit check
PASS: First withdrawal succeeds
PASS: Same-day duplicate withdrawal is blocked
PASS: Wallet deducted only once
PASS: Admin approve works
PASS: Admin reject works
PASS: Rejection refund works
```

This document is a checkpoint record only. It does not change runtime behavior.
