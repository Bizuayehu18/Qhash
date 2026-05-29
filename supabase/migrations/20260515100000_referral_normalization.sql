-- ==========================================================
-- QHash — Referral Database Normalization
-- Generated: 2026-05-15
-- Purpose: Separate investment and mining referral subsystems
-- Safety: Non-destructive, additive only — no columns or
--         data removed, all existing referral chains preserved
-- ==========================================================

BEGIN;

-- ----------------------------------------------------------
-- 1. EXTEND transaction_type ENUM
-- ----------------------------------------------------------
-- Two new values distinguish investment-purchase referral
-- bonuses from daily-mining referral bonuses.
-- The legacy 'referral_reward' value is intentionally kept.

ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'referral_investment_bonus';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'referral_daily_bonus';

-- ----------------------------------------------------------
-- 2. ADD SEPARATED REWARD TRACKING TO referrals TABLE
-- ----------------------------------------------------------
-- Granular tracking columns alongside the existing
-- total_rewarded column (which remains untouched).

ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS total_investment_rewards NUMERIC(18, 2) NOT NULL DEFAULT 0.00;

ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS total_mining_rewards NUMERIC(18, 2) NOT NULL DEFAULT 0.00;

ALTER TABLE referrals
  ADD CONSTRAINT chk_total_investment_rewards_non_neg
    CHECK (total_investment_rewards >= 0);

ALTER TABLE referrals
  ADD CONSTRAINT chk_total_mining_rewards_non_neg
    CHECK (total_mining_rewards >= 0);

-- ----------------------------------------------------------
-- 3. ADD SEPARATED APP SETTINGS
-- ----------------------------------------------------------
-- New setting keys for each referral subsystem.
-- Uses the same 5 / 3 / 2 percentages as the current
-- unified settings. Old keys are preserved.

INSERT INTO app_settings (key, value, description) VALUES
  ('investment_referral_level_1_percent', '5', 'Level 1 referral bonus percentage on investment purchases'),
  ('investment_referral_level_2_percent', '3', 'Level 2 referral bonus percentage on investment purchases'),
  ('investment_referral_level_3_percent', '2', 'Level 3 referral bonus percentage on investment purchases'),
  ('mining_referral_level_1_percent',     '5', 'Level 1 referral bonus percentage on daily mining earnings'),
  ('mining_referral_level_2_percent',     '3', 'Level 2 referral bonus percentage on daily mining earnings'),
  ('mining_referral_level_3_percent',     '2', 'Level 3 referral bonus percentage on daily mining earnings')
ON CONFLICT (key) DO NOTHING;

COMMIT;
