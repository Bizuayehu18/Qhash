-- ==========================================================
-- Atomic deposit approval/rejection function
-- Wraps all approval steps in a single transaction to prevent
-- partial state (e.g. approved deposit without wallet credit).
-- ==========================================================

BEGIN;

CREATE OR REPLACE FUNCTION approve_deposit_tx(
  p_deposit_id   UUID,
  p_admin_id     UUID,
  p_action       TEXT,       -- 'approve' or 'reject'
  p_admin_note   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deposit       RECORD;
  v_admin         RECORD;
  v_balance_before NUMERIC;
  v_balance_after  NUMERIC;
  v_new_status    deposit_status;
  v_tx_id         UUID;
  v_notif_id      UUID;
BEGIN
  -- 1. Verify admin
  SELECT id, is_admin, is_frozen
    INTO v_admin
    FROM profiles
   WHERE id = p_admin_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'admin_not_found', 'message', 'Admin profile not found.');
  END IF;

  IF NOT v_admin.is_admin THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_admin', 'message', 'User is not an admin.');
  END IF;

  IF v_admin.is_frozen THEN
    RETURN jsonb_build_object('success', false, 'error', 'admin_frozen', 'message', 'Admin account is frozen.');
  END IF;

  -- 2. Validate action
  IF p_action NOT IN ('approve', 'reject') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_action', 'message', 'Action must be approve or reject.');
  END IF;

  v_new_status := CASE WHEN p_action = 'approve' THEN 'approved'::deposit_status ELSE 'rejected'::deposit_status END;

  -- 3. Fetch and lock deposit row
  SELECT *
    INTO v_deposit
    FROM deposits
   WHERE id = p_deposit_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'deposit_not_found', 'message', 'Deposit record not found.');
  END IF;

  IF v_deposit.status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_reviewed',
      'message', format('Deposit already %s.', v_deposit.status));
  END IF;

  IF v_deposit.amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_amount', 'message', 'Deposit amount is invalid.');
  END IF;

  -- 4. Update deposit status
  UPDATE deposits
     SET status      = v_new_status,
         admin_note  = p_admin_note,
         reviewed_by = p_admin_id,
         reviewed_at = now(),
         updated_at  = now()
   WHERE id = p_deposit_id;

  -- 5. If approving: credit wallet, create transaction, notify
  IF p_action = 'approve' THEN

    -- 5a. Lock and update wallet
    SELECT balance INTO v_balance_before
      FROM wallets
     WHERE user_id = v_deposit.user_id
       FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO wallets (user_id, balance) VALUES (v_deposit.user_id, v_deposit.amount);
      v_balance_before := 0;
      v_balance_after  := v_deposit.amount;
    ELSE
      v_balance_after := v_balance_before + v_deposit.amount;
      UPDATE wallets
         SET balance    = v_balance_after,
             updated_at = now()
       WHERE user_id = v_deposit.user_id;
    END IF;

    -- 5b. Create transaction record
    INSERT INTO transactions (user_id, type, amount, status, balance_before, balance_after, description, reference_id)
    VALUES (
      v_deposit.user_id,
      'deposit',
      v_deposit.amount,
      'completed',
      v_balance_before,
      v_balance_after,
      'Deposit via ' || v_deposit.transaction_reference,
      v_deposit.id
    )
    RETURNING id INTO v_tx_id;

    -- 5c. Create notification
    INSERT INTO notifications (user_id, type, title, message, metadata)
    VALUES (
      v_deposit.user_id,
      'deposit_approved',
      'Deposit Approved',
      format('Your deposit of %s ETB has been approved and credited to your wallet.', v_deposit.amount),
      jsonb_build_object('deposit_id', v_deposit.id)
    )
    RETURNING id INTO v_notif_id;

    RETURN jsonb_build_object(
      'success', true,
      'status', 'approved',
      'deposit_id', v_deposit.id,
      'user_id', v_deposit.user_id,
      'amount', v_deposit.amount,
      'balance_before', v_balance_before,
      'balance_after', v_balance_after,
      'transaction_id', v_tx_id,
      'notification_id', v_notif_id
    );

  ELSE
    -- 6. Rejection: just notify
    INSERT INTO notifications (user_id, type, title, message, metadata)
    VALUES (
      v_deposit.user_id,
      'deposit_rejected',
      'Deposit Rejected',
      CASE
        WHEN p_admin_note IS NOT NULL AND p_admin_note != ''
        THEN format('Your deposit of %s ETB was rejected. Reason: %s', v_deposit.amount, p_admin_note)
        ELSE format('Your deposit of %s ETB was rejected.', v_deposit.amount)
      END,
      jsonb_build_object('deposit_id', v_deposit.id)
    )
    RETURNING id INTO v_notif_id;

    RETURN jsonb_build_object(
      'success', true,
      'status', 'rejected',
      'deposit_id', v_deposit.id,
      'user_id', v_deposit.user_id,
      'notification_id', v_notif_id
    );
  END IF;
END;
$$;

COMMIT;
