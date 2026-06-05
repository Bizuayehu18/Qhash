# Payment Methods — Admin / Security / Archive Checkpoint

**Status:** Stable / Finalized
**Date:** 2026-06-05
**Scope:** Admin Payment Methods management, server-side security model, CBE / TeleBirr account handling, soft-archive system, and public Deposit page visibility.

This document is a checkpoint of the current, confirmed-working state of the Payment Methods subsystem. It is descriptive only — no behavior is changed by this file.

Primary implementation file: `src/lib/server/payment-methods.ts`
Migration: `supabase/migrations/20260605222402_add_payment_methods_is_archived.sql`
Admin UI: `src/routes/_app/admin.tsx`
Public Deposit UI: `src/routes/_app/deposit.tsx`

---

## 1. Security Model

All privileged payment-method operations derive the caller's identity on the server from a Supabase session access token. The client-supplied user id is never trusted.

- `getPaymentMethodsFn` with `activeOnly: false` (admin listing) requires and uses `accessToken`.
- `createPaymentMethodFn` uses `accessToken`, **not** a client-passed `userId`.
- `updatePaymentMethodFn` uses `accessToken`, **not** a client-passed `userId`.
- `archivePaymentMethodFn` uses `accessToken`.
- The server derives the real admin identity through `admin.auth.getUser(accessToken)`.
- The server then checks `profiles.is_admin = true` **and** `is_frozen != true`.
- Frozen admins are rejected.
- The frontend never uses the service role key. The service role is used only inside server functions.

This is enforced by `assertAdminToken(accessToken)`, which is called by every privileged path (`activeOnly:false` listing, create, update, archive). It mirrors the existing pattern used by `getAdminDepositsFn` / `getAdminStatsFn`.

---

## 2. Public Deposit Behavior

- Public `activeOnly: true` payment-method listing still works **without** an access token.
- The public Deposit page shows only **active, non-archived** payment methods.
- The public query applies both `is_active = true` and `is_archived = false`.
- Archived payment methods must never appear on the public deposit page.

---

## 3. CBE Behavior

- The admin enters the **CBE account number**.
- The backend derives `account_last_8` from the account number (`deriveAccountLast8`).
- The admin no longer manually enters `account_last_8`.
- CBE requires the account number to contain **at least 8 digits** (validated server-side; fewer than 8 digits is rejected).
- `account_last_8` is the trailing 8 digits of the account number and is used for CBE receipt URL generation.

---

## 4. TeleBirr Behavior

- TeleBirr does **not** use `account_last_8`.
- The backend always stores TeleBirr `account_last_8` as `null`.
- The admin UI does not show a last-8 field for TeleBirr.

---

## 5. Instructions Field

- Instructions are optional.
- Blank / null instructions can clear the database value to `null`.
- On update: `undefined` means "do not change", `null` (or a blank string that trims to empty) explicitly clears the value to `null`, and a non-empty string is stored trimmed.

---

## 6. Archive Behavior

- `payment_methods.is_archived` exists (boolean, `not null default false`).
- The default Admin Payments view hides archived methods (`archiveFilter = "visible"`).
- The **Archived** filter shows archived methods only.
- The **All** filter shows both archived and visible methods.
- Archive sets `is_archived = true` **and** `is_active = false`.
- Unarchive sets `is_archived = false` and does **not** auto-enable the method (an admin must explicitly re-enable it).
- No hard delete exists yet.
- Used payment methods should be **archived, not deleted**, to preserve deposit history.

---

## 7. Confirmed Behavior

- Admin Payments list loads active/inactive visible methods.
- Archive works.
- Unarchive works.
- Create payment method works.
- Edit payment method works.
- Enable / disable works.
- Public Deposit page still shows active CBE / TeleBirr methods.
- Active CBE `account_last_8` verified in Supabase.
- TeleBirr `account_last_8` verified as `null` in Supabase.

---

## 8. Guardrails (Do Not Regress)

- Do **not** hard-delete used payment methods.
- Do **not** expose archived methods publicly.
- Do **not** allow archived methods to remain active.
- Do **not** trust client-passed `userId` for admin payment-method actions.
- Do **not** manually type CBE `account_last_8`.
- Do **not** store TeleBirr `account_last_8`.
- Do **not** change CBE / TeleBirr deposit verification logic from the Payment Methods UI.
- Do **not** bypass `approve_deposit_tx`.

---

## 9. Reference — Server Functions

All defined in `src/lib/server/payment-methods.ts`:

| Function | Auth | Purpose |
|---|---|---|
| `getPaymentMethodsFn` | `accessToken` required only when `activeOnly: false` | Lists methods. Public path = active + non-archived. Admin path = `archiveFilter` of `visible` / `archived` / `all`. |
| `createPaymentMethodFn` | `accessToken` (admin) | Creates a method; derives `account_last_8` server-side. |
| `updatePaymentMethodFn` | `accessToken` (admin) | Edits a method; re-derives `account_last_8` from the stored immutable type; handles instructions clear. |
| `archivePaymentMethodFn` | `accessToken` (admin) | Soft archive (`is_archived=true`, `is_active=false`) / unarchive (`is_archived=false`). |

Helpers:
- `assertAdminToken(accessToken)` — verifies an active, non-frozen admin via `admin.auth.getUser` + `profiles` check.
- `deriveAccountLast8(type, accountNumber)` — CBE returns trailing 8 digits (requires ≥8 digits); TeleBirr returns `null`.
