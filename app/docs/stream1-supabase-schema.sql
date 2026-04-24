-- =============================================================================
-- Alive Labs Phase 3 — Stream 1 Supabase Schema
-- File: stream1-supabase-schema.sql
-- Target: Postgres 15+ (Supabase)
-- Version: 1.2 (April 2026) — industry_type enum aligned with product DB
--
-- CHANGE LOG
-- ----------
-- v1.2 (2026-04-22): Renamed industry_type enum value 'liquor' → 'liquor_store'
--   to match `public.organizations.industry_type` check constraint in the
--   Vatic product schema. Flagged by Anand in his 2026-04-21 email review.
--   Without this fix, the `/api/waitlist` mirror path and Auric cross-sell
--   view would silently return empty results for Neat signups.
-- v1.1 (2026-04-20): Relocated all Stream 1 objects from `public` to a
--   dedicated `marketing` schema inside the existing Vatic Supabase project.
--   Decision by Anand (lead engineer) during 2026-04-20 architecture review.
--   Rationale: keep marketing tables isolated from Vatic product tables while
--   preserving same-DB coupling for `contacts.posthog_distinct_id` (written
--   by Ticket/Neat app backend on first login) and `stripe_customer_id`
--   lifecycle bridging. Enum types also live in `marketing` to avoid potential
--   naming collisions with Vatic product enums (e.g., `industry_type`).
-- v1.0 (April 2026): Initial schema targeting `public`.
--
-- PURPOSE
-- -------
-- This schema backs Build Item 14 (Ticket Stream 1) AND Build Item 15 (Neat
-- Stream 1) on the shared Vatic Supabase project. Per alive-labs-plan-v3.2
-- (Section 1.3), Ticket and Neat share one Supabase instance; the
-- `industry_type` column discriminates verticals ('restaurant' vs 'liquor_store').
-- Auric has its own separate Supabase project and is NOT covered here.
--
-- TABLES (all in `marketing` schema)
-- ------
--   marketing.contacts         : master contact record (waitlist →
--                                access_granted → trial → paid | churned).
--   marketing.email_log        : append-only audit of every email sent via
--                                Resend. Primary idempotency source.
--   marketing.events           : lifecycle event stream. Populated by a
--                                trigger on contacts.status changes.
--   marketing.failed_events    : dead-letter queue. n8n writes after 3
--                                failed retries.
--
-- CONTROL FLOW
-- ------------
-- Workflow A (intake)         : INSERT marketing.contacts + marketing.email_log.
--                               Upsert on email.
-- Workflow B (nurture)        : SELECT from marketing.v_waitlist_nurture_due,
--                               send, INSERT marketing.email_log.
-- Workflow C (access_granted) : UPDATE marketing.contacts.status →
--                               'access_granted'; row-update trigger fires
--                               DB webhook to n8n, which sends email + stamps
--                               access_granted_notified_at + logs event.
-- Workflow D (trial)          : SELECT from marketing.v_trial_onboarding_due,
--                               send, INSERT marketing.email_log; Day 14
--                               UPDATE status to 'churned' if not 'paid'.
--
-- SECURITY
-- --------
-- Row-level security is enabled on every table. Only the service_role key
-- (used by n8n) can read/write. The anon key is explicitly denied. Grants
-- on the `marketing` schema are scoped — service_role gets USAGE + ALL on
-- tables/sequences/views; anon gets nothing.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Schema + Extensions
-- ─────────────────────────────────────────────────────────────────────────────
-- `marketing` schema holds all Stream 1 objects. Keeps product (public)
-- and marketing tables cleanly separated within the same Vatic project.
-- Extensions live at the database level (not schema-scoped).

CREATE SCHEMA IF NOT EXISTS marketing;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Enum Types (in `marketing` schema)
-- ─────────────────────────────────────────────────────────────────────────────
-- DESIGN NOTE: enums over text for type safety. Adding a new status requires
-- a deliberate migration (ALTER TYPE ... ADD VALUE), which is the correct
-- friction for lifecycle state changes. For `industry_type` we pre-declare
-- all brands we expect Alive Labs to build even though Stream 1 only uses
-- 'restaurant' and 'liquor_store' — saves a migration when Auric/future brands
-- onboard. Use text columns (not enums) for lower-churn fields like `source`.
--
-- Enums placed in `marketing` schema to prevent any collision with Vatic's
-- existing public-schema type names (industry_type is especially risky).

