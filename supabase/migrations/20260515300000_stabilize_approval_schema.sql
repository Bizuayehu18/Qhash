-- ==========================================================
-- Stabilize admin approval: ensure schema + RPC are correct
--
-- Fixes:
--   1. transactions table may lack balance_before, balance_after,
--      metadata columns if earlier schema migration was partial.
--   2. approve_deposit_tx lacked GRANT EXECUTE to service_role.
--   3. RPC had no EXCEPTION handler — a failing INSERT left no
--      diagnostic info and auto-rolled-back silently.
-- ==========================================================

-- Column additions are DDL and safe outside a transaction block.
-- ADD COLUMN IF NOT EXISTS is idempotent.

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS balance_before NUMERIC(18, 2);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS balance_after  NUMERIC(18, 2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'transactions' AND column_name = 'metadata'
  ) THEN
    ALTER TABLE transactions ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}';
  END IF;
END;
$$;

-- Ensure referral enum values exist (idempotent, required outside txn)
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'referral_investment_bonus';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'referral_daily_bonus';

-- Now wrap the function replacement in a transaction
BEGIN;

-- Drop ALL known signatures so CREATE OR REPLACE starts clean
DROP FUNCTION IF EXISTS approve_deposit_tx(UUID, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS approve_deposit_tx(UUID, UUID, TEXT, TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION approve_deposit_tx(
  p_deposit_id   UUID,
  p_admin_id     UUID,
  p_action       TEXT,
  p_admin_note   TEXT    DEFAULT NULL,
  p_amount       NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deposit        RECORD;
  v_admin          RECORD;
  v_final_amount   NUMERIC;
  v_balance_before NUMERIC;
  v_balance_after  NUMERIC;
  v_new_status     deposit_status;
  v_tx_id          UUID;
  v_notif_id       UUID;
  v_step           TEXT := 'init';
BEGIN
  -- 1. Verify admin
  v_step := 'admin_auth';
  SELECT id, is_admin, is_frozen
    INTO v_admin
    FROM profiles
   WHERE id = p_admin_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'admin_not_found',
      'message', 'Admin profile not found.', 'step', v_step);
  END IF;

  IF NOT v_admin.is_admin THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_admin',
      'message', 'User is not an admin.', 'step', v_step);
  END IF;

  IF v_admin.is_frozen THEN
    RETURN jsonb_build_object('success', false, 'error', 'admin_frozen',
      'message', 'Admin account is frozen.', 'step', v_step);
  END IF;

  -- 2. Validate action
  v_step := 'validate_action';
  IF p_action NOT IN ('approve', 'reject') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_action',
      'message', 'Action must be approve or reject.', 'step', v_step);
  END IF;

  v_new_status := CASE WHEN p_action = 'approve' THEN 'approved'::deposit_status
                       ELSE 'rejected'::deposit_status END;

  -- 3. Fetch and lock deposit row
  v_step := 'deposit_fetch';
  SELECT *
    INTO v_deposit
    FROM deposits
   WHERE id = p_deposit_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'deposit_not_found',
      'message', 'Deposit record not found.', 'step', v_step);
  END IF;

  -- 4. Pending status validation
  v_step := 'pending_check';
  IF v_deposit.status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_reviewed',
      'message', format('Deposit already %s.', v_deposit.status), 'step', v_step);
  END IF;

  -- 5. Resolve final amount: admin override > deposit amount
  v_step := 'amount_resolve';
  v_final_amount := COALESCE(NULLIF(p_amount, 0), NULLIF(v_deposit.amount, 0));

  IF p_action = 'approve' AND (v_final_amount IS NULL OR v_final_amount <= 0) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_amount',
      'message', 'Deposit amount is required for approval. Enter the verified amount from the receipt.',
      'step', v_step);
  END IF;

  -- 6. Update deposit status (and amount if admin provided override)
  v_step := 'deposit_status_update';
  UPDATE deposits
     SET status      = v_new_status,
         amount      = CASE WHEN p_action = 'approve' THEN v_final_amount ELSE amount END,
         admin_note  = p_admin_note,
         reviewed_by = p_admin_id,
         reviewed_at = now(),
         updated_at  = now()
   WHERE id = p_deposit_id;

  -- 7. If approving: credit wallet, create transaction, notify
  IF p_action = 'approve' THEN

    -- 7a. Lock and update wallet
    v_step := 'wallet_lookup';
    SELECT balance INTO v_balance_before
      FROM wallets
     WHERE user_id = v_deposit.user_id
       FOR UPDATE;

    IF NOT FOUND THEN
      v_step := 'wallet_create';
      INSERT INTO wallets (user_id, balance) VALUES (v_deposit.user_id, v_final_amount);
      v_balance_before := 0;
      v_balance_after  := v_final_amount;
    ELSE
      v_step := 'wallet_update';
      v_balance_after := v_balance_before + v_final_amount;
      UPDATE wallets
         SET balance    = v_balance_after,
             updated_at = now()
       WHERE user_id = v_deposit.user_id;
    END IF;

    -- 7b. Create transaction record
    v_step := 'transaction_insert';
    INSERT INTO transactions (user_id, type, amount, status, balance_before, balance_after, description, reference_id)
    VALUES (
      v_deposit.user_id,
      'deposit',
      v_final_amount,
      'completed',
      v_balance_before,
      v_balance_after,
      'Deposit via ' || v_deposit.transaction_reference,
      v_deposit.id
    )
    RETURNING id INTO v_tx_id;

    -- 7c. Create notification
    v_step := 'notification_insert';
    INSERT INTO notifications (user_id, type, title, message, metadata)
    VALUES (
      v_deposit.user_id,
      'deposit_approved',
      'Deposit Approved',
      format('Your deposit of %s ETB has been approved and credited to your wallet.', v_final_amount),
      jsonb_build_object('deposit_id', v_deposit.id)
    )
    RETURNING id INTO v_notif_id;

    v_step := 'done';
    RETURN jsonb_build_object(
      'success', true,
      'status', 'approved',
      'deposit_id', v_deposit.id,
      'user_id', v_deposit.user_id,
      'amount', v_final_amount,
      'balance_before', v_balance_before,
      'balance_after', v_balance_after,
      'transaction_id', v_tx_id,
      'notification_id', v_notif_id
    );

  ELSE
    -- 8. Rejection: just notify
    v_step := 'rejection_notification';
    INSERT INTO notifications (user_id, type, title, message, metadata)
    VALUES (
      v_deposit.user_id,
      'deposit_rejected',
      'Deposit Rejected',
      CASE
        WHEN p_admin_note IS NOT NULL AND p_admin_note != ''
        THEN format('Your deposit of %s ETB was rejected. Reason: %s',
             GREATEST(COALESCE(v_final_amount, 0), v_deposit.amount), p_admin_note)
        WHEN GREATEST(COALESCE(v_final_amount, 0), v_deposit.amount) > 0
        THEN format('Your deposit of %s ETB was rejected.',
             GREATEST(COALESCE(v_final_amount, 0), v_deposit.amount))
        ELSE 'Your deposit was rejected.'
      END,
      jsonb_build_object('deposit_id', v_deposit.id)
    )
    RETURNING id INTO v_notif_id;

    v_step := 'done';
    RETURN jsonb_build_object(
      'success', true,
      'status', 'rejected',
      'deposit_id', v_deposit.id,
      'user_id', v_deposit.user_id,
      'notification_id', v_notif_id
    );
  END IF;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'internal_error',
    'message', 'Internal error during deposit review.',
    'step', v_step,
    'pg_error', SQLERRM,
    'pg_code', SQLSTATE
  );
END;
$$;

GRANT EXECUTE ON FUNCTION approve_deposit_tx(UUID, UUID, TEXT, TEXT, NUMERIC) TO service_role;

COMMIT;
