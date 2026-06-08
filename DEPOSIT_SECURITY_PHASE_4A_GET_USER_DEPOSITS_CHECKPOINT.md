# Deposit Security Phase 4A — getUserDepositsFn Checkpoint

This document records the current confirmed stable state after Deposit Security Phase 4A.

It is a checkpoint only. No code is changed by this document.

## Status

- Deposit Security Phase 4A is complete.
- `getUserDepositsFn` is now hardened.
- Deposit history no longer trusts a client-passed `userId`.
- This phase was read-only deposit history hardening only.
- `submitDepositFn` was intentionally not changed in this phase.

## Files Changed in Phase 4A

- `src/lib/server/deposits.ts`
- `src/routes/_app/deposit.tsx`

## Server Behavior

`getUserDepositsFn` now uses session-derived identity.

Confirmed behavior:

- `getUserDepositsFn` now requires `accessToken` instead of `userId`.
- `accessToken` is validated as a non-empty string.
- `getAdminClient()` is used.
- `admin.auth.getUser(accessToken)` verifies the caller.
- If the token is missing, invalid, or expired, the function throws a safe deposit error.
- The real user id is derived from `authUser.id`.
- The deposits query uses `authUser.id` only.
- `getUserDepositsFn` no longer accepts or uses client-passed `userId`.

## Unchanged Server Behavior

The following behavior was intentionally preserved:

- Returned deposit history shape is unchanged.
- Selected deposit columns are unchanged.
- Payment method lookup behavior is unchanged.
- `method_type` and `method_name` mapping are unchanged.
- Ordering remains `created_at` descending.
- Limit remains `50`.
- `submitDepositFn` was not changed.
- Admin deposit functions were not changed.

## Frontend Behavior

The Deposit page was updated only for deposit history loading.

Confirmed behavior:

- Deposit page imports `supabase`.
- Deposit history loading reads the current session.
- Deposit history uses `session.access_token`.
- If `accessToken` is missing, history loading stops safely without calling `getUserDepositsFn`.
- Post-submit deposit history refresh also uses `accessToken`.
- UI layout was unchanged.
- Payment method loading was unchanged.
- Wallet behavior was unchanged.
- `submitDepositFn` call was intentionally left unchanged and may still pass `userId` until Phase 4B.

## Safety Guardrails

- Do not treat Phase 4A as deposit submission hardening.
- Do not modify `submitDepositFn` as part of Phase 4A.
- Do not change CBE verification logic from this checkpoint.
- Do not change TeleBirr verification logic from this checkpoint.
- Do not change receipt URL generation.
- Do not change duplicate checks.
- Do not change auto-verification.
- Do not change notifications.
- Do not change wallet crediting.
- Do not change admin review or approval flow.

## Known Future Work

Deposit Security Phase 4B should harden `submitDepositFn`.

Phase 4B must be handled separately because it affects actual deposit submission.

Phase 4B should be planned carefully and tested with both CBE and TeleBirr.

Phase 4B should not change admin approval, wallet crediting, or verification logic unless intentionally planned.

## Current Stable State

At this checkpoint:

- Deposit history is hardened.
- Deposit history uses server-verified identity from `accessToken`.
- Deposit submission is unchanged.
- CBE deposit flow is unchanged.
- TeleBirr deposit flow is unchanged.
- Payment methods are unchanged.
- Admin deposit review is unchanged.
- The app deployed and loaded successfully after Phase 4A.
