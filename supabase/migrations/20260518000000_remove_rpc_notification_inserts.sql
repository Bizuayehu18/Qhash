-- ==========================================================
-- *** SUPERSEDED by 20260526000000_align_approve_deposit_tx_with_live_rpc.sql ***
--
-- This migration is OUTDATED and does NOT match the live RPC.
-- It still contains the unsafe COALESCE(NULLIF(p_amount, 0), NULLIF(v_deposit.amount, 0))
-- fallback and a reviewed_by column reference that crashes at runtime.
--
-- The live RPC was manually repaired to:
--   1. Require p_amount > 0 for approve (no deposits.amount fallback)
--   2. Remove the reviewed_by reference (column does not exist)
--
-- See: 20260526000000_align_approve_deposit_tx_with_live_rpc.sql
-- See: DEPOSIT_SAFETY_CHECKPOINT.md
-- ==========================================================
--
-- Original purpose (below): Remove duplicate notification inserts from approve_deposit_tx
--
-- The admin-approve-deposit Netlify function already creates
-- standardized notifications after calling this RPC. The RPC
-- was also inserting its own notifications, causing duplicates.
--
-- This migration redefines the function with notification
-- inserts removed. Wallet credit, transaction creation, and
-- deposit status updates are unchanged.
--
-- CBE auto-approval (auto_verify_deposit) is NOT modified.
-- ==========================================================

BEGIN;

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

  -- 7. If approving: credit wallet, create transaction
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

    -- Notifications are handled by the Netlify function (admin-approve-deposit.mts)

    v_step := 'done';
    RETURN jsonb_build_object(
      'success', true,
      'status', 'approved',
      'deposit_id', v_deposit.id,
      'user_id', v_deposit.user_id,
      'amount', v_final_amount,
      'balance_before', v_balance_before,
      'balance_after', v_balance_after,
      'transaction_id', v_tx_id
    );

  ELSE
    -- 8. Rejection: status already updated above
    -- Notifications are handled by the Netlify function (admin-approve-deposit.mts)

    v_step := 'done';
    RETURN jsonb_build_object(
      'success', true,
      'status', 'rejected',
      'deposit_id', v_deposit.id,
      'user_id', v_deposit.user_id
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
