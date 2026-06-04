# Deposit Verification Audit Table — Design Checkpoint

**Status:** Design only. Not implemented. No code, database, Supabase, Netlify function, or frontend changes were made.

This document is a design checkpoint for a future durable audit table, `deposit_verification_logs`, that would record deposit-verification decisions (CBE automatic, TeleBirr verifier, and admin manual). It is the inspection result and recommendation; nothing here has been built. The migration, helper, and call-site wiring described below are deliberately deferred to later, sign-off-gated phases.

---

## 1. Why a new audit table is needed

Today there is no durable, queryable record of *why* a deposit was approved, rejected, or held for manual review. The existing surfaces each fail to serve as an audit trail for a different reason:

- **`deposits.admin_note` is overwritten.** It is a single free-text field updated on every state transition, so it cannot hold a history — each new decision destroys the previous note. It is also intentionally scrubbed of sensitive detail.
- **`transactions` only cover approved deposits.** A `transactions` row is written when a deposit is *credited*. Rejections and manual-review holds produce no row, so those outcomes would be invisible in any transactions-based reconstruction.
- **`notifications` are user-facing.** They are messaging to the end user, not an internal audit record, and their content is shaped for display rather than for forensics.
- **Netlify logs are temporary.** Function logs are working and cleaned, but they are short-lived, not durable, and not queryable long-term.
- **Money-related verification decisions need durable history.** Deposit approve/reject/hold decisions move funds. When a user disputes an outcome, or when the team needs to audit verifier behaviour over time, a permanent structured trail is required. A dedicated append-only table closes that gap without touching the hardened approval path.

---

## 2. Recommended table purpose

`deposit_verification_logs` is intended to be:

- **Append-only verification decision history** — rows are inserted, never updated or deleted in normal operation.
- **One row per final decision initially** — the cleanest, lowest-risk durable record, mapping one-to-one to a user-visible outcome. An `event` field and a `metadata` JSONB column are retained so finer-grained step logging can be layered in later without a schema change. Recommendation: start one-per-decision; do not fan out to step logs until there is a concrete need.
- **A home for all three decision sources** — CBE automatic decisions, TeleBirr verifier decisions, and admin manual decisions, all in one uniform shape.

---

## 3. Recommended columns

| Column | Type (suggested) | Notes |
|---|---|---|
| `id` | `UUID` PK, default `gen_random_uuid()` | Row identity. |
| `deposit_id` | `UUID` | Soft correlation to the deposit. **Not** a hard FK — see Safety/Risks. |
| `user_id` | `UUID` (nullable) | Soft correlation to the depositing user. |
| `payment_type` | `TEXT` | `'cbe'` or `'telebirr'`. |
| `event` | `TEXT` | Decision event name, e.g. `cbe_auto_approve`, `telebirr_manual_review`. |
| `action` | `TEXT` | `approve` / `reject` / `manual_review` / `skipped` / `error`. |
| `reason_code` | `TEXT` (nullable) | Low-cardinality code, e.g. `receiver_mismatch`, `too_old`, `invalid_cbe_link`. |
| `reason_message_safe` | `TEXT` (nullable) | Pre-sanitised message. Never raw receipt text or names. |
| `amount` | `NUMERIC(18,2)` (nullable) | Decision amount; may be null on error. |
| `tx_ref_last4` | `TEXT` (nullable) | Last 4 characters of the transaction reference only. |
| `receiver_matched` | `BOOLEAN` (nullable) | Whether the receiver matched. |
| `freshness_decision` | `TEXT` (nullable) | `fresh` / `too_old` / `future` / `missing` / `unparseable`. |
| `age_minutes` | `INTEGER` (nullable) | Age of the receipt at decision time. |
| `actor_type` | `TEXT` | `system` / `admin` / `verifier`. |
| `actor_id` | `UUID` (nullable) | Admin profile id when `actor_type = 'admin'`, else null. |
| `source` | `TEXT` | `cbe_auto` / `telebirr_verifier` / `admin_manual`. |
| `metadata` | `JSONB`, default `'{}'` | Safe-only: booleans, enums, counts. Never raw PII or secrets. |
| `created_at` | `TIMESTAMPTZ`, default `now()` | Insert time. |

`deposit_id`, `user_id`, and `actor_id` are intentionally plain `UUID` columns rather than foreign keys, so that an audit insert can never be blocked by referential-integrity edge cases (deposit deleted, write ordering, etc.). The overriding rule is that audit writes must never block the money path.

---

## 4. Security rules

- **RLS enabled** on the table; default-deny for every client role.
- **Admins can `SELECT`** — read access gated by the existing `is_admin()` helper.
- **Normal users cannot `SELECT` / `INSERT` / `UPDATE` / `DELETE`** — no client-facing policy is granted, so those paths are denied by default under RLS. Anonymous access is likewise denied.
- **Service role writes only** — all writes occur through the service role, which bypasses RLS. This mirrors how `approve_deposit_tx` is already granted to `service_role` only.
- **No realtime needed** — this table is not user-facing and should not be added to any realtime publication.

