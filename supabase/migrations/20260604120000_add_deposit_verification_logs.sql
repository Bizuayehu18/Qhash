-- Add deposit_verification_logs audit table
--
-- Roll-forward migration that aligns the repository schema history with the
-- production Supabase database, where this table was already applied manually.
--
-- Purpose: append-only audit trail of deposit-verification decisions (CBE
-- automatic, TeleBirr verifier, and admin manual). Rows are inserted, never
-- updated or deleted in normal operation. One row per final decision.
--
-- Safety:
--   * deposit_id / user_id / actor_id reference deposits / profiles with
--     ON DELETE SET NULL, so deleting a deposit or profile nulls the
--     correlation rather than blocking or cascading the audit row away.
--   * Never store full receipt text, full receipt URLs, secrets, raw receiver /
--     account names, or the full transaction reference. Persist only masked /
--     sanitised / boolean / enum fields (e.g. tx_ref_last4, metadata whitelist).
--   * Writes occur through the service role only (which bypasses RLS). No
--     client-facing INSERT / UPDATE / DELETE policy is granted, so those paths
--     are denied by default under RLS.

CREATE TABLE IF NOT EXISTS public.deposit_verification_logs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id           uuid references public.deposits(id) on delete set null,
  user_id              uuid references public.profiles(id) on delete set null,
  payment_type         public.payment_method_type,            -- 'cbe' | 'telebirr'
  event                text,                                  -- e.g. cbe_auto_approve, telebirr_manual_review
  action               text,                                  -- approve | reject | manual_review | skipped | error
  reason_code          text,                                  -- low-cardinality code
  reason_message_safe  text,                                  -- pre-sanitised message; never raw receipt text
  amount               numeric,                               -- decision amount; may be null on error
  tx_ref_last4         text,                                  -- last 4 chars of the transaction reference only
  receiver_matched     boolean,                               -- whether the receiver matched
  freshness_decision   text,                                  -- fresh | too_old | future | missing | unparseable
  age_minutes          numeric,                               -- age of the receipt at decision time
  actor_type           text NOT NULL DEFAULT 'system',        -- system | admin | verifier
  actor_id             uuid references public.profiles(id) on delete set null,  -- admin profile id when actor_type = 'admin', else null
  source               text NOT NULL DEFAULT 'server',        -- cbe_auto | telebirr_verifier | admin_manual
  metadata             jsonb NOT NULL DEFAULT '{}'::jsonb,    -- safe-only: booleans, enums, counts; never raw PII/secrets
  created_at           timestamptz NOT NULL DEFAULT now(),

  constraint deposit_verification_logs_metadata_is_object
    check (jsonb_typeof(metadata) = 'object'),

  constraint deposit_verification_logs_tx_ref_last4_safe_length
    check (tx_ref_last4 is null or length(tx_ref_last4) <= 4)
);

-- Lookup by correlated deposit.
CREATE INDEX IF NOT EXISTS idx_deposit_verification_logs_deposit_id
  ON public.deposit_verification_logs (deposit_id);

-- Lookup by correlated user.
CREATE INDEX IF NOT EXISTS idx_deposit_verification_logs_user_id
  ON public.deposit_verification_logs (user_id);

-- Recent-first chronological scans.
CREATE INDEX IF NOT EXISTS idx_deposit_verification_logs_created_at
  ON public.deposit_verification_logs (created_at DESC);

-- Filter by event.
CREATE INDEX IF NOT EXISTS idx_deposit_verification_logs_event
  ON public.deposit_verification_logs (event);

-- Filter by action.
CREATE INDEX IF NOT EXISTS idx_deposit_verification_logs_action
  ON public.deposit_verification_logs (action);

-- Filter by reason code.
CREATE INDEX IF NOT EXISTS idx_deposit_verification_logs_reason_code
  ON public.deposit_verification_logs (reason_code);

-- Enable RLS: default-deny for every client role. Service-role writes bypass RLS.
ALTER TABLE public.deposit_verification_logs ENABLE ROW LEVEL SECURITY;

-- Admins may read the audit trail. No other client-facing policy is granted,
-- so normal users and anonymous clients are denied SELECT / INSERT / UPDATE /
-- DELETE by default. Re-created idempotently for roll-forward safety.
DROP POLICY IF EXISTS "Admins can view deposit verification logs" ON public.deposit_verification_logs;
CREATE POLICY "Admins can view deposit verification logs"
  ON public.deposit_verification_logs
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Documentation comments.
COMMENT ON TABLE public.deposit_verification_logs IS
  'Append-only audit trail of deposit-verification decisions (CBE auto, TeleBirr verifier, admin manual). Inserts only; never store full receipt text/URL, secrets, raw names, or full tx reference. Service-role writes only; admins may SELECT.';
COMMENT ON COLUMN public.deposit_verification_logs.deposit_id IS 'Correlation to the deposit. ON DELETE SET NULL so audit writes never block the money path.';
COMMENT ON COLUMN public.deposit_verification_logs.tx_ref_last4 IS 'Last 4 characters of the transaction reference only. Never persist the full reference.';
COMMENT ON COLUMN public.deposit_verification_logs.metadata IS 'Safe-only structured data (booleans, enums, counts). Never raw PII or secrets.';
