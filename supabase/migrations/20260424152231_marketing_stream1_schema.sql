-- Stream 1 Supabase schema (marketing.contacts / email_log / events / failed_events + views).
-- Source: app/docs/stream1-supabase-schema.sql v1.2 (2026-04-22, industry_type enum aligned).
-- Owner: Chris (marketing automation). Applied from the repo with ONE deviation:
--
-- DEVIATION: trial_end_date is maintained by a BEFORE INSERT/UPDATE trigger
-- instead of the file's GENERATED ALWAYS AS (trial_start_date + interval
-- '14 days') STORED. Postgres 17 still classifies timestamptz + interval as
-- STABLE (not IMMUTABLE), so the STORED expression is rejected at CREATE
-- TABLE time. The three driver views don't reference trial_end_date, so
-- this is transparent to Stream 1 workflows. Chris needs to pick one of:
--   (a) change the column type to `timestamp` (not timestamptz),
--   (b) leave the trigger-maintained approach, or
--   (c) drop the column.
-- Documented at BLUEPRINT Section 12.9 Phase 3 deploy notes.

CREATE SCHEMA IF NOT EXISTS marketing;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

DO $$ BEGIN
  CREATE TYPE marketing.contact_status AS ENUM (
    'waitlist', 'access_granted', 'trial', 'paid', 'churned', 'archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE marketing.industry_type AS ENUM (
    'restaurant', 'liquor_store', 'coffee', 'salon', 'fitness', 'retail', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE marketing.email_status AS ENUM (
    'queued', 'sent', 'failed', 'bounced', 'opened', 'clicked'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS marketing.contacts (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                       citext NOT NULL UNIQUE,
  first_name                  text,
  last_name                   text,
  industry_type               marketing.industry_type NOT NULL,
  business_name               text,
  location_count              text,
  city                        text,
  status                      marketing.contact_status NOT NULL DEFAULT 'waitlist',
  source                      text NOT NULL DEFAULT 'getticket.ai',
  signup_date                 timestamptz NOT NULL DEFAULT now(),
  access_granted_date         timestamptz,
  access_granted_notified_at  timestamptz,
  trial_start_date            timestamptz,
  trial_end_date              timestamptz,
  paid_date                   timestamptz,
  churn_date                  timestamptz,
  stripe_customer_id          text,
  posthog_distinct_id         text,
  clay_enrichment             jsonb NOT NULL DEFAULT '{}'::jsonb,
  tags                        text[] NOT NULL DEFAULT ARRAY[]::text[],
  auric_crosssell_sent_at     timestamptz,
  notes                       text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contacts_source_chk CHECK (
    source IN ('getticket.ai','goneat.ai','auricmobile.app','outbound','referral','import','manual')
  ),
  CONSTRAINT contacts_access_logical_chk CHECK (
    access_granted_notified_at IS NULL OR access_granted_date IS NOT NULL
  )
);

COMMENT ON TABLE  marketing.contacts IS 'Master contact record. One row per email across Ticket + Neat; industry_type discriminates.';
COMMENT ON COLUMN marketing.contacts.location_count IS 'Dropdown value 1|2-5|6-20|21-50|50+ - stored raw, mapped to tags by workflow.';
COMMENT ON COLUMN marketing.contacts.trial_end_date IS 'Maintained by trg_contacts_set_trial_end_date = trial_start_date + 14d. Rebase by updating trial_start_date.';
COMMENT ON COLUMN marketing.contacts.access_granted_notified_at IS 'Set by Workflow C after sending access-granted email. Double-send guard.';
COMMENT ON COLUMN marketing.contacts.posthog_distinct_id IS 'Written by Ticket/Neat app backend on first login. Same-DB coupling requirement.';
COMMENT ON COLUMN marketing.contacts.clay_enrichment IS 'Raw Clay response JSON. Schema-agnostic.';
COMMENT ON COLUMN marketing.contacts.auric_crosssell_sent_at IS 'Reserved for Build Item 16 (Auric cross-sell scheduler).';

CREATE TABLE IF NOT EXISTS marketing.email_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      uuid NOT NULL REFERENCES marketing.contacts(id) ON DELETE CASCADE,
  template        text NOT NULL,
  brand           text NOT NULL,
  status          marketing.email_status NOT NULL DEFAULT 'queued',
  resend_email_id text,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  opened_at       timestamptz,
  clicked_at      timestamptz,
  bounced_at      timestamptz,
  error_message   text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT email_log_brand_chk CHECK (brand IN ('ticket','neat','auric','alive-labs'))
);

COMMENT ON TABLE  marketing.email_log IS 'Append-only audit. Stream 1 schedulers check here for idempotency.';
COMMENT ON COLUMN marketing.email_log.resend_email_id IS 'Returned by POST /emails. Used to correlate email.opened / email.clicked webhooks.';

CREATE TABLE IF NOT EXISTS marketing.events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id  uuid REFERENCES marketing.contacts(id) ON DELETE CASCADE,
  event_type  text NOT NULL,
  event_data  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE marketing.events IS 'Lifecycle event stream. Auto-populated on contacts.status change.';

CREATE TABLE IF NOT EXISTS marketing.failed_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_name  text NOT NULL,
  node_name      text NOT NULL,
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message  text,
  failed_at      timestamptz NOT NULL DEFAULT now(),
  retry_count    integer NOT NULL DEFAULT 0,
  resolved_at    timestamptz,
  resolved_by    text
);

