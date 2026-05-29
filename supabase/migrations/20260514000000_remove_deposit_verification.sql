-- ==========================================================
-- Remove old deposit verification system
-- Drops verification columns, indexes, and RPC functions
-- ==========================================================

BEGIN;

-- Drop verification-related indexes
DROP INDEX IF EXISTS idx_deposits_verification_status;
DROP INDEX IF EXISTS idx_deposits_verification_processing;

-- Drop verification RPC functions
DROP FUNCTION IF EXISTS try_lock_deposit_verification(uuid);
DROP FUNCTION IF EXISTS auto_approve_deposit(uuid, text, jsonb);
DROP FUNCTION IF EXISTS fail_deposit_verification(uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS mark_deposit_error(uuid, text, text, jsonb);

-- Drop verification columns from deposits
ALTER TABLE deposits
  DROP COLUMN IF EXISTS verification_status,
  DROP COLUMN IF EXISTS receipt_url,
  DROP COLUMN IF EXISTS auto_verified,
  DROP COLUMN IF EXISTS verified_at,
  DROP COLUMN IF EXISTS verification_attempts,
  DROP COLUMN IF EXISTS verification_error,
  DROP COLUMN IF EXISTS verification_metadata;

-- Drop old manual-review fields no longer needed
ALTER TABLE deposits
  DROP COLUMN IF EXISTS payer_name,
  DROP COLUMN IF EXISTS payer_phone,
  DROP COLUMN IF EXISTS proof_url;

COMMIT;
