-- Add missing columns to transactions table
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "balance_before" double precision;
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "balance_after" double precision;
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb;

-- Add plan_purchase to transaction_type enum (code uses this value)
ALTER TYPE "transaction_type" ADD VALUE IF NOT EXISTS 'plan_purchase' BEFORE 'earning';

-- Create profiles table
CREATE TABLE IF NOT EXISTS "profiles" (
  "id" text PRIMARY KEY,
  "username" text NOT NULL UNIQUE,
  "phone" text NOT NULL UNIQUE,
  "referred_by" text,
  "is_admin" boolean DEFAULT false NOT NULL,
  "is_frozen" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Create plans table
CREATE TABLE IF NOT EXISTS "plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "investment_amount" double precision NOT NULL,
  "daily_earning" double precision NOT NULL,
  "duration_days" integer NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Create referrals table
CREATE TABLE IF NOT EXISTS "referrals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "referrer_id" text NOT NULL,
  "referred_user_id" text NOT NULL,
  "level" integer NOT NULL,
  "total_investment_rewards" double precision DEFAULT 0 NOT NULL,
  "total_mining_rewards" double precision DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Create notifications table
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL,
  "title" text NOT NULL,
  "message" text NOT NULL,
  "is_read" boolean DEFAULT false NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Create app_settings table
CREATE TABLE IF NOT EXISTS "app_settings" (
  "key" text PRIMARY KEY,
  "value" text NOT NULL,
  "updated_at" timestamp DEFAULT now()
);

-- Create indexes for referrals
CREATE INDEX IF NOT EXISTS "idx_referrals_referrer_id" ON "referrals" ("referrer_id");
CREATE INDEX IF NOT EXISTS "idx_referrals_referred_user_id" ON "referrals" ("referred_user_id");
CREATE INDEX IF NOT EXISTS "idx_referrals_referred_user_level" ON "referrals" ("referred_user_id", "level");

-- Create indexes for notifications
CREATE INDEX IF NOT EXISTS "idx_notifications_user_id" ON "notifications" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_notifications_user_read" ON "notifications" ("user_id", "is_read");

-- Create index for transactions referral lookups
CREATE INDEX IF NOT EXISTS "idx_transactions_type_reference" ON "transactions" ("type", "reference_id");

-- Seed referral percentage defaults
INSERT INTO "app_settings" ("key", "value") VALUES
  ('investment_referral_level_1_percent', '5'),
  ('investment_referral_level_2_percent', '3'),
  ('investment_referral_level_3_percent', '2')
ON CONFLICT ("key") DO NOTHING;
