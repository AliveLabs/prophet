-- =============================================================================
-- !!  DO NOT APPLY WITHOUT CHRIS'S SIGN-OFF  !!
--
-- This migration alters `marketing.contacts`, which is CHRIS'S SCHEMA
-- (defined in app/docs/stream1-supabase-schema.sql, currently v1.3). The
-- product app never adds columns there unilaterally; this file is checked in
-- so the change is reviewable, but it must be applied by (or with the
-- explicit sign-off of) Chris, and his schema file should be bumped to
-- include it so the two definitions do not drift.
--
-- Context: decision D7 (unsubscribe fix, greenlit 2026-08-13). The app hosts
-- /unsubscribe, verifies the HMAC-signed link his n8n templates embed, and
-- records the opt-out here. Full contract: docs/UNSUBSCRIBE-CONTRACT.md.
--
-- Semantics:
--   unsubscribed_at IS NULL      -> contact may receive marketing email
--   unsubscribed_at IS NOT NULL  -> contact opted out at that instant
--
-- Chris's n8n send workflows must add `AND unsubscribed_at IS NULL` to every
-- marketing/lifecycle send query (Workflows B and D, and any future sends).
-- The app writes this column from /unsubscribe (set) and its resubscribe
-- affordance (clear). NOTHING in the app's transactional email path reads
-- it: transactional email is exempt from marketing opt-out by construction.
--
-- A nullable column with no default and no backfill: existing rows read as
-- subscribed, the ALTER takes only a brief metadata lock, and it is safe on
-- a live table.
-- =============================================================================

ALTER TABLE marketing.contacts
  ADD COLUMN IF NOT EXISTS unsubscribed_at timestamptz;

COMMENT ON COLUMN marketing.contacts.unsubscribed_at IS
  'Marketing opt-out (decision D7). NULL = subscribed. Set/cleared by the app''s /unsubscribe page via signed link; read by n8n send workflows (filter unsubscribed_at IS NULL). Transactional email ignores it by design.';
