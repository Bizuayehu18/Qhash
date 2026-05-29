BEGIN;

ALTER TABLE payment_methods
  ADD COLUMN IF NOT EXISTS account_last_8 TEXT;

COMMENT ON COLUMN payment_methods.account_last_8
  IS 'Last 8 digits of the receiver account number, used for CBE receipt URL generation';

COMMIT;
