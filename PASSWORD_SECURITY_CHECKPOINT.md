# Password Security Checkpoint

This checkpoint records the confirmed password-security behavior for the QHash platform after the login-password and fund-password consistency fixes.

## Purpose

The purpose of this checkpoint is to prevent future regressions where one part of QHash accepts a weaker password policy while another part enforces a stronger one.

QHash now has two separate password systems:

1. Login password
2. Fund password

These systems are intentionally different and must remain separate.

## Login Password Policy

The login password is used for account authentication.

Current confirmed policy:

- New accounts must use a login password with at least 8 characters.
- Login password changes must require the new login password to have at least 8 characters.
- Confirm new login password must match the new login password.
- New login password must be different from the current login password.
- Current login password must be present, but it must not be blocked by the new 8-character policy before verification.
- Existing users who previously had a 6-character login password must still be able to enter that current password and upgrade to a new 8+ character password.
- Wrong current login password must show the user-facing message: `Current login password is incorrect.`
- Successful login password change signs the user out so they can log in again with the new password.
- Login page must not add a local minimum-length block, because it must allow any currently valid existing Supabase password.

## Registration Policy

Registration is aligned with the login password policy.

Current confirmed policy:

- Registration UI requires a password with at least 8 characters.
- Registration server validation requires a password with at least 8 characters.
- Registration UI text must continue to say `Min. 8 characters` or equivalent 8-character wording.
- Registration server error must continue to say that the password must be at least 8 characters.

## Security Page Policy

The Security page is aligned with the login password policy.

Current confirmed policy:

- New login password requires at least 8 characters.
- UI hint says to use at least 8 characters.
- Current login password is verified against Supabase.
- Wrong current login password is returned as a structured expected result and displayed directly by the page.
- Unexpected verification failures still use safe server errors.
- Security page uses the auth-store session access token.
- Security page server actions are wrapped with request timeouts.
- Security page refreshes silently when the tab becomes visible or the browser comes back online.

## Fund Password Policy

The fund password is separate from the login password.

Current confirmed policy:

- Fund password must be exactly 4 digits.
- Fund password is required for withdrawals.
- Fund password is not the same as the login password.
- Fund password is verified through the server-side security RPC flow.
- Fund password failed attempts and lock behavior remain unchanged.
- Fund password reset through Admin Security remains unchanged.

## Admin Temporary Login Password Reset

Admin temporary login password reset remains separate from normal user password changes.

Current confirmed policy:

- Admin reset generates a temporary login password.
- Temporary login password generation is not weakened by the user-facing minimum rule.
- The generated temporary password is longer and stronger than the 8-character minimum.
- Admin reset audit behavior remains unchanged.

## Important Behavior Preserved

The password consistency fixes intentionally did not change:

- Login page authentication behavior
- Registration username rules
- Registration phone rules
- Fund password RPC behavior
- Fund password lock behavior
- Withdrawal fund-password verification
- Admin temporary password reset logic
- Admin reset audit logging
- Deposit logic
- Withdrawal financial rules
- Wallet logic
- Database schema
- Supabase migrations
- Netlify configuration

## Guardrails Going Forward

Future QHash changes must follow these rules:

1. Do not reduce the login password minimum below 8 characters for new passwords.
2. Do not apply the new-password minimum rule to the current password field before verification.
3. Do not add a local minimum-length block to the Login page.
4. Do not mix login password rules with fund password rules.
5. Keep fund password exactly 4 digits unless a separate security redesign explicitly changes it.
6. Keep expected wrong-current-password outcomes as user-facing structured results where server-function error serialization would otherwise hide the correct message.
7. Keep Security page server actions protected with bounded timeouts.
8. Do not modify database migrations for password UI consistency fixes.
9. Do not modify the immutable withdrawal RPC migration:
   `netlify/database/migrations/20260608170000_create_withdrawal_rpc_functions/migration.sql`
10. Do not change financial, deposit, withdrawal, or admin business rules while fixing password UI consistency.

## Current Confirmed Stable State

The login-password and fund-password behavior is now consistent across Registration, Login, Security, Admin reset, and Withdraw.

The latest production testing confirmed:

- wrong current login password shows the correct message
- new login password requires 8+ characters
- successful login password change works
- fund password behavior remains stable
- Security page timeout hardening works
- Netlify deployment succeeds
- app behavior remains normal after deployment