---

## 5. Safety rules

- **Never store full receipt text.**
- **Never store the full receipt URL** (reduce to host-only if any URL context is needed at all).
- **Never store API keys or secrets.**
- **Never store raw receiver / account names.**
- **Avoid the full transaction reference; store only the last 4 characters** (`tx_ref_last4`), mirroring the existing masking discipline. The full reference combined with account digits can form a receipt-fetch credential, so it must not be persisted in the clear.
- **Audit insert failure must never block approval or rejection.** Every insert is fire-and-forget, wrapped in `try/catch` at the call site or in a shared helper that swallows and self-logs its own errors.
- **Inserts happen after the authoritative approve / reject / manual-review decision** — never inside the `approve_deposit_tx` transaction. The audit row records a decision that has already been committed.

---

## 6. Recommended migration (later)

- Write a single **additive migration in `supabase/migrations/`** (next timestamp in sequence).
- It should: **create the table, create its indexes, enable RLS, add the admin-select policy, and grant the service role** the needed write/read.

  Suggested indexes:
  - `deposit_id`
  - `user_id` (partial, where not null)
  - `created_at DESC`
  - composite `(payment_type, action, created_at DESC)` for filtered admin views.

- **Do not edit, rename, or delete any already-applied migration.** Roll forward with a new file only.
- **Confirm the target database before applying.** The repository carries two migration tracks: `supabase/migrations/` (where `deposits`, `transactions`, `notifications`, and `approve_deposit_tx` are defined) and `netlify/database/migrations/` (the immutable, already-applied Netlify DB branch). The deposit-verification objects live on the Supabase side, so this audit table belongs in `supabase/migrations/`. Verify which database the running functions point at before writing the migration; the immutable Netlify list must not be touched.

The migration must be purely additive — no foreign-key constraints that could block deposit writes, and no alterations to existing tables or the RPC.

---

## 7. Recommended call sites (later)

Inserts should happen only at **final-decision** sites, immediately after the authoritative state change:

- **`src/lib/server/deposits.ts`** — for CBE final decisions (auto-reject, manual-review-hold, invalid-amount-hold, auto-approve branches), after each authoritative update/RPC.
- **`netlify/functions/verifier-submit-telebirr-result.mts`** — for TeleBirr verifier decisions (reject, manual-review, approve branches).
- **`netlify/functions/admin-approve-deposit.mts`** — for admin manual decisions, after a successful RPC, recording `actor_type = 'admin'` and `actor_id`.
- **Do not write from `cbe-verify.ts` directly.** That module returns a decision to its caller and has no admin/actor context; keeping the insert at the caller avoids double-logging and keeps `cbe-verify.ts` side-effect-free.

---

## 8. Recommended implementation phases

1. **Design checkpoint** — this document. Agree the schema, the soft-FK decision, one-row-per-decision granularity, and which database the migration targets. No code.
2. **Migration** — add the additive `supabase/migrations` file (table + indexes + RLS + grants). Purely additive.
3. **Shared helper with try/catch** — a single `logVerificationDecision()` that swallows and self-logs its own errors and enforces a safe-metadata whitelist, so no call site can throw into the approval path.
4. **Wire CBE** — call sites in `src/lib/server/deposits.ts`, inserts placed after the authoritative state change.
5. **Wire TeleBirr** — call sites in `netlify/functions/verifier-submit-telebirr-result.mts`.
6. **Wire admin manual** — call site in `netlify/functions/admin-approve-deposit.mts`.
7. **Optional admin UI history panel later** — read-only "Verification history" panel gated by `is_admin()`.

Wire one source at a time, and verify in a preview environment that approvals/rejections still succeed even when the audit insert is forced to fail.

---

## 9. Risks

- **Audit insert blocking the money path** — the single most important risk. Mitigated by fire-and-forget inserts wrapped in `try/catch`, a soft (non-FK) `deposit_id`, and placement strictly *after* `approve_deposit_tx` — never inside its transaction.
- **Sensitive data leakage** — mitigated by storing only masked/sanitised/boolean fields, reusing existing masking helpers, and enforcing a safe-metadata whitelist in the helper.
- **Wrong migration track** — writing the table into the Netlify DB branch instead of Supabase (or vice versa) would leave call sites pointing at a table that does not exist. Confirm the target before the migration phase; never edit the immutable applied migrations.
- **Double logging** — avoided by logging only at final-decision sites in the callers and explicitly not in `cbe-verify.ts`.
- **Volume growth** — append-only tables grow unbounded. Low near-term risk at current deposit volume; address with an optional retention window later if warranted.

---

## 10. Status

- **Design only.**
- **Not implemented.**
- **No code or database changes.** No migration was created; Supabase, Netlify functions, and frontend UI are untouched.
