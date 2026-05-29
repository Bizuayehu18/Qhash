-- Corrective migration: drop referral_reward_logs from Netlify Database.
-- Referral data is managed exclusively in Supabase.
-- The table was incorrectly created here by migration 20260517500000.

DROP INDEX IF EXISTS "uq_referral_reward_log";
DROP INDEX IF EXISTS "idx_referral_reward_logs_referrer";
DROP INDEX IF EXISTS "idx_referral_reward_logs_investment";
DROP INDEX IF EXISTS "idx_referral_reward_logs_referred_user";
DROP TABLE IF EXISTS "referral_reward_logs";
