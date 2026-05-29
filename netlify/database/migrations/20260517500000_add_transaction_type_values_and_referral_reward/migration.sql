-- Add back transaction_type enum values removed by earlier migration
ALTER TYPE "transaction_type" ADD VALUE IF NOT EXISTS 'plan_purchase';
ALTER TYPE "transaction_type" ADD VALUE IF NOT EXISTS 'referral_investment_bonus';
ALTER TYPE "transaction_type" ADD VALUE IF NOT EXISTS 'referral_daily_bonus';

-- Create referral_reward_logs table for duplicate prevention and audit trail
CREATE TABLE IF NOT EXISTS "referral_reward_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "investment_id" text NOT NULL,
  "referrer_id" text NOT NULL,
  "referred_user_id" text NOT NULL,
  "level" integer NOT NULL,
  "reward_type" text NOT NULL,
  "reward_amount" double precision NOT NULL,
  "percentage_used" double precision NOT NULL,
  "investment_amount" double precision NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Unique constraint to prevent duplicate rewards
CREATE UNIQUE INDEX IF NOT EXISTS "uq_referral_reward_log"
  ON "referral_reward_logs" ("investment_id", "referrer_id", "level", "reward_type");

-- Indexes for lookups
CREATE INDEX IF NOT EXISTS "idx_referral_reward_logs_referrer"
  ON "referral_reward_logs" ("referrer_id");
CREATE INDEX IF NOT EXISTS "idx_referral_reward_logs_investment"
  ON "referral_reward_logs" ("investment_id");
CREATE INDEX IF NOT EXISTS "idx_referral_reward_logs_referred_user"
  ON "referral_reward_logs" ("referred_user_id");
