-- ==========================================================
-- Grant service_role access to tables used by the referral
-- reward engine that were missed in the initial grant migration.
-- The engine writes to wallets, transactions, and notifications
-- when crediting referral bonuses.
-- ==========================================================

BEGIN;

GRANT ALL ON wallets TO service_role;
GRANT ALL ON transactions TO service_role;
GRANT ALL ON notifications TO service_role;

COMMIT;
