-- ==========================================================
-- Fix deposit amount constraint and enhance approval RPC
--
-- Problems fixed:
--   1. CHECK (amount > 0) rejects deposits where user didn't
--      specify an amount (the field is optional in the UI).
--   2. approve_deposit_tx rejects zero-amount deposits, so
--      admin cannot approve them even after verifying the receipt.
--   3. No mechanism for admin to set the verified amount from
--      the receipt during approval.
-- ==========================================================

BEGIN;

-- 1. Relax the amount constraint to allow 0 (unknown at submission time)
ALTER TABLE deposits DROP CONSTRAINT IF EXISTS deposits_amount_check;
ALTER TABLE deposits ADD CONSTRAINT deposits_amount_check CHECK (amount >= 0);

-- 2. Drop old function signature and recreate with p_amount param
DROP FUNCTION IF EXISTS approve_deposit_tx(uuid, uuid, text, text);

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
  v_deposit       RECORD;
  v_admin         RECORD;
  v_final_amount  NUMERIC;
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

  -- 4. Resolve final amount: admin override > deposit amount
  v_final_amount := COALESCE(NULLIF(p_amount, 0), NULLIF(v_deposit.amount, 0));

  IF p_action = 'approve' AND (v_final_amount IS NULL OR v_final_amount <= 0) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_amount',
      'message', 'Deposit amount is required for approval. Enter the verified amount from the receipt.');
  END IF;

  -- 5. Update deposit status (and amount if admin provided override)
  UPDATE deposits
     SET status      = v_new_status,
         amount      = CASE WHEN p_action = 'approve' THEN v_final_amount ELSE amount END,
         admin_note  = p_admin_note,
         reviewed_by = p_admin_id,
         reviewed_at = now(),
         updated_at  = now()
   WHERE id = p_deposit_id;

  -- 6. If approving: credit wallet, create transaction, notify
  IF p_action = 'approve' THEN

    -- 6a. Lock and update wallet
    SELECT balance INTO v_balance_before
      FROM wallets
     WHERE user_id = v_deposit.user_id
       FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO wallets (user_id, balance) VALUES (v_deposit.user_id, v_final_amount);
      v_balance_before := 0;
      v_balance_after  := v_final_amount;
    ELSE
      v_balance_after := v_balance_before + v_final_amount;
      UPDATE wallets
         SET balance    = v_balance_after,
             updated_at = now()
       WHERE user_id = v_deposit.user_id;
    END IF;

    -- 6b. Create transaction record
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

    -- 6c. Create notification
    INSERT INTO notifications (user_id, type, title, message, metadata)
    VALUES (
      v_deposit.user_id,
      'deposit_approved',
      'Deposit Approved',
      format('Your deposit of %s ETB has been approved and credited to your wallet.', v_final_amount),
      jsonb_build_object('deposit_id', v_deposit.id)
    )
    RETURNING id INTO v_notif_id;

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
    -- 7. Rejection: just notify
    INSERT INTO notifications (user_id, type, title, message, metadata)
    VALUES (
      v_deposit.user_id,
      'deposit_rejected',
      'Deposit Rejected',
      CASE
        WHEN p_admin_note IS NOT NULL AND p_admin_note != ''
        THEN format('Your deposit of %s ETB was rejected. Reason: %s', GREATEST(COALESCE(v_final_amount, 0), v_deposit.amount), p_admin_note)
        WHEN GREATEST(COALESCE(v_final_amount, 0), v_deposit.amount) > 0
        THEN format('Your deposit of %s ETB was rejected.', GREATEST(COALESCE(v_final_amount, 0), v_deposit.amount))
        ELSE 'Your deposit was rejected.'
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
