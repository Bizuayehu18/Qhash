-- ==========================================================
-- Phase 4 stabilization: atomic wallet increment + tx ref uniqueness
-- ==========================================================

BEGIN;

-- Unique constraint on deposit transaction references to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_deposits_unique_tx_ref
  ON deposits (transaction_reference);

-- Atomic wallet balance increment to prevent race conditions
CREATE OR REPLACE FUNCTION increment_wallet_balance(
  p_user_id UUID,
  p_amount  NUMERIC
)
RETURNS TABLE(balance_before NUMERIC, balance_after NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_before NUMERIC;
  v_after  NUMERIC;
BEGIN
  SELECT w.balance INTO v_before
    FROM wallets w
   WHERE w.user_id = p_user_id
     FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO wallets (user_id, balance) VALUES (p_user_id, p_amount);
    RETURN QUERY SELECT 0::NUMERIC, p_amount;
    RETURN;
  END IF;

  v_after := v_before + p_amount;

  UPDATE wallets SET balance = v_after WHERE user_id = p_user_id;

  RETURN QUERY SELECT v_before, v_after;
END;
$$;

COMMIT;
