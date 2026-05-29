-- ==========================================================
-- Grant service_role access to referral engine tables
-- Ensures the referral reward processor can read/write
-- referrals, investments, app_settings, and plans tables
-- ==========================================================

BEGIN;

GRANT ALL ON referrals TO service_role;
GRANT ALL ON investments TO service_role;
GRANT ALL ON app_settings TO service_role;
GRANT ALL ON plans TO service_role;

COMMIT;
