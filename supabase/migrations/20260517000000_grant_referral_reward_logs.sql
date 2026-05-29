-- Grant service_role access to referral_reward_logs for the reward engine.

BEGIN;

GRANT ALL ON referral_reward_logs TO service_role;

COMMIT;
