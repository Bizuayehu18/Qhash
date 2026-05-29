-- Recreate referral_reward_logs with corrected schema.
-- Previous version was dropped in 20260517600000.

CREATE TABLE IF NOT EXISTS "referral_reward_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "investment_id" text,
  "earning_reference_id" text,
  "purchaser_user_id" text,
  "earner_user_id" text,
  "referrer_user_id" text NOT NULL,
  "referred_user_id" text NOT NULL,
  "level" integer NOT NULL,
  "reward_type" text NOT NULL,
  "reward_amount" double precision NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_referral_reward_logs_referrer_user"
  ON "referral_reward_logs" ("referrer_user_id");
CREATE INDEX IF NOT EXISTS "idx_referral_reward_logs_investment"
  ON "referral_reward_logs" ("investment_id");
CREATE INDEX IF NOT EXISTS "idx_referral_reward_logs_referred_user"
  ON "referral_reward_logs" ("referred_user_id");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_referral_reward_log"
  ON "referral_reward_logs" ("investment_id", "referrer_user_id", "level", "reward_type");
