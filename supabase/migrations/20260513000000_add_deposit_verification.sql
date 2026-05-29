-- Add automatic deposit verification columns
ALTER TABLE deposits
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'processing', 'verified', 'failed', 'error', 'manual_review')),
  ADD COLUMN IF NOT EXISTS receipt_url text,
  ADD COLUMN IF NOT EXISTS auto_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS verification_error text,
  ADD COLUMN IF NOT EXISTS verification_metadata jsonb DEFAULT '{}'::jsonb;

-- Index for finding deposits that need verification
CREATE INDEX IF NOT EXISTS idx_deposits_verification_status
  ON deposits (verification_status)
  WHERE verification_status IN ('pending', 'processing');

-- Index for preventing duplicate verifications in progress
CREATE INDEX IF NOT EXISTS idx_deposits_verification_processing
  ON deposits (id)
  WHERE verification_status = 'processing';

-- Prevent concurrent verification of the same deposit via advisory lock helper
CREATE OR REPLACE FUNCTION try_lock_deposit_verification(p_deposit_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  lock_key bigint;
  updated_count integer;
BEGIN
  lock_key := hashtext(p_deposit_id::text);

  IF NOT pg_try_advisory_xact_lock(lock_key) THEN
    RETURN false;
  END IF;

  UPDATE deposits
    SET verification_status = 'processing',
        verification_attempts = verification_attempts + 1,
        updated_at = now()
    WHERE id = p_deposit_id
      AND verification_status IN ('pending', 'error')
      AND status = 'pending'
  RETURNING 1 INTO updated_count;

  RETURN updated_count IS NOT NULL;
END;
$$;

-- Auto-approve deposit and credit wallet atomically
CREATE OR REPLACE FUNCTION auto_approve_deposit(
  p_deposit_id uuid,
  p_receipt_url text,
  p_verification_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deposit deposits%ROWTYPE;
  v_balance_before numeric;
  v_balance_after numeric;
BEGIN
  SELECT * INTO v_deposit FROM deposits WHERE id = p_deposit_id FOR UPDATE;

  IF v_deposit IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'deposit_not_found');
  END IF;

  IF v_deposit.status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_reviewed');
  END IF;

  -- Update deposit as verified and approved
  UPDATE deposits SET
    status = 'approved',
    verification_status = 'verified',
    receipt_url = p_receipt_url,
    auto_verified = true,
    verified_at = now(),
    verification_metadata = p_verification_metadata,
    reviewed_at = now(),
    updated_at = now()
  WHERE id = p_deposit_id;

  -- Credit wallet atomically
  SELECT balance INTO v_balance_before
    FROM wallets WHERE user_id = v_deposit.user_id FOR UPDATE;

  IF v_balance_before IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'wallet_not_found');
  END IF;

  v_balance_after := v_balance_before + v_deposit.amount;

  UPDATE wallets
    SET balance = v_balance_after, updated_at = now()
    WHERE user_id = v_deposit.user_id;

  -- Record transaction
  INSERT INTO transactions (user_id, type, amount, status, balance_before, balance_after, description, reference_id)
  VALUES (
    v_deposit.user_id,
    'deposit',
    v_deposit.amount,
    'completed',
    v_balance_before,
    v_balance_after,
    'Auto-verified deposit via ' || v_deposit.transaction_reference,
    v_deposit.id
  );

  -- Notify user
  INSERT INTO notifications (user_id, type, title, message, metadata)
  VALUES (
    v_deposit.user_id,
    'deposit_approved',
    'Deposit Approved',
    'Your deposit of ' || v_deposit.amount || ' ETB has been automatically verified and credited to your wallet.',
    jsonb_build_object('deposit_id', v_deposit.id, 'auto_verified', true)
  );

  RETURN jsonb_build_object(
    'success', true,
    'balance_before', v_balance_before,
    'balance_after', v_balance_after,
    'amount', v_deposit.amount
  );
END;
$$;

-- Mark deposit verification as failed (needs manual review)
CREATE OR REPLACE FUNCTION fail_deposit_verification(
  p_deposit_id uuid,
  p_error text,
  p_receipt_url text DEFAULT NULL,
  p_verification_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE deposits SET
    verification_status = CASE
      WHEN verification_attempts >= 3 THEN 'manual_review'
      ELSE 'failed'
    END,
    verification_error = p_error,
    receipt_url = COALESCE(p_receipt_url, receipt_url),
    verification_metadata = p_verification_metadata,
    updated_at = now()
  WHERE id = p_deposit_id;

  -- If marked for manual review, notify admins
  IF (SELECT verification_status FROM deposits WHERE id = p_deposit_id) = 'manual_review' THEN
    INSERT INTO notifications (user_id, type, title, message, metadata)
    SELECT
      p.id,
      'admin_action_required',
      'Deposit Needs Review',
      'Auto-verification failed for deposit ' || p_deposit_id || '. Manual review required.',
      jsonb_build_object('deposit_id', p_deposit_id, 'error', p_error)
    FROM profiles p WHERE p.is_admin = true;
  END IF;
END;
$$;
