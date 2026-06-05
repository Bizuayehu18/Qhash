# Admin Verification Audit UI — Checkpoint

**Status:** Stable
**Date:** 2026-06-05
**Scope:** Read-only admin UI for the `deposit_verification_logs` audit trail.

This document records the current stable state of the **Verification Audit** panel
on the Admin page. It is a checkpoint only — no behavior is changed by this file.

---

## Purpose

- A **Verification Audit** panel was added to the Admin page.
- It provides a **read-only** UI for the `public.deposit_verification_logs` table.
- It lets admins inspect **CBE** and **TeleBirr** verification decisions directly
  in the app, without writing Supabase SQL or opening the database console.

---

## Current UI

The Admin page includes a tab/section named **Verification Audit**
(`{ key: "audit", label: "Verification Audit" }`).

- Shows the **latest audit logs**, limited to recent rows
  (`AUDIT_LIMIT = 100`, server-clamped to a max of 100; default 50).
- Filter pills exist for **All / CBE / TeleBirr** (`paymentType: "all" | "cbe" | "telebirr"`).
- Each row collapses/expands to reveal detail; metadata is collapsed behind a
  `<details>` "Metadata" toggle.

Rows show **safe fields only**:

| Field | Notes |
|---|---|
| `created_at` | Rendered via `formatDateTime` |
| `payment_type` | CBE / TeleBirr label |
| `event` | Audit event name |
| `action` | Badge: approve / reject / manual_review / skipped / error |
| `reason_code` | Machine-readable code |
| `reason_message_safe` | Pre-masked human message |
| `amount` | Displayed in ETB |
| `tx_ref_last4` | Rendered as `****XXXX` only |
| `receiver_matched` | Yes / No / — |
| `freshness_decision` | Freshness outcome |
| `age_minutes` | Numeric age |
| `source` | Audit source |
| `actor_type` | Who/what produced the row |
| shortened `deposit_id` | `shortId()` → first 8 chars |
| shortened `user_id` | `shortId()` → first 8 chars |
| safe metadata preview | Collapsed `<details>` JSON of already-safe metadata |

---

## Architecture

- **Frontend:** `AuditLogsTab` in `src/routes/_app/admin.tsx`.
- **Server read path:** `getDepositVerificationLogsFn` in
  `src/lib/server/deposit-audit-logs.ts` — a TanStack `createServerFn`
  (`method: "POST"`).
- The server function is intentionally **separate** from the deposit submission,
  CBE, and TeleBirr verification code. It never writes, updates, or deletes, and
  never touches the money path.

### Server safety contract

- **Admin-only:** the handler re-checks `profiles.is_admin` via the service-role
  client before returning any rows (mirrors `getAdminDepositsFn`). Non-admin
  requests are rejected with an "Unauthorized." safe error.
- **Column whitelist (`SAFE_COLUMNS`):** only the safe, already-masked columns
  listed above are selected. There is no `SELECT *`.
- **No joins:** no join to `profiles` or `deposits`; only the shortened ids
  stored on the audit row itself are returned.
- **Input validation:** `userId` is required; `paymentType` is normalised to
  `cbe`, `telebirr`, or `undefined` (all); `limit` is clamped to `1..100`.

---

## Security

- Admin-only page. The Admin route redirects non-admins to `/dashboard`
  (`if (profile && !profile.is_admin) navigate({ to: "/dashboard" })`) and
  renders nothing for non-admins (`if (!profile?.is_admin) return null`).
- Normal users must not see this panel.
- The UI is **read-only**. There are no approve / reject / update / delete
  actions in this panel.
- The frontend must not use the service role. The service-role client lives only
  in the server function (`getAdminClient()`), behind the admin gate.
- The server read path verifies admin access **before** returning any logs.

---

## Safety (data exposure rules)

- Do **not** display full receipt URLs.
- Do **not** display full receipt text.
- Do **not** display API keys or secrets.
- Do **not** display full transaction references.
- Do **not** display raw receiver / account names or account numbers.
- Show only `tx_ref_last4` (rendered as `****XXXX`).

These fields are not present in the `SAFE_COLUMNS` whitelist, so they cannot be
returned to the client. `tx_ref_last4` is already masked to 4 characters at
write time.

---

## Confirmed behavior

- The **Verification Audit** tab appears in Admin.
- **All / CBE / TeleBirr** filters work.
- Audit rows display safe **last4-only** references (`****XXXX`).
- Both **CBE** and **TeleBirr** audit rows are visible.
- Metadata is **collapsed / previewed** safely behind a toggle.
- The app loads properly after deploy.

---

## Guardrails

These constraints define the boundary of this panel. They must hold unless a
future phase is explicitly planned and approved.

- Do **not** change deposit approval / rejection logic from this UI.
- Do **not** change CBE verification logic from this UI.
- Do **not** change TeleBirr verifier logic from this UI.
- Do **not** change `approve_deposit_tx`.
- Do **not** add wallet, transaction, notification, or referral writes.
- Keep this panel **read-only** unless a future phase is explicitly planned.

---

## Related files

- `src/routes/_app/admin.tsx` — `AuditLogsTab`, `AuditRow`, `shortId`, `AUDIT_LIMIT`.
- `src/lib/server/deposit-audit-logs.ts` — `getDepositVerificationLogsFn`, `SAFE_COLUMNS`.
- `DEPOSIT_VERIFICATION_AUDIT_TABLE_DESIGN.md` — audit table design.
- `CBE_TELEBIRR_DEPOSIT_FINAL_STABLE_CHECKPOINT.md` — deposit system checkpoint.
