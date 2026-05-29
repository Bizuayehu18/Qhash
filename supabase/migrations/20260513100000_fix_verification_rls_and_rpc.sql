-- ==========================================================
-- Fix verification metadata persistence
-- 1. Add mark_deposit_error RPC (SECURITY DEFINER)
-- 2. Grant EXECUTE on all verification RPCs to service_role
-- 3. Grant table-level permissions to service_role
-- ==========================================================

BEGIN;

-- RPC to mark a deposit verification as errored (replaces direct update)
CREATE OR REPLACE FUNCTION mark_deposit_error(
  p_deposit_id uuid,
  p_error text,
  p_failure_reason text DEFAULT 'unexpected_error',
  p_verification_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE deposits SET
    verification_status = 'error',
    verification_error = p_error,
    verification_metadata = p_verification_metadata,
    updated_at = now()
  WHERE id = p_deposit_id;
END;
$$;

-- Ensure service_role can execute all verification RPCs
GRANT EXECUTE ON FUNCTION try_lock_deposit_verification(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION auto_approve_deposit(uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION fail_deposit_verification(uuid, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION mark_deposit_error(uuid, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION increment_wallet_balance(uuid, numeric) TO service_role;

-- Ensure service_role has full access to all tables used by verification
GRANT ALL ON deposits TO service_role;
GRANT ALL ON wallets TO service_role;
GRANT ALL ON transactions TO service_role;
GRANT ALL ON notifications TO service_role;
GRANT ALL ON payment_methods TO service_role;
GRANT ALL ON profiles TO service_role;

COMMIT;
