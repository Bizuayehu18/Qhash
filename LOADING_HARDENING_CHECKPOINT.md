# Loading Hardening Checkpoint

This checkpoint records the loading and refresh hardening completed across the QHash platform.

## Purpose

The goal of this hardening pass was to prevent QHash pages from getting stuck in loading states after a tab is minimized, the browser goes offline and returns online, or a network/server request hangs longer than expected.

The platform now prefers:

- visible page content instead of full-page indefinite loading
- skeleton placeholders instead of fake zero/dash values
- silent background refresh where appropriate
- bounded request timeouts
- small, isolated changes per page or store
- no user-facing technical retry/error panels for normal background refresh failures

## Completed User-Facing Page Hardening

The following pages were hardened and tested in production:

- Dashboard
- Deposit
- Withdraw
- Profile
- Team / Referrals
- Transactions
- Notifications
- Plans
- Support
- Admin Overview
- Admin Deposits
- Admin Withdrawals
- Admin Verification Audit
- Admin Security
- Admin Settings

## Completed Auth Flow Hardening

The following authentication flows were hardened and tested in production:

- Login
- Registration
- Global auth initialization
- Profile loading after auth restore
- Auth-state-change profile refresh

## Completed Store-Level Hardening

The following shared stores were hardened:

- `authStore`
- `walletStore`

## Important Behavior Preserved

The hardening work intentionally preserved existing business logic:

- deposit logic unchanged
- withdrawal logic unchanged
- fund-password verification unchanged
- login and registration validation unchanged
- plan purchase logic unchanged
- referral logic unchanged
- admin actions unchanged
- Telegram-only Support behavior unchanged
- Supabase server-side identity enforcement unchanged
- wallet server-side identity derivation unchanged

## Loading Rules Going Forward

For future QHash pages and stores:

1. Do not leave user-facing pages dependent on unbounded requests.
2. Use `withTimeout` around server calls that can affect page loading or button loading.
3. Prefer auth-store session access tokens instead of calling `supabase.auth.getSession()` repeatedly inside page loaders.
4. Use skeleton placeholders for unknown data values.
5. Avoid showing fake `0`, `0.00`, or `-` values while real data is still unknown.
6. Do not show technical retry panels for background refresh failures.
7. Use silent retries for recoverable background refresh failures.
8. Refresh silently when the tab becomes visible and when the browser comes back online, where appropriate.
9. Keep PRs small and scoped to one page/store at a time.
10. Do not change financial, deposit, withdrawal, or admin business rules while fixing loading behavior unless explicitly required.

## Current Confirmed Stable State

The loading hardening pass is complete for the known user-facing pages and shared stores that were causing or could cause stuck loading behavior. Each change was merged through a separate PR, deployed through Netlify, and tested in production before continuing.

## Guardrails

Do not modify database migrations as part of loading UI hardening.

Do not modify the immutable withdrawal RPC migration:

`netlify/database/migrations/20260608170000_create_withdrawal_rpc_functions/migration.sql`

Do not change CBE or TeleBirr deposit verification logic unless a separate explicit task requires it.

Do not change withdrawal financial rules unless a separate explicit task requires it.

Do not change security/fund-password rules unless a separate explicit task requires it.
