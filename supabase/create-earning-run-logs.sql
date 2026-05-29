-- earning_run_logs: Tracks each daily earning scheduler run
-- Run this SQL in your Supabase SQL Editor (Dashboard > SQL Editor > New query)

CREATE TABLE IF NOT EXISTS public.earning_run_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id text NOT NULL UNIQUE,
  trigger_type text NOT NULL DEFAULT 'scheduled',
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  total_active_investments integer DEFAULT 0,
  total_users_processed integer DEFAULT 0,
  total_investments_processed integer DEFAULT 0,
  total_earnings_credited double precision DEFAULT 0,
  total_skipped integer DEFAULT 0,
  total_completed_investments integer DEFAULT 0,
  total_errors integer DEFAULT 0,
  error_details jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_earning_run_logs_run_id ON public.earning_run_logs (run_id);
CREATE INDEX IF NOT EXISTS idx_earning_run_logs_status ON public.earning_run_logs (status);
CREATE INDEX IF NOT EXISTS idx_earning_run_logs_created_at ON public.earning_run_logs (created_at DESC);

ALTER TABLE public.earning_run_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on earning_run_logs"
  ON public.earning_run_logs
  FOR ALL
  USING (true)
  WITH CHECK (true);
