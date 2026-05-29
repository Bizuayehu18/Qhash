-- ==========================================================
-- Harden build_referral_chain: exception handling + logging
--
-- Wraps all referral chain logic in an EXCEPTION block so
-- that a trigger failure can NEVER prevent profile creation.
-- Adds RAISE LOG at every step for observability.
-- Adds extra circular-reference guards (l2<>l1, l3<>l1, l3<>l2).
-- ==========================================================

BEGIN;

CREATE OR REPLACE FUNCTION build_referral_chain()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  l1 UUID;
  l2 UUID;
  l3 UUID;
BEGIN
  IF NEW.referred_by IS NULL THEN
    RETURN NEW;
  END IF;

  l1 := NEW.referred_by;

  -- Self-referral guard
  IF l1 = NEW.id THEN
    RAISE LOG '[QHash Referral] Self-referral blocked: user=%', NEW.id;
    RETURN NEW;
  END IF;

  RAISE LOG '[QHash Referral] Building chain: user=% referred_by=%', NEW.id, l1;

  -- Level 1: direct referrer
  INSERT INTO referrals (referrer_id, referred_user_id, level)
    VALUES (l1, NEW.id, 1)
    ON CONFLICT (referrer_id, referred_user_id) DO NOTHING;
  RAISE LOG '[QHash Referral] L1 done: referrer=% referred=%', l1, NEW.id;

  -- Level 2: referrer's referrer
  SELECT p.referred_by INTO l2 FROM profiles p WHERE p.id = l1;
  IF l2 IS NOT NULL AND l2 <> NEW.id AND l2 <> l1 THEN
    INSERT INTO referrals (referrer_id, referred_user_id, level)
      VALUES (l2, NEW.id, 2)
      ON CONFLICT (referrer_id, referred_user_id) DO NOTHING;
    RAISE LOG '[QHash Referral] L2 done: referrer=% referred=%', l2, NEW.id;

    -- Level 3: referrer's referrer's referrer
    SELECT p.referred_by INTO l3 FROM profiles p WHERE p.id = l2;
    IF l3 IS NOT NULL AND l3 <> NEW.id AND l3 <> l1 AND l3 <> l2 THEN
      INSERT INTO referrals (referrer_id, referred_user_id, level)
        VALUES (l3, NEW.id, 3)
        ON CONFLICT (referrer_id, referred_user_id) DO NOTHING;
      RAISE LOG '[QHash Referral] L3 done: referrer=% referred=%', l3, NEW.id;
    ELSE
      RAISE LOG '[QHash Referral] L3 skipped: l3=% (null or circular)', l3;
    END IF;
  ELSE
    RAISE LOG '[QHash Referral] L2 skipped: l2=% (null or circular)', l2;
  END IF;

  RAISE LOG '[QHash Referral] Chain complete: user=%', NEW.id;
  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  RAISE LOG '[QHash Referral] ERROR user=%: % (SQLSTATE=%)', NEW.id, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$;

COMMIT;
