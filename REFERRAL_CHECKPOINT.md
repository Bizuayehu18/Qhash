# QHash Earning & Referral System — Stabilization Checkpoint

**Date:** 2026-05-20 (updated from 2026-05-17)
**Status:** STABLE — All earning and referral subsystems confirmed working. Do not modify logic without reviewing this document.

---

## Architecture Summary

Supabase is the **sole source of truth** for all referral data. The Netlify Database/Drizzle schema mirrors the `referrals` table structure for ORM convenience, but all referral reads and writes go through the Supabase client. The `referral_reward_logs` table exists only in Supabase — it was explicitly removed from Netlify Database.

---

## Latest Fixes (2026-05-20)

These issues were identified, root-caused, and resolved. The fixes are confirmed in the current codebase — no further database changes are required.

### Fix 1 — Team Page Active Count (Server-Side Stats)

**Problem:** The frontend was attempting to read other users' investment rows to compute the "Active" referral count. Supabase RLS correctly blocked those cross-user reads, resulting in the Active count always showing 0.

**Resolution:** The Team page (`/referrals`) now calls `loadReferralStatsFn()`, a server function that uses the Supabase service-role admin client (`getAdminClient()`). The admin client bypasses RLS and can query investments for all referred users. The frontend never directly queries other users' investments.

**Files:** `src/lib/server/referrals.ts` (server function), `src/routes/_app/referrals.tsx` (frontend consumer)

### Fix 2 — Daily Mining Referral Reward Missing

**Problem:** Mining referral rewards were not being created. The root cause was that the mining reward log insert was using `investment_id` as the reference key, which conflicted with the unique constraint on `(investment_id, referrer_user_id, level, reward_type)` in `referral_reward_logs`. Since investment rewards already occupied that constraint slot for a given investment, subsequent daily mining rewards from the same investment were silently blocked as duplicates.

**Resolution:** Mining referral logs now use `earning_reference_id` (set to the earning transaction ID) as the reward reference, and set `investment_id` to `null`. This ensures each daily earning generates its own unique reward log entry that does not conflict with investment reward entries.

**Files:** `netlify/functions/lib/process-mining-referral-rewards.mts` (lines 198–209)

### Fix 3 — Mining Referral Duplicate Protection Order

**Problem:** The reward log insert was happening after the wallet update and transaction creation. If the log insert then detected a duplicate (or failed), the wallet and transaction had already been mutated — resulting in orphaned credits.

**Resolution:** The duplicate protection order was corrected. The reward log insert now happens **first** (step 1), before any wallet read, wallet update, or transaction creation. If the log insert detects a duplicate (either via the application-level check or the database unique constraint), the function skips all subsequent steps for that referrer.

**Files:** `netlify/functions/lib/process-mining-referral-rewards.mts` (step ordering: log insert → wallet read → wallet update → transaction create)

### Fix 4 — Daily Earning/Mining Notifications Removed

**Problem:** Notifications were being created for every daily earning and every `referral_daily_bonus` transaction. At scale, this floods the notification feed with low-value noise.

**Resolution:** The daily earnings processor (`process-all-earnings.mts`) and the mining referral rewards processor (`process-mining-referral-rewards.mts`) do **not** insert notifications. Investment referral bonuses still generate a notification (via `processInvestmentReferralRewards()`) since those are one-time events.

**Files:** `netlify/functions/lib/process-all-earnings.mts`, `netlify/functions/lib/process-mining-referral-rewards.mts`

### Fix 5 — Notification Type Field Placement

**Clarification:** Notifications use `metadata.type` (inside the JSONB `metadata` column) to classify the notification kind — not a top-level `type` column on the `notifications` table. The investment referral notification inserts `metadata: { type: "referral_investment_bonus", ... }`.

**Files:** `src/lib/server/referral-rewards.ts` (lines 188–199)

### Fix 6 — Missing Level 1 Rewards Confirmed Correct

**Validation:** Comparison SQL confirmed that expected rewards match actual rewards. Cases where level 1 rewards appear "missing" are correct behavior — the level 1 referrer was inactive (no active investment) and was intentionally skipped by the eligibility check. Both `processInvestmentReferralRewards()` and `processMiningReferralRewards()` enforce this rule.

### Fix 7 — No Database Changes Required

All fixes were code-level only. The existing schema, constraints, migrations, and RLS policies are correct as-is.

---

## Working Features

### Phase 1 — Registration Referral Chain

When a new user registers with a `?ref=<username>` parameter:

1. The referrer's username is resolved to a user ID via the `profiles` table.
2. `buildReferralChain()` inserts up to 3 levels of referral rows into Supabase's `referrals` table.
3. Circular references and self-referrals are blocked at every level.
4. Duplicate rows are prevented via `upsert` with `ignoreDuplicates: true`.
5. If the referral chain fails, profile creation still succeeds (graceful degradation).
6. A Supabase DB trigger (`build_referral_chain()`) also creates rows as a backup; the upsert approach ensures no double-inserts.

### Phase 1B — Team Link & Stats

The `/referrals` page (labeled "Team" in the sidebar) displays:

