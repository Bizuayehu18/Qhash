-- ==========================================================
-- Atomic plan purchase RPC
-- Wraps the entire purchase flow in a single transaction:
--   validate plan → lock wallet → verify balance → deduct →
--   create investment → create transaction (with balance audit)
-- Prevents race conditions, double-spend, and partial writes.
-- ==========================================================

BEGIN;

CREATE OR REPLACE FUNCTION purchase_plan_tx(
  p_user_id  UUID,
  p_plan_id  UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_plan            RECORD;
  v_balance_before  NUMERIC;
  v_balance_after   NUMERIC;
  v_investment_id   UUID;
  v_tx_id           UUID;
  v_start_date      TIMESTAMPTZ;
  v_end_date        TIMESTAMPTZ;
  v_user_exists     BOOLEAN;
BEGIN
  -- 1. Validate that the user exists and is not frozen
  SELECT EXISTS(
    SELECT 1 FROM profiles
     WHERE id = p_user_id
       AND NOT is_frozen
  ) INTO v_user_exists;

  IF NOT v_user_exists THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'invalid_user',
      'message', 'User not found or account is frozen.'
    );
  END IF;

  -- 2. Fetch plan and validate it is active
  SELECT id, name, investment_amount, daily_earning, duration_days
    INTO v_plan
    FROM plans
   WHERE id = p_plan_id
     AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'plan_not_found',
      'message', 'Plan not found or no longer available.'
    );
  END IF;

  -- 3. Lock wallet row to prevent concurrent balance mutations
  SELECT balance INTO v_balance_before
    FROM wallets
   WHERE user_id = p_user_id
     FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO wallets (user_id, balance) VALUES (p_user_id, 0);
    v_balance_before := 0;
  END IF;

  -- 4. Verify sufficient balance
  IF v_balance_before < v_plan.investment_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'insufficient_balance',
      'message', 'Insufficient balance. Please deposit funds first.',
      'required', v_plan.investment_amount,
      'available', v_balance_before
    );
  END IF;

  -- 5. Deduct balance atomically
  v_balance_after := v_balance_before - v_plan.investment_amount;

  UPDATE wallets
     SET balance    = v_balance_after,
         updated_at = now()
   WHERE user_id = p_user_id;

  -- 6. Create investment
  v_start_date := now();
  v_end_date   := v_start_date + (v_plan.duration_days || ' days')::INTERVAL;

  INSERT INTO investments (
    user_id, plan_id, invested_amount, daily_earning,
    start_date, end_date, last_earning_at, status
  ) VALUES (
    p_user_id, p_plan_id, v_plan.investment_amount, v_plan.daily_earning,
    v_start_date, v_end_date, v_start_date, 'active'
  )
  RETURNING id INTO v_investment_id;

  -- 7. Create transaction record with full audit trail
  INSERT INTO transactions (
    user_id, type, amount, status,
    balance_before, balance_after,
    description, reference_id
  ) VALUES (
    p_user_id,
    'plan_purchase',
    v_plan.investment_amount,
    'completed',
    v_balance_before,
    v_balance_after,
    'Purchased ' || v_plan.name,
    v_investment_id
  )
  RETURNING id INTO v_tx_id;

  -- 8. Return success with full details
  RETURN jsonb_build_object(
    'success', true,
    'investment_id', v_investment_id,
    'transaction_id', v_tx_id,
    'plan_name', v_plan.name,
    'invested_amount', v_plan.investment_amount,
    'daily_earning', v_plan.daily_earning,
    'duration_days', v_plan.duration_days,
    'start_date', v_start_date,
    'end_date', v_end_date,
    'balance_before', v_balance_before,
    'balance_after', v_balance_after
  );
END;
$$;

GRANT EXECUTE ON FUNCTION purchase_plan_tx(UUID, UUID) TO service_role;

COMMIT;