DO $$ BEGIN
  CREATE TYPE marketing.contact_status AS ENUM (
    'waitlist',
    'access_granted',
    'trial',
    'paid',
    'churned',
    'archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE marketing.industry_type AS ENUM (
    'restaurant',
    'liquor_store',
    'coffee',
    'salon',
    'fitness',
    'retail',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE marketing.email_status AS ENUM (
    'queued',
    'sent',
    'failed',
    'bounced',
    'opened',
    'clicked'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. marketing.contacts — master contact record
-- ─────────────────────────────────────────────────────────────────────────────
-- DESIGN NOTES
--   • email is citext + unique for case-insensitive dedupe on upsert.
--   • location_count is stored as the dropdown VALUE ('1', '2-5', '6-20',
--     '21-50', '50+') not the numeric count, because Ticket's landing page
--     ships the literal dropdown string and we want a 1:1 record of what
--     the operator selected. Downstream tagging logic maps these values to
--     tags like 'single-location' / 'multi-location-mid'.
--   • access_granted_date  = when the admin flipped the status.
--     access_granted_notified_at = when n8n finished sending the email
--                                  (guards against double-sends if the
--                                  trigger fires twice).
--   • trial_end_date is a generated column based on trial_start_date + 14
--     days. Kept STORED (not VIRTUAL) so views can index it. Admins who
--     want to extend a trial should UPDATE trial_start_date (rebase) OR
--     we add a separate trial_extension_days column in a later migration —
--     see open questions in architecture doc.
--   • clay_enrichment is jsonb so we can dump the full Clay response
--     without schema churn.
--   • tags is a text[] for n8n-friendly tag ops (ANY, @>, array_append).
--   • posthog_distinct_id is written by Ticket/Neat app backend on first
--     login (cross-schema coupling: product writes, marketing reads).

CREATE TABLE IF NOT EXISTS marketing.contacts (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                       citext NOT NULL UNIQUE,
  first_name                  text,
  last_name                   text,
  industry_type               marketing.industry_type NOT NULL,
  business_name               text,
  location_count              text,                    -- '1' | '2-5' | '6-20' | '21-50' | '50+'
  city                        text,
  status                      marketing.contact_status NOT NULL DEFAULT 'waitlist',
  source                      text NOT NULL DEFAULT 'getticket.ai',
  signup_date                 timestamptz NOT NULL DEFAULT now(),
  access_granted_date         timestamptz,
  access_granted_notified_at  timestamptz,
  trial_start_date            timestamptz,
  trial_end_date              timestamptz
                                GENERATED ALWAYS AS
                                (trial_start_date + interval '14 days') STORED,
  paid_date                   timestamptz,
  churn_date                  timestamptz,
  stripe_customer_id          text,
  posthog_distinct_id         text,
  clay_enrichment             jsonb NOT NULL DEFAULT '{}'::jsonb,
  tags                        text[] NOT NULL DEFAULT ARRAY[]::text[],
  auric_crosssell_sent_at     timestamptz,             -- for Item 16 scheduler
  notes                       text,                    -- admin review notes
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  -- Guardrails
  CONSTRAINT contacts_source_chk CHECK (
    source IN (
      'getticket.ai',
      'goneat.ai',
      'auricmobile.app',
      'outbound',
      'referral',
      'import',
      'manual'
    )
  ),
  CONSTRAINT contacts_access_logical_chk CHECK (
    access_granted_notified_at IS NULL
    OR access_granted_date IS NOT NULL
  )
);

COMMENT ON TABLE  marketing.contacts IS 'Master contact record. One row per email across Ticket + Neat; industry_type discriminates.';
COMMENT ON COLUMN marketing.contacts.location_count IS 'Dropdown value 1|2-5|6-20|21-50|50+ — stored raw, mapped to tags by workflow.';
COMMENT ON COLUMN marketing.contacts.trial_end_date IS 'Generated = trial_start_date + 14d. Rebase by updating trial_start_date.';
COMMENT ON COLUMN marketing.contacts.access_granted_notified_at IS 'Set by Workflow C after sending access-granted email. Double-send guard.';
COMMENT ON COLUMN marketing.contacts.posthog_distinct_id IS 'Written by Ticket/Neat app backend on first login. Same-DB coupling requirement.';
COMMENT ON COLUMN marketing.contacts.clay_enrichment IS 'Raw Clay response JSON. Schema-agnostic.';
COMMENT ON COLUMN marketing.contacts.auric_crosssell_sent_at IS 'Reserved for Build Item 16 (Auric cross-sell scheduler).';


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. marketing.email_log — every email Resend sends
-- ─────────────────────────────────────────────────────────────────────────────
-- DESIGN NOTES
--   • Separate table (not a column on contacts) for three reasons:
--       (1) idempotency: the nurture scheduler checks
--           "has template X been sent to contact Y today?" — trivial with
--           an index on (contact_id, template).
--       (2) audit: full send history for compliance + debugging.
--       (3) bounce/open/click tracking: Resend's webhook PATCHes the
--           status column (sent → opened → clicked) asynchronously.
--   • resend_email_id is the ID Resend returns in the POST /emails
--     response. We store it so Resend's webhooks (email.opened, etc.) can
--     correlate back to our row.
--   • metadata is jsonb for workflow-specific fields (e.g., batch_id,
--     day_offset, execution_id).

CREATE TABLE IF NOT EXISTS marketing.email_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      uuid NOT NULL REFERENCES marketing.contacts(id) ON DELETE CASCADE,
  template        text NOT NULL,         -- e.g. 'ticket-waitlist-welcome'
  brand           text NOT NULL,         -- 'ticket' | 'neat' | 'auric' | 'alive-labs'
  status          marketing.email_status NOT NULL DEFAULT 'queued',
  resend_email_id text,                  -- correlate to Resend webhooks
  sent_at         timestamptz NOT NULL DEFAULT now(),
  opened_at       timestamptz,
  clicked_at      timestamptz,
  bounced_at      timestamptz,
  error_message   text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT email_log_brand_chk CHECK (
    brand IN ('ticket','neat','auric','alive-labs')
  )
);

COMMENT ON TABLE  marketing.email_log IS 'Append-only audit. Stream 1 schedulers check here for idempotency.';
COMMENT ON COLUMN marketing.email_log.resend_email_id IS 'Returned by POST /emails. Used to correlate email.opened / email.clicked webhooks.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. marketing.events — lifecycle event stream
-- ─────────────────────────────────────────────────────────────────────────────
-- DESIGN NOTES
--   • Separate from email_log because events are coarser-grained (one per
--     state transition, not one per email).
--   • Append-only. No updates. event_data carries any contextual payload.
--   • Populated automatically by the status-change trigger below, plus
--     manual INSERTs from workflows when a non-status event occurs
--     (e.g., 'resend_bounce', 'admin_note').

CREATE TABLE IF NOT EXISTS marketing.events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id  uuid REFERENCES marketing.contacts(id) ON DELETE CASCADE,
  event_type  text NOT NULL,
  event_data  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE marketing.events IS 'Lifecycle event stream. Auto-populated on contacts.status change.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. marketing.failed_events — dead-letter queue
-- ─────────────────────────────────────────────────────────────────────────────
-- Any n8n node that exceeds its retry budget writes one row here. The row
-- is picked up by a manual triage process (Slack #ticket-monitoring has
-- the link; resolving = setting resolved_at).

CREATE TABLE IF NOT EXISTS marketing.failed_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_name  text NOT NULL,        -- 'ticket-waitlist-intake' etc.
  node_name      text NOT NULL,        -- 'Resend send welcome' etc.
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message  text,
  failed_at      timestamptz NOT NULL DEFAULT now(),
  retry_count    integer NOT NULL DEFAULT 0,
  resolved_at    timestamptz,
  resolved_by    text
);

