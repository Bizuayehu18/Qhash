-- Add unique constraint and self-referral check to referrals table.
-- Uses conditional blocks so this is safe to run whether or not the
-- constraints were already applied by the CREATE TABLE migration.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_referral_pair') THEN
    ALTER TABLE "referrals"
      ADD CONSTRAINT "uq_referral_pair" UNIQUE ("referrer_id", "referred_user_id");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_no_self_refer') THEN
    ALTER TABLE "referrals"
      ADD CONSTRAINT "chk_no_self_refer" CHECK ("referrer_id" <> "referred_user_id");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_level_range') THEN
    ALTER TABLE "referrals"
      ADD CONSTRAINT "chk_level_range" CHECK ("level" >= 1 AND "level" <= 3);
  END IF;
END $$;
