-- ==========================================================
-- Phase 4: Deposit system enhancements
-- Adds pending_review status and notifications table
-- ==========================================================

BEGIN;

-- Add pending_review to deposit_status enum
ALTER TYPE deposit_status ADD VALUE IF NOT EXISTS 'pending_review';

-- ----------------------------------------------------------
-- Notifications table
-- ----------------------------------------------------------

CREATE TABLE notifications (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  type       TEXT        NOT NULL,
  title      TEXT        NOT NULL,
  message    TEXT        NOT NULL,
  is_read    BOOLEAN     NOT NULL DEFAULT FALSE,
  metadata   JSONB       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user        ON notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_user_unread ON notifications (user_id) WHERE NOT is_read;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_select_own   ON notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY notifications_insert_admin ON notifications FOR INSERT WITH CHECK (is_admin());
CREATE POLICY notifications_update_own   ON notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY notifications_delete_own   ON notifications FOR DELETE USING (auth.uid() = user_id);

-- ----------------------------------------------------------
-- Supabase Storage bucket for deposit proofs (idempotent)
-- Note: Storage buckets are managed via Supabase dashboard.
-- Create a public bucket named 'deposit-proofs' with:
--   - Max file size: 5MB
--   - Allowed MIME types: image/jpeg, image/png, image/webp
-- ----------------------------------------------------------

COMMIT;