COMMENT ON TABLE marketing.failed_events IS 'Dead-letter queue. n8n writes after 3 failed retries. Resolve manually.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Indexes
-- ─────────────────────────────────────────────────────────────────────────────
-- Patterns to support:
--   (a) UPSERT contact by email              → UNIQUE on email (implicit).
--   (b) Nurture scheduler filter             → (industry_type, status, signup_date).
--   (c) Trial scheduler filter               → (industry_type, status, trial_start_date).
--   (d) Idempotency check in email_log       → (contact_id, template, sent_at).
--   (e) Event history per contact            → (contact_id, created_at).

-- marketing.contacts
CREATE INDEX IF NOT EXISTS idx_contacts_status              ON marketing.contacts (status);
CREATE INDEX IF NOT EXISTS idx_contacts_industry_status     ON marketing.contacts (industry_type, status);
CREATE INDEX IF NOT EXISTS idx_contacts_signup_date         ON marketing.contacts (signup_date);
CREATE INDEX IF NOT EXISTS idx_contacts_trial_start_date    ON marketing.contacts (trial_start_date)
  WHERE trial_start_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_source              ON marketing.contacts (source);
CREATE INDEX IF NOT EXISTS idx_contacts_stripe_customer_id  ON marketing.contacts (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- marketing.email_log
CREATE INDEX IF NOT EXISTS idx_email_log_contact_id         ON marketing.email_log (contact_id);
CREATE INDEX IF NOT EXISTS idx_email_log_template_contact   ON marketing.email_log (contact_id, template);
CREATE INDEX IF NOT EXISTS idx_email_log_sent_at            ON marketing.email_log (sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_resend_email_id    ON marketing.email_log (resend_email_id)
  WHERE resend_email_id IS NOT NULL;

-- marketing.events
CREATE INDEX IF NOT EXISTS idx_events_contact_id            ON marketing.events (contact_id);
CREATE INDEX IF NOT EXISTS idx_events_event_type            ON marketing.events (event_type);
CREATE INDEX IF NOT EXISTS idx_events_created_at            ON marketing.events (created_at DESC);

-- marketing.failed_events
CREATE INDEX IF NOT EXISTS idx_failed_events_unresolved     ON marketing.failed_events (failed_at DESC)
  WHERE resolved_at IS NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Triggers
-- ─────────────────────────────────────────────────────────────────────────────

-- 8a. updated_at maintenance
CREATE OR REPLACE FUNCTION marketing.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contacts_set_updated_at ON marketing.contacts;
CREATE TRIGGER trg_contacts_set_updated_at
  BEFORE UPDATE ON marketing.contacts
  FOR EACH ROW EXECUTE FUNCTION marketing.set_updated_at();


-- 8b. Auto-log lifecycle events on status change
-- Fires into marketing.events whenever contacts.status changes. Workflow C
-- (access-granted handler) also subscribes to this table change via a
-- Supabase database webhook (see architecture doc §6).
CREATE OR REPLACE FUNCTION marketing.log_contact_status_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO marketing.events (contact_id, event_type, event_data)
    VALUES (
      NEW.id,
      'status_change',
      jsonb_build_object(
        'from',         OLD.status,
        'to',           NEW.status,
        'industry_type', NEW.industry_type,
        'email',        NEW.email
      )
    );

    -- Convenience: stamp paid_date / churn_date when transition fires.
    IF NEW.status = 'paid' AND NEW.paid_date IS NULL THEN
      NEW.paid_date = now();
    END IF;
    IF NEW.status = 'churned' AND NEW.churn_date IS NULL THEN
      NEW.churn_date = now();
    END IF;
    IF NEW.status = 'trial' AND NEW.trial_start_date IS NULL THEN
      NEW.trial_start_date = now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contacts_log_status_change ON marketing.contacts;
CREATE TRIGGER trg_contacts_log_status_change
  BEFORE UPDATE OF status ON marketing.contacts
  FOR EACH ROW EXECUTE FUNCTION marketing.log_contact_status_change();


-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Helper Views
-- ─────────────────────────────────────────────────────────────────────────────

-- 9a. marketing.v_waitlist_nurture_due
-- Contacts who need a waitlist nurture email TODAY based on day-offset
-- from signup_date, with an idempotency guard via NOT EXISTS on email_log.
-- The schedulers (Workflow B) SELECT * FROM marketing.v_waitlist_nurture_due
-- and batch-send. The expected_template column pre-computes the template
-- name so the Switch node in n8n can route without re-deriving it.
CREATE OR REPLACE VIEW marketing.v_waitlist_nurture_due AS
SELECT
  c.id                            AS contact_id,
  c.email,
  c.first_name,
  c.business_name,
  c.city,
  c.industry_type,
  c.source,
  c.signup_date,
  EXTRACT(DAY FROM (now() - c.signup_date))::int AS day_offset,
  CASE EXTRACT(DAY FROM (now() - c.signup_date))::int
    WHEN 2  THEN (c.industry_type::text || '-waitlist-intel')
    WHEN 5  THEN (c.industry_type::text || '-waitlist-proof')
    WHEN 8  THEN (c.industry_type::text || '-waitlist-feature')
    WHEN 12 THEN (c.industry_type::text || '-waitlist-soon')
  END                             AS expected_template
FROM marketing.contacts c
WHERE c.status = 'waitlist'
  AND c.industry_type IN ('restaurant','liquor_store')
  AND EXTRACT(DAY FROM (now() - c.signup_date))::int IN (2,5,8,12)
  AND NOT EXISTS (
    SELECT 1 FROM marketing.email_log el
    WHERE el.contact_id = c.id
      AND el.template = (
        CASE EXTRACT(DAY FROM (now() - c.signup_date))::int
          WHEN 2  THEN (c.industry_type::text || '-waitlist-intel')
          WHEN 5  THEN (c.industry_type::text || '-waitlist-proof')
          WHEN 8  THEN (c.industry_type::text || '-waitlist-feature')
          WHEN 12 THEN (c.industry_type::text || '-waitlist-soon')
        END
      )
      AND el.status IN ('queued','sent','opened','clicked')
  );

COMMENT ON VIEW marketing.v_waitlist_nurture_due IS
  'Driver view for Workflow B (nurture scheduler). One row per contact × day_offset to send today.';


-- 9b. marketing.v_trial_onboarding_due
-- Parallel to v_waitlist_nurture_due, but driven by trial_start_date.
-- Day 14 transitions the contact to churned unless they already paid —
-- that state change is performed by Workflow D, not the view.
CREATE OR REPLACE VIEW marketing.v_trial_onboarding_due AS
SELECT
  c.id                            AS contact_id,
  c.email,
  c.first_name,
  c.business_name,
  c.city,
  c.industry_type,
  c.status,
  c.posthog_distinct_id,
  c.trial_start_date,
  EXTRACT(DAY FROM (now() - c.trial_start_date))::int AS day_offset,
  CASE EXTRACT(DAY FROM (now() - c.trial_start_date))::int
    WHEN 0  THEN (c.industry_type::text || '-trial-start')
    WHEN 3  THEN (c.industry_type::text || '-trial-checkin')
    WHEN 7  THEN (c.industry_type::text || '-trial-mid')
    WHEN 10 THEN (c.industry_type::text || '-trial-nudge')
    WHEN 13 THEN (c.industry_type::text || '-trial-convert')
    WHEN 14 THEN (c.industry_type::text || '-trial-end')
  END                             AS expected_template
FROM marketing.contacts c
WHERE c.status = 'trial'
  AND c.industry_type IN ('restaurant','liquor_store')
  AND c.trial_start_date IS NOT NULL
  AND EXTRACT(DAY FROM (now() - c.trial_start_date))::int IN (0,3,7,10,13,14)
  AND NOT EXISTS (
    SELECT 1 FROM marketing.email_log el
    WHERE el.contact_id = c.id
      AND el.template = (
        CASE EXTRACT(DAY FROM (now() - c.trial_start_date))::int
          WHEN 0  THEN (c.industry_type::text || '-trial-start')
          WHEN 3  THEN (c.industry_type::text || '-trial-checkin')
          WHEN 7  THEN (c.industry_type::text || '-trial-mid')
          WHEN 10 THEN (c.industry_type::text || '-trial-nudge')
          WHEN 13 THEN (c.industry_type::text || '-trial-convert')
          WHEN 14 THEN (c.industry_type::text || '-trial-end')
        END
      )
      AND el.status IN ('queued','sent','opened','clicked')
  );

COMMENT ON VIEW marketing.v_trial_onboarding_due IS
  'Driver view for Workflow D (trial onboarding scheduler).';


-- 9c. marketing.v_auric_crosssell_due
-- Forward-looking for Build Item 16. Mirrors the briefing §6.8 spec.
CREATE OR REPLACE VIEW marketing.v_auric_crosssell_due AS
SELECT
  c.id                            AS contact_id,
  c.email,
  c.first_name,
  c.business_name,
  c.industry_type,
  c.trial_start_date,
  EXTRACT(DAY FROM (now() - c.trial_start_date))::int AS day_offset,
  CASE EXTRACT(DAY FROM (now() - c.trial_start_date))::int
    WHEN 60 THEN 'auric-crosssell-intro'
    WHEN 67 THEN 'auric-crosssell-usecase'
    WHEN 75 THEN 'auric-crosssell-final'
  END                             AS expected_template
FROM marketing.contacts c
WHERE c.industry_type IN ('restaurant','liquor_store')
  AND c.status IN ('trial','paid')
  AND c.trial_start_date IS NOT NULL
  AND EXTRACT(DAY FROM (now() - c.trial_start_date))::int IN (60,67,75)
  AND NOT EXISTS (
    SELECT 1 FROM marketing.email_log el
    WHERE el.contact_id = c.id
      AND el.template LIKE 'auric-crosssell-%'
      AND el.sent_at::date = current_date
  );

COMMENT ON VIEW marketing.v_auric_crosssell_due IS
  'Driver view for Build Item 16 (Auric cross-sell). Day 60/67/75 of Ticket/Neat trial.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Row-Level Security
-- ─────────────────────────────────────────────────────────────────────────────
-- n8n uses the service_role key, which bypasses RLS by design. The policies
-- below are belt-and-suspenders: even if someone accidentally exposes the
-- anon key to the webhook, nothing in these tables is readable or writable.

ALTER TABLE marketing.contacts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing.email_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing.events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing.failed_events ENABLE ROW LEVEL SECURITY;

-- Explicit deny-all for anon. Without any policy, RLS denies by default,
-- but writing an explicit policy makes intent reviewable.
DROP POLICY IF EXISTS contacts_anon_deny       ON marketing.contacts;
DROP POLICY IF EXISTS email_log_anon_deny      ON marketing.email_log;
DROP POLICY IF EXISTS events_anon_deny         ON marketing.events;
DROP POLICY IF EXISTS failed_events_anon_deny  ON marketing.failed_events;

CREATE POLICY contacts_anon_deny      ON marketing.contacts      FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY email_log_anon_deny     ON marketing.email_log     FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY events_anon_deny        ON marketing.events        FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY failed_events_anon_deny ON marketing.failed_events FOR ALL TO anon USING (false) WITH CHECK (false);

-- service_role has unrestricted access. Granting explicitly for clarity.
-- Scoped to the marketing schema only — does not affect Vatic's public schema.
GRANT USAGE  ON SCHEMA marketing TO service_role;
GRANT ALL    ON ALL TABLES    IN SCHEMA marketing TO service_role;
GRANT ALL    ON ALL SEQUENCES IN SCHEMA marketing TO service_role;
GRANT SELECT ON marketing.v_waitlist_nurture_due   TO service_role;
GRANT SELECT ON marketing.v_trial_onboarding_due   TO service_role;
GRANT SELECT ON marketing.v_auric_crosssell_due    TO service_role;

-- Explicitly revoke everything from anon. Supabase's default grants include
-- USAGE on `public` schema for anon — we do not grant USAGE on `marketing`.
REVOKE ALL ON SCHEMA marketing FROM anon;
REVOKE ALL ON ALL TABLES    IN SCHEMA marketing FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA marketing FROM anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Sample Seed Data (commented — uncomment for local dev only)
-- ─────────────────────────────────────────────────────────────────────────────
-- Three fixtures covering the happy-path lifecycle states.
--
-- INSERT INTO marketing.contacts
--   (email, first_name, last_name, industry_type, business_name,
--    location_count, city, status, source, signup_date)
-- VALUES
--   -- (1) Fresh waitlist signup — should receive Day-0 welcome via Workflow A.
--   ('chef.garcia@lomito.test', 'Ana', 'Garcia',
--    'restaurant', 'Lomito Austin',
--    '2-5', 'Austin', 'waitlist', 'getticket.ai', now() - interval '1 hour'),
--
--   -- (2) Day-5 waitlist contact — should match v_waitlist_nurture_due today
--   --     for ticket-waitlist-proof.
--   ('owner@pequenoburro.test', 'Marco', 'Ruiz',
--    'restaurant', 'El Pequeño Burro',
--    '1', 'Dallas', 'waitlist', 'getticket.ai', now() - interval '5 days'),
--
--   -- (3) Mid-trial contact, Day 3 — Workflow D should skip checkin if
--   --     PostHog login_count >= 3.
--   ('gm@neatliquor.test', 'Jordan', 'Patel',
--    'liquor_store', 'Neat Liquor Midtown',
--    '6-20', 'Houston', 'trial', 'goneat.ai', now() - interval '15 days');
--
-- UPDATE marketing.contacts
-- SET access_granted_date        = now() - interval '4 days',
--     access_granted_notified_at = now() - interval '4 days',
--     trial_start_date           = now() - interval '3 days'
-- WHERE email = 'gm@neatliquor.test';

-- =============================================================================
-- END OF SCHEMA
-- =============================================================================
