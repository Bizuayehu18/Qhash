# Security Hardening Checkpoint

This checkpoint records the current stable security hardening state of the QHash platform after PR #69.

## Current stable baseline

The platform is stable after PR #69. Admin withdrawals and the admin payment archive UI are working.

The following systems are considered stable and should not be redesigned unless specifically requested:

* Deposit automation
* Deposit verification and audit logging
* User withdrawals
* Admin withdrawal review
* Admin payment method archive and restore UI

## Identity and authorization hardening

Server-side identity must be derived from the Supabase access token.

Client-passed user identifiers must not be trusted for financial or privileged server actions.

Admin server functions must verify that the authenticated user is an admin before performing privileged actions.

Frozen admins must be rejected from admin actions.

User financial write functions must derive the user identity from the access token.

Frozen users must be rejected from financial write actions.

## Admin access-token fixes

The admin page access-token fixes must be preserved.

The following admin areas are expected to send the Supabase session access token to server calls:

* Overview
* Deposits
* Withdrawals
* Payments
* Verification Audit

These fixes prevent missing-token and unauthorized errors in Netlify function logs.

## Withdrawals

Withdrawals are stable after PR #69.

Current withdrawal behavior:

* Minimum withdrawal amount is 200 ETB.
* Withdrawal fee is 5%.
* Wallet balance is deducted immediately when a withdrawal is submitted.
* If an admin rejects a withdrawal, the gross withdrawal amount is refunded.
* If an admin approves a withdrawal, wallet balance is not changed again.
* Notifications are generated on approve or reject only, not on submit.
* Admin withdrawal approve and reject actions are working from the admin UI.

## Payment methods

Admin payment methods are stable after PR #69.

Current payment method behavior:

* Archive and restore actions are available.
* Visible, Archived, and All filters are available.
* Archived accounts show an Archived badge.
* Archived methods are hidden from the normal visible list.
* CBE account last 8 digits are generated automatically from the account number.
* TeleBirr does not require a last-8 field.

## Protected migration warning

Do not edit, delete, rename, replace, or regenerate this protected Netlify Database migration:

```text
netlify/database/migrations/20260608170000_create_withdrawal_rpc_functions/migration.sql
```

Previous deploys failed when Netlify detected that this migration had been modified after being applied.

For future production database logic, prefer manual Supabase SQL or new Supabase migrations instead of editing this Netlify migration.

## Guardrails for future work

Future work should be done in small phased changes.

Prefer one file or one feature at a time.

Before committing, confirm that the diff contains only the intended files.

Do not run formatting across the full repository unless that is the explicit task.

Do not mix documentation changes with frontend, backend, migration, or server-function changes.

If many files appear modified only because of line endings, do not commit them.

## Deployment checks after admin-related changes

After any admin-related PR or deploy:

1. Open `/admin` as an admin user.
2. Confirm Overview loads without toast errors.
3. Confirm Deposits list, detail, and action UI load.
4. Confirm Withdrawals list and detail UI load.
5. Submit one test withdrawal of 200 ETB and reject it to confirm refund.
6. Submit another test withdrawal and approve it to confirm no extra wallet change.
7. Test payment method add, edit, toggle, archive, and restore.
8. Confirm Verification Audit logs load.
9. Check Netlify function logs for missing access token, unauthorized, admin-error, or payment-error messages.
