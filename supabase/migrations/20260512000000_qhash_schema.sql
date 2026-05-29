-- ==========================================================
-- QHash — Complete Production Schema
-- Generated: 2026-05-12
-- Target: Supabase PostgreSQL (with auth.users, auth.uid())
-- ==========================================================

BEGIN;

-- ----------------------------------------------------------
-- 1. CUSTOM ENUM TYPES
-- ----------------------------------------------------------

CREATE TYPE investment_status    AS ENUM ('active', 'completed', 'cancelled');
CREATE TYPE transaction_type     AS ENUM ('deposit', 'withdrawal', 'plan_purchase', 'earning', 'referral_reward', 'admin_adjustment');
CREATE TYPE transaction_status   AS ENUM ('pending', 'completed', 'failed');
CREATE TYPE deposit_status       AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE withdrawal_status    AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE payment_method_type  AS ENUM ('cbe', 'telebirr');

-- ----------------------------------------------------------
-- 2. UTILITY FUNCTIONS
-- ----------------------------------------------------------

CREATE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------
-- 3. PROFILES
-- ----------------------------------------------------------

CREATE TABLE profiles (
  id          UUID        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  username    TEXT        NOT NULL UNIQUE CHECK (char_length(username) >= 3),
  phone       TEXT        NOT NULL UNIQUE,
  full_name   TEXT,
  referred_by UUID        REFERENCES profiles (id) ON DELETE SET NULL,
  is_admin    BOOLEAN     NOT NULL DEFAULT FALSE,
  is_frozen   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_username    ON profiles (username);
CREATE INDEX idx_profiles_phone       ON profiles (phone);
CREATE INDEX idx_profiles_referred_by ON profiles (referred_by) WHERE referred_by IS NOT NULL;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Admin helper — SECURITY DEFINER avoids RLS recursion on profiles
CREATE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN COALESCE(
    (SELECT p.is_admin FROM profiles p WHERE p.id = auth.uid()),
    FALSE
  );
END;
$$;

CREATE POLICY profiles_select_own   ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY profiles_select_admin ON profiles FOR SELECT USING (is_admin());
CREATE POLICY profiles_insert_own   ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY profiles_update_own   ON profiles FOR UPDATE USING (auth.uid() = id AND NOT is_frozen);
CREATE POLICY profiles_update_admin ON profiles FOR UPDATE USING (is_admin());
CREATE POLICY profiles_delete_admin ON profiles FOR DELETE USING (is_admin());

CREATE FUNCTION protect_profile_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_admin() THEN
    NEW.is_admin    := OLD.is_admin;
    NEW.is_frozen   := OLD.is_frozen;
    NEW.referred_by := OLD.referred_by;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_profile_fields
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION protect_profile_fields();

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------
-- 4. WALLETS (one per user, realtime-enabled)
-- ----------------------------------------------------------

CREATE TABLE wallets (
  user_id    UUID           PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,
  balance    NUMERIC(18, 2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
  created_at TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ    NOT NULL DEFAULT now()
);

ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY wallets_select_own   ON wallets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY wallets_select_admin ON wallets FOR SELECT USING (is_admin());
CREATE POLICY wallets_update_admin ON wallets FOR UPDATE USING (is_admin());

CREATE TRIGGER trg_wallets_updated_at
  BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE wallets;

CREATE FUNCTION handle_new_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO wallets (user_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_create_wallet
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION handle_new_profile();

-- ----------------------------------------------------------
-- 5. PLANS
-- ----------------------------------------------------------

CREATE TABLE plans (
  id                UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT           NOT NULL UNIQUE,
  investment_amount NUMERIC(18, 2) NOT NULL CHECK (investment_amount > 0),
  daily_earning     NUMERIC(18, 2) NOT NULL CHECK (daily_earning > 0),
  duration_days     INTEGER        NOT NULL CHECK (duration_days > 0),
  is_active         BOOLEAN        NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ    NOT NULL DEFAULT now()
);

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY plans_select        ON plans FOR SELECT USING (is_active OR is_admin());
CREATE POLICY plans_insert_admin  ON plans FOR INSERT WITH CHECK (is_admin());
CREATE POLICY plans_update_admin  ON plans FOR UPDATE USING (is_admin());
CREATE POLICY plans_delete_admin  ON plans FOR DELETE USING (is_admin());

CREATE TRIGGER trg_plans_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------
-- 6. INVESTMENTS
-- ----------------------------------------------------------

CREATE TABLE investments (
  id              UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID              NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  plan_id         UUID              NOT NULL REFERENCES plans (id),
  invested_amount NUMERIC(18, 2)    NOT NULL CHECK (invested_amount > 0),
  daily_earning   NUMERIC(18, 2)    NOT NULL CHECK (daily_earning > 0),
  duration_days   INTEGER           NOT NULL CHECK (duration_days > 0),
  total_earned    NUMERIC(18, 2)    NOT NULL DEFAULT 0.00 CHECK (total_earned >= 0),
  days_earned     INTEGER           NOT NULL DEFAULT 0,
  status          investment_status NOT NULL DEFAULT 'active',
  start_date      DATE              NOT NULL DEFAULT CURRENT_DATE,
  end_date        DATE              NOT NULL,
  last_earning_at TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ       NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ       NOT NULL DEFAULT now(),

  CONSTRAINT chk_days_earned    CHECK (days_earned >= 0 AND days_earned <= duration_days),
  CONSTRAINT chk_end_after_start CHECK (end_date >= start_date)
);

CREATE INDEX idx_investments_user        ON investments (user_id);
CREATE INDEX idx_investments_user_status ON investments (user_id, status);
CREATE INDEX idx_investments_active_end  ON investments (end_date) WHERE status = 'active';

ALTER TABLE investments ENABLE ROW LEVEL SECURITY;

CREATE POLICY investments_select_own   ON investments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY investments_select_admin ON investments FOR SELECT USING (is_admin());
CREATE POLICY investments_insert_admin ON investments FOR INSERT WITH CHECK (is_admin());
CREATE POLICY investments_update_admin ON investments FOR UPDATE USING (is_admin());

CREATE TRIGGER trg_investments_updated_at
  BEFORE UPDATE ON investments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------
-- 7. TRANSACTIONS
-- ----------------------------------------------------------

CREATE TABLE transactions (
  id             UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID               NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  type           transaction_type   NOT NULL,
  amount         NUMERIC(18, 2)     NOT NULL CHECK (amount > 0),
  status         transaction_status NOT NULL DEFAULT 'completed',
  balance_before NUMERIC(18, 2),
  balance_after  NUMERIC(18, 2),
  description    TEXT,
  reference_id   UUID,
  metadata       JSONB              NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ        NOT NULL DEFAULT now()
);

CREATE INDEX idx_transactions_user         ON transactions (user_id);
CREATE INDEX idx_transactions_user_created ON transactions (user_id, created_at DESC);
CREATE INDEX idx_transactions_user_type    ON transactions (user_id, type);
CREATE INDEX idx_transactions_reference    ON transactions (reference_id) WHERE reference_id IS NOT NULL;

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY transactions_select_own   ON transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY transactions_select_admin ON transactions FOR SELECT USING (is_admin());
CREATE POLICY transactions_insert_admin ON transactions FOR INSERT WITH CHECK (is_admin());

-- ----------------------------------------------------------
-- 8. REFERRALS (3-level: 5% / 3% / 2%)
-- ----------------------------------------------------------

CREATE TABLE referrals (
  id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id      UUID           NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  referred_user_id UUID           NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  level            SMALLINT       NOT NULL CHECK (level BETWEEN 1 AND 3),
  total_rewarded   NUMERIC(18, 2) NOT NULL DEFAULT 0.00 CHECK (total_rewarded >= 0),
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT now(),

  CONSTRAINT uq_referral_pair  UNIQUE (referrer_id, referred_user_id),
  CONSTRAINT chk_no_self_refer CHECK  (referrer_id <> referred_user_id)
);

CREATE INDEX idx_referrals_referrer ON referrals (referrer_id);
CREATE INDEX idx_referrals_referred ON referrals (referred_user_id);

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY referrals_select_own   ON referrals FOR SELECT USING (auth.uid() = referrer_id);
CREATE POLICY referrals_select_admin ON referrals FOR SELECT USING (is_admin());
CREATE POLICY referrals_insert_admin ON referrals FOR INSERT WITH CHECK (is_admin());

CREATE FUNCTION build_referral_chain()
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
  INSERT INTO referrals (referrer_id, referred_user_id, level)
    VALUES (l1, NEW.id, 1);

  SELECT p.referred_by INTO l2 FROM profiles p WHERE p.id = l1;
  IF l2 IS NOT NULL THEN
    INSERT INTO referrals (referrer_id, referred_user_id, level)
      VALUES (l2, NEW.id, 2);

    SELECT p.referred_by INTO l3 FROM profiles p WHERE p.id = l2;
    IF l3 IS NOT NULL THEN
      INSERT INTO referrals (referrer_id, referred_user_id, level)
        VALUES (l3, NEW.id, 3);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_build_referral_chain
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION build_referral_chain();

-- ----------------------------------------------------------
-- 9. PAYMENT METHODS (admin-managed)
-- ----------------------------------------------------------

CREATE TABLE payment_methods (
  id             UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  type           payment_method_type NOT NULL,
  account_name   TEXT                NOT NULL,
  account_number TEXT                NOT NULL,
  instructions   TEXT,
  is_active      BOOLEAN             NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ         NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ         NOT NULL DEFAULT now(),

  CONSTRAINT uq_payment_method UNIQUE (type, account_number)
);

ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_methods_select       ON payment_methods FOR SELECT USING (is_active OR is_admin());
CREATE POLICY payment_methods_insert_admin ON payment_methods FOR INSERT WITH CHECK (is_admin());
CREATE POLICY payment_methods_update_admin ON payment_methods FOR UPDATE USING (is_admin());
CREATE POLICY payment_methods_delete_admin ON payment_methods FOR DELETE USING (is_admin());

CREATE TRIGGER trg_payment_methods_updated_at
  BEFORE UPDATE ON payment_methods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------
-- 10. DEPOSITS
-- ----------------------------------------------------------

CREATE TABLE deposits (
  id                    UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID           NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  payment_method_id     UUID           NOT NULL REFERENCES payment_methods (id),
  amount                NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
  status                deposit_status NOT NULL DEFAULT 'pending',
  transaction_reference TEXT           NOT NULL,
  payer_name            TEXT,
  payer_phone           TEXT,
  proof_url             TEXT,
  admin_note            TEXT,
  reviewed_by           UUID           REFERENCES profiles (id),
  reviewed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX idx_deposits_user        ON deposits (user_id);
CREATE INDEX idx_deposits_user_status ON deposits (user_id, status);
CREATE INDEX idx_deposits_status      ON deposits (status, created_at DESC);

ALTER TABLE deposits ENABLE ROW LEVEL SECURITY;

CREATE POLICY deposits_select_own   ON deposits FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY deposits_select_admin ON deposits FOR SELECT USING (is_admin());
CREATE POLICY deposits_insert_own   ON deposits FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY deposits_update_admin ON deposits FOR UPDATE USING (is_admin());

CREATE TRIGGER trg_deposits_updated_at
  BEFORE UPDATE ON deposits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------
-- 11. WITHDRAWALS
-- ----------------------------------------------------------

CREATE TABLE withdrawals (
  id             UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID                NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  amount         NUMERIC(18, 2)      NOT NULL CHECK (amount > 0),
  method         payment_method_type NOT NULL,
  account_name   TEXT                NOT NULL,
  account_number TEXT                NOT NULL,
  phone          TEXT,
  status         withdrawal_status   NOT NULL DEFAULT 'pending',
  admin_note     TEXT,
  reviewed_by    UUID                REFERENCES profiles (id),
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ         NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ         NOT NULL DEFAULT now()
);

CREATE INDEX idx_withdrawals_user        ON withdrawals (user_id);
CREATE INDEX idx_withdrawals_user_status ON withdrawals (user_id, status);
CREATE INDEX idx_withdrawals_status      ON withdrawals (status, created_at DESC);

ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;

CREATE POLICY withdrawals_select_own   ON withdrawals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY withdrawals_select_admin ON withdrawals FOR SELECT USING (is_admin());
CREATE POLICY withdrawals_insert_own   ON withdrawals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY withdrawals_update_admin ON withdrawals FOR UPDATE USING (is_admin());

CREATE TRIGGER trg_withdrawals_updated_at
  BEFORE UPDATE ON withdrawals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------
-- 12. APP SETTINGS
-- ----------------------------------------------------------

CREATE TABLE app_settings (
  key         TEXT        PRIMARY KEY,
  value       TEXT        NOT NULL,
  description TEXT,
  updated_by  UUID        REFERENCES profiles (id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_settings_select       ON app_settings FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY app_settings_insert_admin ON app_settings FOR INSERT WITH CHECK (is_admin());
CREATE POLICY app_settings_update_admin ON app_settings FOR UPDATE USING (is_admin());
CREATE POLICY app_settings_delete_admin ON app_settings FOR DELETE USING (is_admin());

CREATE TRIGGER trg_app_settings_updated_at
  BEFORE UPDATE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------
-- 13. DEPOSIT / WITHDRAWAL PAUSE ENFORCEMENT
-- ----------------------------------------------------------

CREATE FUNCTION ensure_deposits_open()
RETURNS TRIGGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
  IF (SELECT s.value = 'true' FROM app_settings s WHERE s.key = 'deposits_paused') THEN
    RAISE EXCEPTION 'Deposits are currently paused';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_deposits_require_open
  BEFORE INSERT ON deposits
  FOR EACH ROW EXECUTE FUNCTION ensure_deposits_open();

CREATE FUNCTION ensure_withdrawals_open()
RETURNS TRIGGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
  IF (SELECT s.value = 'true' FROM app_settings s WHERE s.key = 'withdrawals_paused') THEN
    RAISE EXCEPTION 'Withdrawals are currently paused';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_withdrawals_require_open
  BEFORE INSERT ON withdrawals
  FOR EACH ROW EXECUTE FUNCTION ensure_withdrawals_open();

-- ----------------------------------------------------------
-- 14. SEED DATA: PLANS
-- ----------------------------------------------------------

INSERT INTO plans (name, investment_amount, daily_earning, duration_days) VALUES
  ('Starter',      500,   20,   150),
  ('Basic',        1000,  42,   180),
  ('Standard',     3000,  132,  210),
  ('Advanced',     5000,  230,  240),
  ('Professional', 10000, 480,  270),
  ('Elite',        30000, 1500, 360);

-- ----------------------------------------------------------
-- 15. SEED DATA: APP SETTINGS
-- ----------------------------------------------------------

INSERT INTO app_settings (key, value, description) VALUES
  ('deposits_paused',          'false', 'Pause all new deposit requests'),
  ('withdrawals_paused',       'false', 'Pause all new withdrawal requests'),
  ('referral_level_1_percent', '5',     'Level 1 referral reward percentage'),
  ('referral_level_2_percent', '3',     'Level 2 referral reward percentage'),
  ('referral_level_3_percent', '2',     'Level 3 referral reward percentage'),
  ('min_deposit_amount',       '100',   'Minimum deposit amount in ETB'),
  ('min_withdrawal_amount',    '100',   'Minimum withdrawal amount in ETB');

COMMIT;
