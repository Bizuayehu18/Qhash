# Deposit Security Phase 4B — submitDepositFn Checkpoint

This document records the current confirmed stable state after Deposit Security Phase 4B.

It is a checkpoint only. No code is changed by this document.

## Status

- Deposit Security Phase 4B is complete.
- `submitDepositFn` is now hardened.
- Deposit submission no longer trusts a client-passed `userId`.
- Deposit submission now derives the depositor identity server-side from the Supabase session `accessToken`.
- Missing or frozen profiles are rejected before any deposit row is inserted.
- Deposit Security Phase 4A remains intact.

## Files Changed in Phase 4B

- `src/lib/server/deposits.ts`
- `src/routes/_app/deposit.tsx`

## Server Behavior

`submitDepositFn` now uses session-derived identity.

Confirmed behavior:

- `submitDepositFn` now requires `accessToken` instead of `userId`.
- `accessToken` is validated as a non-empty string.
- `getAdminClient()` is used.
- `admin.auth.getUser(accessToken)` verifies the caller.
- If the token is missing, invalid, or expired, the function throws a safe deposit error.
- The real user id is derived from `authUser.id`.
- The caller profile is loaded from `public.profiles` using `authUser.id`.
- If the profile is missing or `is_frozen === true`, deposit submission is rejected.
- Deposit insertion uses `authUserId` only.
- Deposit verification/audit logging uses `authUserId`.
- CBE verification is called with the server-derived user id.
- TeleBirr/manual pending flow uses the server-derived user id.
- `submitDepositFn` no longer accepts or uses client-passed `userId`.

## Unchanged Server Behavior

The following behavior was intentionally preserved:

- Amount validation is unchanged.
- Payment method validation is unchanged.
- Transaction reference validation is unchanged.
- Payment method loading behavior is unchanged.
- Active/non-archived payment method requirement is unchanged.
- Receipt URL generation is unchanged.
- CBE receipt URL format is unchanged.
- TeleBirr receipt URL format is unchanged.
- CBE canonical/extracted reference behavior is unchanged.
- TeleBirr pending/manual behavior is unchanged.
- Duplicate transaction reference checks are unchanged.
- Auto approve/reject/manual-review behavior is unchanged.
- Deposit verification log behavior is unchanged.
- Notification behavior is unchanged.
- Wallet crediting behavior is unchanged.
- `approve_deposit_tx` usage is unchanged.
- Returned response shape is unchanged.
- Admin deposit functions were not changed.
- `getUserDepositsFn` Phase 4A hardening was not changed.

## Frontend Behavior

The Deposit page was updated only for deposit submission identity.

Confirmed behavior:

- Deposit page no longer sends `userId: user.id` to `submitDepositFn`.
- Before deposit submission, the page reads the current Supabase session.
- Deposit submission uses `session.access_token`.
- If `accessToken` is missing, the user sees: `Session expired. Please sign in again.`
- If `accessToken` is missing, `submitDepositFn` is not called.
- Deposit history loading still uses the Phase 4A `accessToken` flow.
- Payment method loading was unchanged.
- Wallet fetch behavior was unchanged.
- UI layout was unchanged.

## Safety Guardrails

- Do not reintroduce client-passed `userId` into `submitDepositFn`.
- Do not use `user.id` from the frontend for deposit ownership.
- Deposit ownership must always come from the server-verified Supabase session.
- Do not change CBE verification logic from this checkpoint unless intentionally planned.
- Do not change TeleBirr verification logic from this checkpoint unless intentionally planned.
- Do not change receipt URL generation without a focused deposit-security review.
- Do not change duplicate checks without a focused deposit-security review.
- Do not change auto-verification decisions without a focused deposit-security review.
- Do not change wallet crediting behavior without a focused financial review.
- Do not change admin review or approval flow from this checkpoint unless intentionally planned.

## Known Future Work

Future deposit security work should be handled in separate small phases.

Possible future work:

- Review `getUserDepositsFn` and `submitDepositFn` together for shared auth helper cleanup.
- Review deposit error messages for consistency.
- Review deposit abuse prevention and rate limiting.
- Review repeated invalid receipt submissions.
- Review whether frozen users should also be blocked from read-only deposit history.
- Review admin deposit functions for continued least-privilege behavior.
- Continue monitoring CBE and TeleBirr verification logs.

## Current Stable State

At this checkpoint:

- Deposit history is hardened.
- Deposit submission is hardened.
- Deposit ownership uses server-verified identity.
- Frozen users are blocked from new deposit submission.
- CBE deposit flow is unchanged.
- TeleBirr deposit flow is unchanged.
- Payment methods are unchanged.
- Admin deposit review is unchanged.
- Wallet crediting is unchanged.
- The app deployed successfully after Phase 4B.
- The app loads properly.
- The Deposit page opens properly.