- **Referral link** with copy-to-clipboard (`/register?ref=<username>`)
- **Total referrals** — count of all `referrals` rows where the user is `referrer_id`
- **Active referrals** — computed server-side via `loadReferralStatsFn()` using the service-role admin client (bypasses RLS to count referred users with active investments)
- **Earned commissions** — sum of `total_investment_rewards` + `total_mining_rewards` across all referral rows
- **Commission tiers** — Level 1: 5%, Level 2: 3%, Level 3: 2%

### Phase 2A — Investment Referral Rewards

When a user purchases an investment plan:

1. `processInvestmentReferralRewards()` is called as a non-blocking step after purchase completion.
2. Reward percentages are loaded dynamically from `app_settings`.
3. The purchaser's upline referrers (levels 1–3) are queried from the `referrals` table.
4. For each eligible referrer: wallet balance is updated, a `referral_investment_bonus` transaction is created, a notification is sent, and the reward is logged to `referral_reward_logs`.
5. Anti-abuse checks: self-reward blocked, duplicate rewards prevented (via `referral_reward_logs` lookup on `investment_id`), inactive referrers skipped (must have at least one active investment).

### Phase 2B — Daily Mining Referral Rewards

When the daily earnings scheduler runs:

1. `processAllEarnings()` processes all active investments and creates earning transactions.
2. For each earning transaction, `processMiningReferralRewards()` distributes referral bonuses to the earner's upline referrers (levels 1–3).
3. Mining reward percentages are loaded from `app_settings` (`mining_referral_level_*_percent`).
4. Each reward is logged to `referral_reward_logs` with `earning_reference_id` set to the earning transaction ID and `investment_id` set to `null`.
5. Duplicate protection: the reward log insert happens **first**; if the log insert fails (application-level check or unique constraint), the wallet and transaction steps are skipped.
6. Eligibility: referrer must have at least one active investment; inactive referrers are skipped.
7. No notifications are created for mining referral rewards.

---

## Supabase Is the Only Referral Source of Truth

All referral operations use the Supabase admin client:

- `buildReferralChain()` → `admin.from('referrals').upsert(...)`
- `processInvestmentReferralRewards()` → `admin.from('referrals').select(...)`, `admin.from('referral_reward_logs')...`
- `processMiningReferralRewards()` → `admin.from('referrals').select(...)`, `admin.from('referral_reward_logs')...`
- `loadReferralStatsFn()` → `admin.from('referrals').select(...)`, `admin.from('investments').select(...)` (server-side, bypasses RLS)

The Drizzle schema in `db/schema.ts` defines a `referrals` table, but it is only used for Netlify Database migration generation — **not for any referral queries or mutations at runtime**.

---

## Netlify Database / Drizzle Must NOT Be Used for Referrals

The `referral_reward_logs` table was created and then dropped **twice** from Netlify Database via corrective migrations:

| Migration | Action |
|---|---|
| `20260517500000` | Accidentally added `referral_reward_logs` to Netlify DB |
| `20260517600000` | Dropped it (corrective) |
| `20260517700000` | Accidentally recreated it |
| `20260517800000` | Dropped it again (corrective) |

The final state of Netlify Database has:
- `referrals` table — exists (created by `20260517205632`), constraints added by `20260517400000`
- `referral_reward_logs` table — **does not exist** (dropped by `20260517800000`)

**Rule:** Any future referral logic must use the Supabase client, not Drizzle/Netlify Database.

---

## Exact Files Involved

### Server-Side Logic (Supabase client)

| File | Purpose |
|---|---|
| `src/lib/server/auth.ts` | `buildReferralChain()` + registration flow with referral handling |
| `src/lib/server/referral-rewards.ts` | `processInvestmentReferralRewards()` — investment reward calculation and distribution |
| `src/lib/server/investments.ts` | Calls `processInvestmentReferralRewards()` after investment purchase (step 8) |
| `src/lib/server/transactions.ts` | Includes `referral_investment_bonus` in valid transaction type filter |
| `src/lib/server/referrals.ts` | `loadReferralStatsFn()` — server-side team stats using admin client (bypasses RLS) |
| `src/lib/server/notifications.ts` | Notification CRUD server functions (read, unread count, mark read) |
| `netlify/functions/lib/process-mining-referral-rewards.mts` | `processMiningReferralRewards()` — daily mining referral bonus distribution |
| `netlify/functions/lib/process-all-earnings.mts` | `processAllEarnings()` — daily earnings engine, calls mining referral rewards per earning |
| `netlify/functions/daily-earnings.mts` | Scheduled function (cron: `0 21 * * *`) — triggers daily earnings |
| `netlify/functions/trigger-daily-earnings.mts` | Admin HTTP endpoint for manual daily earnings trigger |

### Frontend / UI

| File | Purpose |
|---|---|
| `src/routes/_app/referrals.tsx` | Team page — referral link, stats, commission tiers |
| `src/components/layout/AppLayout.tsx` | Sidebar nav includes "Team" link to `/referrals` |
| `src/components/ui/TransactionHelpers.tsx` | Maps `referral_investment_bonus` to purple icon/label in transaction lists |

