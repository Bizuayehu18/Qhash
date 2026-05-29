-- Corrective migration: drop referral_reward_logs from Netlify Database (again).
-- Migration 20260517700000 incorrectly recreated this table.
-- referral_reward_logs lives exclusively in Supabase.

DROP INDEX IF EXISTS "uq_referral_reward_log";
DROP INDEX IF EXISTS "idx_referral_reward_logs_referrer_user";
DROP INDEX IF EXISTS "idx_referral_reward_logs_investment";
DROP INDEX IF EXISTS "idx_referral_reward_logs_referred_user";
DROP TABLE IF EXISTS "referral_reward_logs";
