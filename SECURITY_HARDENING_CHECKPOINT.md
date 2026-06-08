# Security Hardening Checkpoint

This document records the current confirmed stable state of QHash security hardening work.

It is a checkpoint only. No code is changed by this document.

## Purpose

The main purpose of this hardening work was to stop trusting client-passed `userId` or `adminUserId` values for authorization.

Where hardened, server functions now derive the real user identity from the Supabase `accessToken`.

Admin functions verify admin status server-side and reject frozen admins where applicable.

## Admin Hardening Completed

The following admin areas have been hardened to use session-derived identity and admin checks:

- `getDepositVerificationLogsFn` uses `accessToken` and checks `is_admin` / `is_frozen`.
- `getAdminStatsFn` uses `accessToken` and checks `is_admin` / `is_frozen`.
- `getAdminDepositsFn` uses `accessToken` and checks `is_admin` / `is_frozen`.
- Admin payment-method listing, create, update, and archive actions use `accessToken` and check `is_admin` / `is_frozen`.
- `trigger-daily-earnings.mts` rejects frozen admins before manual earnings processing.

## User Function Hardening Completed

The following user-facing functions have been hardened to use `accessToken` instead of trusting client-passed user IDs:

- `loadReferralStatsFn`
- `getNotificationsFn`
- `getUnreadCountFn`
- `markNotificationsReadFn`
- `getTransactionsFn`
- `getWalletBalanceFn`
- `getInvestmentsFn`
- `loadDashboardFn`
- `processEarningsFn`

`processEarningsFn` also rejects frozen users before financial earning processing.

## Payment Methods Security Completed

Payment-method management has been hardened:

- Admin payment-method actions no longer trust client-passed user IDs.
- CBE `account_last_8` is derived server-side from `account_number`.
- TeleBirr `account_last_8` is always `null`.
- Archived payment methods are hidden from the public deposit page.
- Archived methods are disabled.
- The public deposit page shows only active non-archived methods.
- Admin Payments can still list/manage active, inactive, and archived/internal method records as intended.

## Deposit Security Already Completed Separately

The CBE and TeleBirr deposit verification systems are stable.

Confirmed behavior:

- CBE uses extracted Reference No. / VAT Invoice No. as the canonical reference.
- TeleBirr uses `extracted_transaction_id` as the canonical reference.
- Duplicate protection uses the extracted/canonical reference.
- Deposit verification logs are created for both CBE and TeleBirr.
- Admin Verification Audit UI is read-only.
- Deposit approval/rejection review flow remains controlled by admin approval logic.
- Public deposit page shows only valid active payment methods.

## Referral Rewards Security Completed

Referral Phase 2A and 2B are stable.

Confirmed behavior:

- Investment referral rewards use `referral_investment_bonus`.
- Daily mining referral rewards use `referral_daily_bonus`.
- Mining referral reward logs use `reward_type = "mining"`.
- Daily mining referral rewards are already implemented and should not be reimplemented.
- Duplicate protection for mining referral rewards uses `earning_reference_id`.
- Inactive uplines are skipped.
- Skipping inactive uplines does not break upper-level continuation.
- Rewards are credited directly to referrer wallets.

## Disabled / Incomplete Features

Some features are intentionally not production-ready yet:

- Withdrawals are Coming Soon.
- Withdraw submission is disabled.
- Withdrawal history may remain read-only if shown.
- Support tickets are Coming Soon.
- Support backend calls are disabled from the UI.
- Support page shows Coming Soon / contact admin messaging.

Do not spend additional hardening effort on Support or Withdraw until those systems are intentionally designed, built, secured, and tested.

## Guardrails

Future development should follow these guardrails:

- Do not trust client-passed `userId` or `adminUserId` for authorization.
- Do not use service-role server functions with client-provided user IDs as the source of truth.
- Derive identity server-side from Supabase `accessToken`.
- Admin actions must check `is_admin = true`.
- Admin actions must reject frozen admins where applicable.
- User financial writes should reject frozen users.
- Do not re-enable Withdraw submission until the withdrawal system is intentionally built and secured.
- Do not re-enable Support submission until the support-ticket system is intentionally built and secured.
- Do not touch stable CBE / TeleBirr deposit logic without a focused deposit-security review.
- Do not reimplement Referral Phase 2B daily mining referral rewards.
- Do not create duplicate mining referral reward logic in `src/lib/server/referral-rewards.ts`.

## Known Future Work

Future security work should be handled in small focused phases:

- Harden `getTicketsFn` and `submitTicketFn` when Support is intentionally built.
- Design and secure the withdrawal system when withdrawals are intentionally built.
- Review `getUserDepositsFn` and `submitDepositFn` in a future focused deposit-security phase.
- Consider creating a shared server auth helper to reduce repeated `accessToken` verification code.
- Consider adding more admin action audit logs.
- Consider rate limiting for sensitive endpoints.
- Consider abuse-detection rules for repeated failed deposit submissions or suspicious account behavior.

## Current Stable State

At this checkpoint:

- Deposits are stable.
- Payment methods are stable.
- Admin verification audit is stable.
- Referral investment rewards are stable.
- Daily mining referral rewards are stable.
- Manual daily earnings trigger rejects frozen admins.
- User reads and key financial functions hardened so far use session-derived identity.
- Withdraw and Support remain intentionally disabled as Coming Soon features.
