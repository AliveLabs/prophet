-- Stream 2 Outbound — marketing schema additions (per Chris, 2026-05-25).
-- Idempotent: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / ON CONFLICT DO NOTHING.
-- BEGIN/COMMIT stripped — Supabase apply_migration runs inside its own transaction.

CREATE TABLE IF NOT EXISTS marketing.outbound_queue (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand                 text NOT NULL,
  track                 text,
  email                 citext NOT NULL,
  first_name            text,
  last_name             text,
  company               text,
  title                 text,
  city                  text,
  clay_table_id         text,
  clay_row_id           text,
  clay_payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                text NOT NULL DEFAULT 'pending',
  failure_reason        text,
  personalized_hook     text,
  hook_quality          text,
  picked_up_at          timestamptz,
  sent_to_instantly_at  timestamptz,
  prospect_id           uuid,
  metadata              jsonb DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_outbound_queue_brand_status
  ON marketing.outbound_queue (brand, status, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS ux_outbound_queue_email_active
  ON marketing.outbound_queue (brand, email)
  WHERE status IN ('pending', 'personalized');

COMMENT ON TABLE marketing.outbound_queue IS
  'Stream 2: Clay → Supabase queue. OB cron workflows pull FROM here. Inverts the arch doc OB4 (Clay pull) → uses Item 23 webhook receiver.';

CREATE TABLE IF NOT EXISTS marketing.prospects (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                    citext UNIQUE NOT NULL,
  brand                    text NOT NULL,
  track                    text,
  source                   text NOT NULL,
  clay_table_id            text,
  clay_row_id              text,
  instantly_campaign_id    text,
  instantly_contact_id     text,
  status                   text NOT NULL DEFAULT 'queued',
  first_sent_at            timestamptz,
  first_replied_at         timestamptz,
  converted_to_contact_id  uuid REFERENCES marketing.contacts(id),
  metadata                 jsonb DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_prospects_brand_status
  ON marketing.prospects (brand, status);
CREATE INDEX IF NOT EXISTS ix_prospects_instantly_contact_id
  ON marketing.prospects (instantly_contact_id) WHERE instantly_contact_id IS NOT NULL;

COMMENT ON TABLE marketing.prospects IS
  'Stream 2: one row per outbound prospect (cross-brand UNIQUE on email). Holds Instantly campaign/contact IDs + lifecycle status. Per arch §3.20.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_outbound_queue_prospect_id'
  ) THEN
    ALTER TABLE marketing.outbound_queue
      ADD CONSTRAINT fk_outbound_queue_prospect_id
      FOREIGN KEY (prospect_id) REFERENCES marketing.prospects(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS marketing.replies_processed (
  reply_id        text PRIMARY KEY,
  prospect_id     uuid REFERENCES marketing.prospects(id),
  email           citext NOT NULL,
  brand           text NOT NULL,
  track           text,
  processed_at    timestamptz NOT NULL DEFAULT now(),
  classification  text,
  metadata        jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS ix_replies_processed_email
  ON marketing.replies_processed (email);

COMMENT ON TABLE marketing.replies_processed IS
  'Stream 2: idempotency anchor for reply webhooks. Keyed on Instantly reply_id. Per arch §2.6.';

CREATE TABLE IF NOT EXISTS marketing.studio_outbound_pending_approval (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clay_table_id       text,
  clay_row_id         text,
  outbound_queue_id   uuid REFERENCES marketing.outbound_queue(id),
  email               citext NOT NULL,
  first_name          text,
  last_name           text,
  company             text,
  title               text,
  personalized_hook   text,
  status              text NOT NULL DEFAULT 'pending',
  approved_by         text,
  approved_at         timestamptz,
  disqualified_reason text,
  metadata            jsonb DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_studio_pending_status
  ON marketing.studio_outbound_pending_approval (status, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS ux_studio_pending_email_pending
  ON marketing.studio_outbound_pending_approval (email)
  WHERE status = 'pending';

COMMENT ON TABLE marketing.studio_outbound_pending_approval IS
  'Stream 2 Studio: human-approval queue. Studio never auto-sends — every personalized hook lands here for review before Instantly add. Per other-brands arch §5.2.';

CREATE TABLE IF NOT EXISTS marketing.shared_domain_daily_counter (
  domain       text NOT NULL,
  send_date    date NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  daily_cap    integer NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (domain, send_date)
);

COMMENT ON TABLE marketing.shared_domain_daily_counter IS
  'Stream 2: per-domain daily send-count tracker. Alive Labs needs this because Cerno/Veris/Studio share alive-labs.co — without coordination, three tracks at 50/day each = 150/day, exceeds the warm cap.';

INSERT INTO marketing.shared_domain_daily_counter (domain, send_date, count, daily_cap)
VALUES
  ('alive-labs.co', CURRENT_DATE,                       0, 100),
  ('alive-labs.co', CURRENT_DATE + INTERVAL '1 day',    0, 100),
  ('alive-labs.co', CURRENT_DATE + INTERVAL '2 day',    0, 100)
ON CONFLICT (domain, send_date) DO NOTHING;

GRANT USAGE ON SCHEMA marketing TO service_role, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON marketing.outbound_queue,
     marketing.prospects,
     marketing.replies_processed,
     marketing.studio_outbound_pending_approval,
     marketing.shared_domain_daily_counter
  TO service_role;
GRANT SELECT
  ON marketing.outbound_queue,
     marketing.prospects,
     marketing.replies_processed,
     marketing.studio_outbound_pending_approval,
     marketing.shared_domain_daily_counter
  TO anon, authenticated;

CREATE OR REPLACE VIEW marketing.v_outbound_queue_depth AS
SELECT
  brand,
  COALESCE(track, '(none)')                   AS track,
  status,
  COUNT(*)                                    AS row_count,
  MIN(created_at)                             AS oldest_created_at,
  MAX(created_at)                             AS newest_created_at
FROM marketing.outbound_queue
GROUP BY brand, track, status
ORDER BY brand, track, status;

GRANT SELECT ON marketing.v_outbound_queue_depth TO service_role, anon, authenticated;