### Types

| File | Purpose |
|---|---|
| `src/lib/database.types.ts` | Supabase-generated types including `referrals` and `referral_reward_logs` tables |

### Drizzle Schema (NOT used at runtime for referrals)

| File | Purpose |
|---|---|
| `db/schema.ts` | Defines `referrals` table for Netlify DB migration generation only |

### Supabase Migrations (referral-related)

| Migration | Purpose |
|---|---|
| `20260512000000_qhash_schema.sql` | Initial `referrals` table, `build_referral_chain()` trigger, reward percentages |
| `20260515100000_referral_normalization.sql` | Added `total_investment_rewards`/`total_mining_rewards` columns, new transaction types |
| `20260515400000_grant_referral_engine_tables.sql` | Service role grants for `referrals`, `investments`, `app_settings`, `plans` |
| `20260516000000_grant_referral_engine_remaining_tables.sql` | Service role grants for `wallets`, `transactions`, `notifications` |
| `20260516100000_harden_referral_chain_trigger.sql` | `ON CONFLICT DO NOTHING` in trigger |
| `20260516200000_harden_referral_chain_exception.sql` | Exception handling + circular-reference guards in trigger |
| `20260517000000_grant_referral_reward_logs.sql` | Service role grant for `referral_reward_logs` |

### Netlify Database Migrations (referral-related)

| Migration | Purpose |
|---|---|
| `20260515202209` | Added `referral_reward`, `referral_investment_bonus`, `referral_daily_bonus` to transaction_type enum |
| `20260517205632` | Created `profiles` and `referrals` tables in Netlify DB |
| `20260517400000` | Added constraints to `referrals` (unique pair, self-referral check, level range) |
| `20260517500000` | Added transaction type values + accidentally created `referral_reward_logs` |
| `20260517600000` | Corrective drop of `referral_reward_logs` |
| `20260517700000` | Accidentally recreated `referral_reward_logs` |
| `20260517800000` | Final corrective drop of `referral_reward_logs` |

### Test Script

| File | Purpose |
|---|---|
| `scripts/test-referral-chain.mts` | Integration test: 4 scenarios covering 1/2/3-level chains + duplicate prevention |

---

## Latest Validated Tests (2026-05-20)

The following have been verified against the current codebase and database state:

1. **Earning flow end-to-end:** Daily scheduler fetches active investments, calculates earnings, creates transactions, updates wallets, and triggers mining referral rewards for each earning.
2. **Mining referral reward creation:** For each earning, upline referrers (levels 1–3) receive `referral_daily_bonus` transactions and `referral_reward_logs` entries using `earning_reference_id`.
3. **Mining referral duplicate prevention:** Re-running earnings for the same earning transaction ID does not produce duplicate rewards (application-level check + DB unique constraint).
4. **Inactive referrer skip:** Referrers with no active investments are correctly skipped at all levels for both investment and mining rewards.
5. **Team page stats:** Active count is computed server-side using the admin client and returns correct results even when RLS blocks direct frontend queries.
6. **Comparison SQL validation:** Expected rewards match actual rewards in the database. Missing level 1 rewards are accounted for by the inactive referrer skip rule.
7. **Notification hygiene:** Daily earnings and mining referral bonuses do not create notifications. Only investment referral bonuses create notifications (one-time events).

---

## Migration Status: No Pending Broken Migrations

All applied Netlify Database migrations are present on disk with their original content. The `referral_reward_logs` drop/create/drop cycle (migrations `600000` → `700000` → `800000`) is fully resolved — the table no longer exists in Netlify Database. No corrective migrations are needed.

All Supabase migrations are sequential and non-conflicting. The referral trigger has been hardened twice and is in its final form.

---

## Rules for Future Changes

1. **Never use Drizzle queries for referral data.** All referral reads/writes must use the Supabase client.
2. **Never delete or edit applied Netlify Database migrations.** Roll forward with new migrations only.
3. **The `referral_reward_logs` table lives in Supabase only.** Do not recreate it in Netlify Database.
4. **The Drizzle `referrals` table definition in `db/schema.ts` is for migration generation only.** Do not import or query it for referral logic.
5. **Test referral changes with `scripts/test-referral-chain.mts` before deploying.**
6. **Mining reward logs must use `earning_reference_id` (not `investment_id`).** Using `investment_id` for mining rewards causes constraint conflicts with investment rewards.
7. **Reward log insert must happen before wallet/transaction updates.** This ensures duplicate protection cannot be bypassed by partial execution.
8. **Do not add notifications for daily earnings or mining referral bonuses.** Only investment referral bonuses should generate notifications.
9. **Frontend referral stats must go through server functions.** Direct frontend queries to other users' data are blocked by RLS.
10. **Notifications classify their type via `metadata.type`**, not a top-level column on the notifications table.

---

## Confirmed Stable Architecture (2026-05-20)

The earning and referral system is stable. All subsystems — registration referral chains, investment referral rewards, daily earnings, mining referral rewards, team stats, and notifications — are working as designed. No schema changes, migrations, or structural modifications are pending or required.
