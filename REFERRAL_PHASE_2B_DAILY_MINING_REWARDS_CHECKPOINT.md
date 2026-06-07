# Referral Phase 2B — Daily Mining Referral Rewards Checkpoint

This document records the **current confirmed stable state** of the Referral Phase 2B
daily mining referral rewards feature. It is a checkpoint only. No code is changed by
this document, and the feature described here must **not** be re-implemented.

## Status

- Referral Phase 2B daily mining referral rewards are **already implemented and verified**.
- **Do not implement this again.**

## Where It Is Implemented

| Concern | File |
|---|---|
| Daily earnings scheduler | `netlify/functions/daily-earnings.mts` |
| Manual / admin trigger | `netlify/functions/trigger-daily-earnings.mts` |
| Main processing flow | `netlify/functions/lib/process-all-earnings.mts` |
| Mining referral rewards | `netlify/functions/lib/process-mining-referral-rewards.mts` |
| Investment referral rewards (separate) | `src/lib/server/referral-rewards.ts` |

Investment referral rewards remain **separate** from mining referral rewards and are not
part of this phase.

## Behavior

- Normal daily mining earnings create transactions with `type = "earning"`.
- Mining referral rewards create transactions with `type = "referral_daily_bonus"`.
- Referral reward logs use `reward_type = "mining"`.
- The referral percentages are loaded from `app_settings`:
  - `mining_referral_level_1_percent`
  - `mining_referral_level_2_percent`
  - `mining_referral_level_3_percent`
- Current settings:
  - **Level 1 = 5%**
  - **Level 2 = 3%**
  - **Level 3 = 2%**
- Only **active investors** can earn mining referral rewards.
- Inactive uplines are **skipped**.
- Skipping an inactive upline **does not break upper levels** — reward continuation proceeds
  to higher levels regardless of a lower upline being inactive.
- Rewards are credited **directly to referrer wallets**.
- `referrals.total_mining_rewards` is updated.
- `referral_reward_logs` rows are inserted.
- **Duplicate protection** uses `earning_reference_id`, so the same earning transaction is
  never rewarded twice.

## Supabase Verification Evidence

- The `transaction_type` enum includes `referral_daily_bonus`.
- Recent normal mining earnings exist as `type = "earning"`.
- Recent mining referral bonus transactions exist as `type = "referral_daily_bonus"`.
- Recent `referral_reward_logs` rows exist with `reward_type = "mining"`.
- Example verified math:

  | Item | Amount | Percent |
  |---|---|---|
  | Source earning amount | 230 | — |
  | Level 1 reward | 11.5 | 5% |
  | Level 2 reward | 6.9 | 3% |
  | Level 3 reward | 4.6 | 2% |

## Guardrails

- Do **not** reimplement daily mining referral rewards.
- Do **not** create duplicate reward logic in `src/lib/server/referral-rewards.ts`.
- Do **not** change investment referral reward logic while working on mining rewards.
- Do **not** remove duplicate protection by `earning_reference_id`.
- Do **not** reward inactive uplines.
- Do **not** stop upper-level reward continuation when a lower upline is inactive.
- Do **not** use transaction type `referral_reward` for mining rewards; use
  `referral_daily_bonus`.
- Do **not** modify deposit / CBE / TeleBirr / payment-method logic from this phase.

## Completed Follow-up Hardening

- `trigger-daily-earnings.mts` now checks `is_frozen` for admins before manual trigger
  execution.
- Frozen admins are rejected with `{ error: "admin_frozen", message: "Admin account is frozen." }`
  and HTTP `403`.
- This hardening was completed after this checkpoint as a separate small phase.
- The scheduled daily earnings function was not changed.
- The shared earnings-processing flow was not changed.
- The mining referral reward logic was not changed.