COMMENT ON TABLE marketing.failed_events IS 'Dead-letter queue. n8n writes after 3 failed retries. Resolve manually.';

CREATE INDEX IF NOT EXISTS idx_contacts_status              ON marketing.contacts (status);
CREATE INDEX IF NOT EXISTS idx_contacts_industry_status     ON marketing.contacts (industry_type, status);
CREATE INDEX IF NOT EXISTS idx_contacts_signup_date         ON marketing.contacts (signup_date);
CREATE INDEX IF NOT EXISTS idx_contacts_trial_start_date    ON marketing.contacts (trial_start_date) WHERE trial_start_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_source              ON marketing.contacts (source);
CREATE INDEX IF NOT EXISTS idx_contacts_stripe_customer_id  ON marketing.contacts (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_log_contact_id         ON marketing.email_log (contact_id);
CREATE INDEX IF NOT EXISTS idx_email_log_template_contact   ON marketing.email_log (contact_id, template);
CREATE INDEX IF NOT EXISTS idx_email_log_sent_at            ON marketing.email_log (sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_resend_email_id    ON marketing.email_log (resend_email_id) WHERE resend_email_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_contact_id            ON marketing.events (contact_id);
CREATE INDEX IF NOT EXISTS idx_events_event_type            ON marketing.events (event_type);
CREATE INDEX IF NOT EXISTS idx_events_created_at            ON marketing.events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_failed_events_unresolved     ON marketing.failed_events (failed_at DESC) WHERE resolved_at IS NULL;

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

-- Trigger substitute for the rejected GENERATED STORED column.
-- Runs BEFORE INSERT/UPDATE so callers can never diverge trial_end_date
-- from trial_start_date + 14d.
CREATE OR REPLACE FUNCTION marketing.set_trial_end_date()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.trial_end_date := CASE
    WHEN NEW.trial_start_date IS NULL THEN NULL
    ELSE NEW.trial_start_date + interval '14 days'
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contacts_set_trial_end_date ON marketing.contacts;
CREATE TRIGGER trg_contacts_set_trial_end_date
  BEFORE INSERT OR UPDATE OF trial_start_date ON marketing.contacts
  FOR EACH ROW EXECUTE FUNCTION marketing.set_trial_end_date();

CREATE OR REPLACE FUNCTION marketing.log_contact_status_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO marketing.events (contact_id, event_type, event_data)
    VALUES (
      NEW.id,
      'status_change',
      jsonb_build_object(
        'from',          OLD.status,
        'to',            NEW.status,
        'industry_type', NEW.industry_type,
        'email',         NEW.email
      )
    );
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

CREATE OR REPLACE VIEW marketing.v_waitlist_nurture_due AS
SELECT
  c.id AS contact_id, c.email, c.first_name, c.business_name, c.city,
  c.industry_type, c.source, c.signup_date,
  EXTRACT(DAY FROM (now() - c.signup_date))::int AS day_offset,
  CASE EXTRACT(DAY FROM (now() - c.signup_date))::int
    WHEN 2  THEN (c.industry_type::text || '-waitlist-intel')
    WHEN 5  THEN (c.industry_type::text || '-waitlist-proof')
    WHEN 8  THEN (c.industry_type::text || '-waitlist-feature')
    WHEN 12 THEN (c.industry_type::text || '-waitlist-soon')
  END AS expected_template
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
  'Driver view for Workflow B (nurture scheduler). One row per contact x day_offset to send today.';

CREATE OR REPLACE VIEW marketing.v_trial_onboarding_due AS
SELECT
  c.id AS contact_id, c.email, c.first_name, c.business_name, c.city,
  c.industry_type, c.status, c.posthog_distinct_id, c.trial_start_date,
  EXTRACT(DAY FROM (now() - c.trial_start_date))::int AS day_offset,
  CASE EXTRACT(DAY FROM (now() - c.trial_start_date))::int
    WHEN 0  THEN (c.industry_type::text || '-trial-start')
    WHEN 3  THEN (c.industry_type::text || '-trial-checkin')
    WHEN 7  THEN (c.industry_type::text || '-trial-mid')
    WHEN 10 THEN (c.industry_type::text || '-trial-nudge')
    WHEN 13 THEN (c.industry_type::text || '-trial-convert')
    WHEN 14 THEN (c.industry_type::text || '-trial-end')
  END AS expected_template
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

CREATE OR REPLACE VIEW marketing.v_auric_crosssell_due AS
SELECT
  c.id AS contact_id, c.email, c.first_name, c.business_name,
  c.industry_type, c.trial_start_date,
  EXTRACT(DAY FROM (now() - c.trial_start_date))::int AS day_offset,
  CASE EXTRACT(DAY FROM (now() - c.trial_start_date))::int
    WHEN 60 THEN 'auric-crosssell-intro'
    WHEN 67 THEN 'auric-crosssell-usecase'
    WHEN 75 THEN 'auric-crosssell-final'
  END AS expected_template
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

ALTER TABLE marketing.contacts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing.email_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing.events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing.failed_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contacts_anon_deny       ON marketing.contacts;
DROP POLICY IF EXISTS email_log_anon_deny      ON marketing.email_log;
DROP POLICY IF EXISTS events_anon_deny         ON marketing.events;
DROP POLICY IF EXISTS failed_events_anon_deny  ON marketing.failed_events;

CREATE POLICY contacts_anon_deny      ON marketing.contacts      FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY email_log_anon_deny     ON marketing.email_log     FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY events_anon_deny        ON marketing.events        FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY failed_events_anon_deny ON marketing.failed_events FOR ALL TO anon USING (false) WITH CHECK (false);

GRANT USAGE  ON SCHEMA marketing TO service_role;
GRANT ALL    ON ALL TABLES    IN SCHEMA marketing TO service_role;
GRANT ALL    ON ALL SEQUENCES IN SCHEMA marketing TO service_role;
GRANT SELECT ON marketing.v_waitlist_nurture_due   TO service_role;
GRANT SELECT ON marketing.v_trial_onboarding_due   TO service_role;
GRANT SELECT ON marketing.v_auric_crosssell_due    TO service_role;

REVOKE ALL ON SCHEMA marketing FROM anon;
REVOKE ALL ON ALL TABLES    IN SCHEMA marketing FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA marketing FROM anon;
