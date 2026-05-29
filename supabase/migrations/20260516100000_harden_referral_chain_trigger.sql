-- ==========================================================
-- Harden build_referral_chain trigger
-- Adds ON CONFLICT DO NOTHING to prevent edge-case unique
-- constraint violations from crashing profile creation.
-- Also adds explicit circular-reference guard.
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

  IF l1 = NEW.id THEN
    RETURN NEW;
  END IF;

  INSERT INTO referrals (referrer_id, referred_user_id, level)
    VALUES (l1, NEW.id, 1)
    ON CONFLICT (referrer_id, referred_user_id) DO NOTHING;

  SELECT p.referred_by INTO l2 FROM profiles p WHERE p.id = l1;
  IF l2 IS NOT NULL AND l2 <> NEW.id THEN
    INSERT INTO referrals (referrer_id, referred_user_id, level)
      VALUES (l2, NEW.id, 2)
      ON CONFLICT (referrer_id, referred_user_id) DO NOTHING;

    SELECT p.referred_by INTO l3 FROM profiles p WHERE p.id = l2;
    IF l3 IS NOT NULL AND l3 <> NEW.id THEN
      INSERT INTO referrals (referrer_id, referred_user_id, level)
        VALUES (l3, NEW.id, 3)
        ON CONFLICT (referrer_id, referred_user_id) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
