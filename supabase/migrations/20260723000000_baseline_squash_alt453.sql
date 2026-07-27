--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

-- ALT-453 baseline prep: ensure the app role exists before its GRANTs (branches
-- start without it). Guarded so it's a no-op where the role already exists.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='marketing_ops')
  THEN CREATE ROLE marketing_ops NOLOGIN; END IF; END $$;

--
-- Name: marketing; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS marketing;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;

-- ALT-453 baseline prep: citext lives in public on prod (marketing.contacts.email uses
-- public.citext); schema-only dump omits the extension, so recreate it before first use.
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: contact_status; Type: TYPE; Schema: marketing; Owner: -
--

CREATE TYPE marketing.contact_status AS ENUM (
    'waitlist',
    'access_granted',
    'trial',
    'paid',
    'churned',
    'archived'
);


--
-- Name: email_status; Type: TYPE; Schema: marketing; Owner: -
--

CREATE TYPE marketing.email_status AS ENUM (
    'queued',
    'sent',
    'failed',
    'bounced',
    'opened',
    'clicked'
);


--
-- Name: industry_type; Type: TYPE; Schema: marketing; Owner: -
--

CREATE TYPE marketing.industry_type AS ENUM (
    'restaurant',
    'liquor_store',
    'coffee',
    'salon',
    'fitness',
    'retail',
    'other'
);


--
-- Name: filter_new_mentions(text[]); Type: FUNCTION; Schema: marketing; Owner: -
--

CREATE FUNCTION marketing.filter_new_mentions(incoming_hashes text[]) RETURNS TABLE(mention_id text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'marketing', 'public', 'pg_catalog'
    AS $$
  SELECT m.mention_id
  FROM marketing.mentions m
  WHERE m.mention_id = ANY(incoming_hashes);
$$;


--
-- Name: FUNCTION filter_new_mentions(incoming_hashes text[]); Type: COMMENT; Schema: marketing; Owner: -
--

COMMENT ON FUNCTION marketing.filter_new_mentions(incoming_hashes text[]) IS 'Stream 5 v2 dedup helper. Given an array of mention_id hashes, returns those already in marketing.mentions. n8n M5 uses this to filter freshly-fetched Exa results down to the not-yet-seen subset.';


--
-- Name: log_contact_status_change(); Type: FUNCTION; Schema: marketing; Owner: -
--

CREATE FUNCTION marketing.log_contact_status_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'marketing', 'public', 'pg_catalog'
    AS $$
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


--
-- Name: notify_access_granted(); Type: FUNCTION; Schema: marketing; Owner: -
--

CREATE FUNCTION marketing.notify_access_granted() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'marketing', 'public', 'pg_catalog'
    AS $$
DECLARE
  v_webhook_url   text;
  v_secret        text;
BEGIN
  IF NEW.status = 'access_granted'
     AND OLD.status IS DISTINCT FROM 'access_granted'
     AND NEW.access_granted_notified_at IS NULL THEN

    v_webhook_url := CASE NEW.industry_type::text
      WHEN 'restaurant'   THEN 'https://n8n-production-6d1e.up.railway.app/webhook/ticket-access-granted'
      WHEN 'liquor_store' THEN 'https://n8n-production-6d1e.up.railway.app/webhook/neat-access-granted'
      ELSE NULL
    END;

    IF v_webhook_url IS NULL THEN
      RETURN NEW;
    END IF;

    -- Read from Supabase Vault (encrypted at rest)
    BEGIN
      SELECT decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets
      WHERE name = 'n8n_webhook_secret'
      LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      v_secret := '';
    END;

    PERFORM extensions.http_post(
      url     := v_webhook_url,
      headers := jsonb_build_object(
        'content-type',     'application/json',
        'x-webhook-secret', COALESCE(v_secret, '')
      ),
      body    := jsonb_build_object(
        'contact_id',    NEW.id,
        'email',         NEW.email,
        'first_name',    NEW.first_name,
        'industry_type', NEW.industry_type
      )
    );
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: set_trial_end_date(); Type: FUNCTION; Schema: marketing; Owner: -
--

CREATE FUNCTION marketing.set_trial_end_date() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'marketing', 'public', 'pg_catalog'
    AS $$
BEGIN
  NEW.trial_end_date := CASE
    WHEN NEW.trial_start_date IS NULL THEN NULL
    ELSE NEW.trial_start_date + interval '14 days'
  END;
  RETURN NEW;
END;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: marketing; Owner: -
--

CREATE FUNCTION marketing.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'marketing', 'public', 'pg_catalog'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: cascade_delete_organization(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cascade_delete_organization(p_org_id uuid, p_keep_shell boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_org_name text;
  v_loc_ids uuid[];
  v_comp_ids uuid[];
  v_social int := 0;
  v_nulled int := 0;
  v_d int;
begin
  select name into v_org_name from organizations where id = p_org_id;

  select coalesce(array_agg(id), '{}') into v_loc_ids
    from locations where organization_id = p_org_id;

  select coalesce(array_agg(c.id), '{}') into v_comp_ids
    from competitors c where c.location_id = any(v_loc_ids);

  -- Polymorphic social_profiles have NO FK to org/location/competitor, so DB cascade never
  -- reaches them — delete explicitly (social_snapshots cascade via their FK to social_profiles).
  delete from social_profiles where entity_type = 'location' and entity_id = any(v_loc_ids);
  get diagnostics v_d = row_count; v_social := v_social + v_d;
  delete from social_profiles where entity_type = 'competitor' and entity_id = any(v_comp_ids);
  get diagnostics v_d = row_count; v_social := v_social + v_d;

  if p_keep_shell then
    delete from locations where organization_id = p_org_id; -- cascades the location subtree
    delete from refresh_jobs where organization_id = p_org_id;
    delete from signal_jobs where organization_id = p_org_id;
    delete from job_runs where organization_id = p_org_id;
    delete from insight_preferences where organization_id = p_org_id;
    delete from trial_reminder_sends where organization_id = p_org_id;
  else
    update profiles set current_organization_id = null where current_organization_id = p_org_id;
    get diagnostics v_nulled = row_count;
    delete from organizations where id = p_org_id; -- cascades the whole subtree
  end if;

  return jsonb_build_object(
    'orgId', p_org_id,
    'orgName', v_org_name,
    'keptShell', p_keep_shell,
    'locationsDeleted', coalesce(array_length(v_loc_ids, 1), 0),
    'competitorsDeleted', coalesce(array_length(v_comp_ids, 1), 0),
    'socialProfilesDeleted', v_social,
    'profilePointersNulled', v_nulled
  );
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: signal_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.signal_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    location_id uuid NOT NULL,
    pipeline text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    cursor jsonb,
    scheduled_for timestamp with time zone DEFAULT now() NOT NULL,
    claimed_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT signal_jobs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'done'::text, 'failed'::text])))
);


--
-- Name: claim_signal_jobs(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_signal_jobs(batch integer) RETURNS SETOF public.signal_jobs
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$ update signal_jobs j set status='running', claimed_at=now(), attempts=attempts+1, updated_at=now() where j.id in (select id from signal_jobs where status='queued' and scheduled_for <= now() order by created_at limit greatest(batch,0) for update skip locked) returning j.*; $$;


--
-- Name: is_org_admin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_org_admin(org_id uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from organization_members m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  );
$$;


--
-- Name: is_org_member(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_org_member(org_id uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from organization_members m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
  );
$$;


--
-- Name: update_waitlist_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_waitlist_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_catalog'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: contacts; Type: TABLE; Schema: marketing; Owner: -
--

CREATE TABLE marketing.contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email public.citext NOT NULL,
    first_name text,
    last_name text,
    industry_type marketing.industry_type NOT NULL,
    business_name text,
    location_count text,
    city text,
    status marketing.contact_status DEFAULT 'waitlist'::marketing.contact_status NOT NULL,
    source text DEFAULT 'getticket.ai'::text NOT NULL,
    signup_date timestamp with time zone DEFAULT now() NOT NULL,
    access_granted_date timestamp with time zone,
    access_granted_notified_at timestamp with time zone,
    trial_start_date timestamp with time zone,
    trial_end_date timestamp with time zone,
    paid_date timestamp with time zone,
    churn_date timestamp with time zone,
    stripe_customer_id text,
    posthog_distinct_id text,
    clay_enrichment jsonb DEFAULT '{}'::jsonb NOT NULL,
    tags text[] DEFAULT ARRAY[]::text[] NOT NULL,
    auric_crosssell_sent_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    phone text,
    sms_opt_in boolean DEFAULT false NOT NULL,
    sms_opt_in_date timestamp with time zone,
    CONSTRAINT contacts_access_logical_chk CHECK (((access_granted_notified_at IS NULL) OR (access_granted_date IS NOT NULL))),
    CONSTRAINT contacts_source_chk CHECK ((source = ANY (ARRAY['getticket.ai'::text, 'goneat.ai'::text, 'useneat.ai'::text, 'auricmobile.app'::text, 'alivemethod.com'::text, 'peoplepartners.ai'::text, 'outbound'::text, 'referral'::text, 'import'::text, 'manual'::text])))
);


--
-- Name: TABLE contacts; Type: COMMENT; Schema: marketing; Owner: -
--

COMMENT ON TABLE marketing.contacts IS 'Master contact record. One row per email across Ticket + Neat; industry_type discriminates.';


--
-- Name: COLUMN contacts.location_count; Type: COMMENT; Schema: marketing; Owner: -
--

COMMENT ON COLUMN marketing.contacts.location_count IS 'Dropdown value 1|2-5|6-20|21-50|50+ - stored raw, mapped to tags by workflow.';


--
-- Name: COLUMN contacts.access_granted_notified_at; Type: COMMENT; Schema: marketing; Owner: -
--

COMMENT ON COLUMN marketing.contacts.access_granted_notified_at IS 'Set by Workflow C after sending access-granted email. Double-send guard.';


--
-- Name: COLUMN contacts.trial_end_date; Type: COMMENT; Schema: marketing; Owner: -
--

COMMENT ON COLUMN marketing.contacts.trial_end_date IS 'Maintained by trg_contacts_set_trial_end_date = trial_start_date + 14d. Rebase by updating trial_start_date.';


--
-- Name: COLUMN contacts.posthog_distinct_id; Type: COMMENT; Schema: marketing; Owner: -
--

COMMENT ON COLUMN marketing.contacts.posthog_distinct_id IS 'Written by Ticket/Neat app backend on first login. Same-DB coupling requirement.';


--
-- Name: COLUMN contacts.clay_enrichment; Type: COMMENT; Schema: marketing; Owner: -
--

COMMENT ON COLUMN marketing.contacts.clay_enrichment IS 'Raw Clay response JSON. Schema-agnostic.';


--
-- Name: COLUMN contacts.auric_crosssell_sent_at; Type: COMMENT; Schema: marketing; Owner: -
--

COMMENT ON COLUMN marketing.contacts.auric_crosssell_sent_at IS 'Reserved for Build Item 16 (Auric cross-sell scheduler).';


--
-- Name: email_log; Type: TABLE; Schema: marketing; Owner: -
--

CREATE TABLE marketing.email_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid NOT NULL,
    template text NOT NULL,
    brand text NOT NULL,
    status marketing.email_status DEFAULT 'queued'::marketing.email_status NOT NULL,
    resend_email_id text,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    opened_at timestamp with time zone,
    clicked_at timestamp with time zone,
    bounced_at timestamp with time zone,
    error_message text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT email_log_brand_chk CHECK ((brand = ANY (ARRAY['ticket'::text, 'neat'::text, 'auric'::text, 'alivelabs'::text, 'peoplepartners'::text, 'method'::text])))
);


--
-- Name: TABLE email_log; Type: COMMENT; Schema: marketing; Owner: -
--

COMMENT ON TABLE marketing.email_log IS 'Append-only audit. Stream 1 schedulers check here for idempotency.';


--
-- Name: COLUMN email_log.resend_email_id; Type: COMMENT; Schema: marketing; Owner: -
--

COMMENT ON COLUMN marketing.email_log.resend_email_id IS 'Returned by POST /emails. Used to correlate email.opened / email.clicked webhooks.';


--
-- Name: events; Type: TABLE; Schema: marketing; Owner: -
--

CREATE TABLE marketing.events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid,
    event_type text NOT NULL,
    event_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE events; Type: COMMENT; Schema: marketing; Owner: -
--

COMMENT ON TABLE marketing.events IS 'Lifecycle event stream. Auto-populated on contacts.status change.';


--
-- Name: failed_events; Type: TABLE; Schema: marketing; Owner: -
--

CREATE TABLE marketing.failed_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workflow_name text NOT NULL,
    node_name text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    error_message text,
    failed_at timestamp with time zone DEFAULT now() NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by text
);


--
-- Name: TABLE failed_events; Type: COMMENT; Schema: marketing; Owner: -
--

COMMENT ON TABLE marketing.failed_events IS 'Dead-letter queue. n8n writes after 3 failed retries. Resolve manually.';


--
-- Name: mentions; Type: TABLE; Schema: marketing; Owner: -
--

CREATE TABLE marketing.mentions (
    mention_id text NOT NULL,
    brand text NOT NULL,
    source text NOT NULL,
    url text NOT NULL,
    title text,
    text text,
    author text,
    ts timestamp with time zone,
    sentiment text,
    is_prospect boolean DEFAULT false,
    summary text,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    discovery_source text DEFAULT 'exa'::text NOT NULL,
    source_platform text,
    author_reach integer,
    classification text,
    query_matched text,
    matched_competitor text,
    classifier_reason text,
    routed_to text[],
    CONSTRAINT mentions_brand_chk CHECK ((brand = ANY (ARRAY['ticket'::text, 'neat'::text, 'auric'::text, 'alivelabs'::text, 'peoplepartners'::text, 'method'::text]))),
    CONSTRAINT mentions_classification_chk CHECK (((classification IS NULL) OR (classification = ANY (ARRAY['brand_positive'::text, 'brand_neutral'::text, 'brand_negative'::text, 'competitor_signal'::text, 'prospect_signal'::text, 'noise'::text])))),
    CONSTRAINT mentions_sentiment_chk CHECK (((sentiment IS NULL) OR (sentiment = ANY (ARRAY['positive'::text, 'neutral'::text, 'negative'::text, 'unknown'::text]))))
);


--
-- Name: TABLE mentions; Type: COMMENT; Schema: marketing; Owner: -
--

COMMENT ON TABLE marketing.mentions IS 'Stream 5 monitoring (item 19, v2 — Exa+Claude as of 2026-05-31). Web mentions captured via Exa, classified by Claude. v1 (Brand24-era) columns retained for back-compat; v2 columns added 2026-05-31.';


--
-- Name: outbound_queue; Type: TABLE; Schema: marketing; Owner: -
--

CREATE TABLE marketing.outbound_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand text NOT NULL,
    track text,
    email public.citext NOT NULL,
    first_name text,
    last_name text,
    company text,
    title text,
    city text,
    clay_table_id text,
    clay_row_id text,
    clay_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    failure_reason text,
    personalized_hook text,
    hook_quality text,
    picked_up_at timestamp with time zone,
    sent_to_instantly_at timestamp with time zone,
    prospect_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE outbound_queue; Type: COMMENT; Schema: marketing; Owner: -
--

COMMENT ON TABLE marketing.outbound_queue IS 'Stream 2: Clay → Supabase queue. OB cron workflows pull FROM here. Inverts the arch doc OB4 (Clay pull) → uses Item 23 webhook receiver.';


--
-- Name: prospects; Type: TABLE; Schema: marketing; Owner: -
--

CREATE TABLE marketing.prospects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email public.citext NOT NULL,
    brand text NOT NULL,
    track text,
    source text NOT NULL,
    clay_table_id text,
    clay_row_id text,
    instantly_campaign_id text,
    instantly_contact_id text,
    status text DEFAULT 'queued'::text NOT NULL,
    first_sent_at timestamp with time zone,
    first_replied_at timestamp with time zone,
    converted_to_contact_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE prospects; Type: COMMENT; Schema: marketing; Owner: -
--

COMMENT ON TABLE marketing.prospects IS 'Stream 2: one row per outbound prospect (cross-brand UNIQUE on email). Holds Instantly campaign/contact IDs + lifecycle status. Per arch §3.20.';


--
-- Name: replies_processed; Type: TABLE; Schema: marketing; Owner: -
--

CREATE TABLE marketing.replies_processed (
    reply_id text NOT NULL,
    prospect_id uuid,
    email public.citext NOT NULL,
    brand text NOT NULL,
    track text,
    processed_at timestamp with time zone DEFAULT now() NOT NULL,
    classification text,
    metadata jsonb DEFAULT '{}'::jsonb
);


--
-- Name: TABLE replies_processed; Type: COMMENT; Schema: marketing; Owner: -
--

COMMENT ON TABLE marketing.replies_processed IS 'Stream 2: idempotency anchor for reply webhooks. Keyed on Instantly reply_id. Per arch §2.6.';


--
-- Name: shared_domain_daily_counter; Type: TABLE; Schema: marketing; Owner: -
--

CREATE TABLE marketing.shared_domain_daily_counter (
    domain text NOT NULL,
    send_date date NOT NULL,
    count integer DEFAULT 0 NOT NULL,
    daily_cap integer NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE shared_domain_daily_counter; Type: COMMENT; Schema: marketing; Owner: -
--

COMMENT ON TABLE marketing.shared_domain_daily_counter IS 'Stream 2: per-domain daily send-count tracker. Alive Labs needs this because Cerno/Veris/Studio share alive-labs.co — without coordination, three tracks at 50/day each = 150/day, exceeds the warm cap.';


--
-- Name: studio_outbound_pending_approval; Type: TABLE; Schema: marketing; Owner: -
--

CREATE TABLE marketing.studio_outbound_pending_approval (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clay_table_id text,
    clay_row_id text,
    outbound_queue_id uuid,
    email public.citext NOT NULL,
    first_name text,
    last_name text,
    company text,
    title text,
    personalized_hook text,
    status text DEFAULT 'pending'::text NOT NULL,
    approved_by text,
    approved_at timestamp with time zone,
    disqualified_reason text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE studio_outbound_pending_approval; Type: COMMENT; Schema: marketing; Owner: -
--

COMMENT ON TABLE marketing.studio_outbound_pending_approval IS 'Stream 2 Studio: human-approval queue. Studio never auto-sends — every personalized hook lands here for review before Instantly add. Per other-brands arch §5.2.';


--
-- Name: v_auric_crosssell_due; Type: VIEW; Schema: marketing; Owner: -
--

CREATE VIEW marketing.v_auric_crosssell_due AS
 SELECT id AS contact_id,
    email,
    first_name,
    business_name,
    industry_type,
    trial_start_date,
    (EXTRACT(day FROM (now() - trial_start_date)))::integer AS day_offset,
        CASE (EXTRACT(day FROM (now() - trial_start_date)))::integer
            WHEN 60 THEN 'auric-crosssell-intro'::text
            WHEN 67 THEN 'auric-crosssell-usecase'::text
            WHEN 75 THEN 'auric-crosssell-final'::text
            ELSE NULL::text
        END AS expected_template
   FROM marketing.contacts c
  WHERE ((industry_type = ANY (ARRAY['restaurant'::marketing.industry_type, 'liquor_store'::marketing.industry_type])) AND (status = ANY (ARRAY['trial'::marketing.contact_status, 'paid'::marketing.contact_status])) AND (trial_start_date IS NOT NULL) AND ((EXTRACT(day FROM (now() - trial_start_date)))::integer = ANY (ARRAY[60, 67, 75])) AND (NOT (EXISTS ( SELECT 1
           FROM marketing.email_log el
          WHERE ((el.contact_id = c.id) AND (el.template ~~ 'auric-crosssell-%'::text) AND ((el.sent_at)::date = CURRENT_DATE))))));


--
-- Name: VIEW v_auric_crosssell_due; Type: COMMENT; Schema: marketing; Owner: -
--

COMMENT ON VIEW marketing.v_auric_crosssell_due IS 'Driver view for Build Item 16 (Auric cross-sell). Day 60/67/75 of Ticket/Neat trial.';


--
-- Name: v_outbound_queue_depth; Type: VIEW; Schema: marketing; Owner: -
--

CREATE VIEW marketing.v_outbound_queue_depth AS
 SELECT brand,
    COALESCE(track, '(none)'::text) AS track,
    status,
    count(*) AS row_count,
    min(created_at) AS oldest_created_at,
    max(created_at) AS newest_created_at
   FROM marketing.outbound_queue
  GROUP BY brand, track, status
  ORDER BY brand, COALESCE(track, '(none)'::text), status;


--
-- Name: v_trial_onboarding_due; Type: VIEW; Schema: marketing; Owner: -
--

CREATE VIEW marketing.v_trial_onboarding_due AS
 SELECT id AS contact_id,
    email,
    first_name,
    business_name,
    city,
    industry_type,
    status,
    posthog_distinct_id,
    trial_start_date,
    (EXTRACT(day FROM (now() - trial_start_date)))::integer AS day_offset,
        CASE (EXTRACT(day FROM (now() - trial_start_date)))::integer
            WHEN 0 THEN ((industry_type)::text || '-trial-start'::text)
            WHEN 3 THEN ((industry_type)::text || '-trial-checkin'::text)
            WHEN 7 THEN ((industry_type)::text || '-trial-mid'::text)
            WHEN 10 THEN ((industry_type)::text || '-trial-nudge'::text)
            WHEN 13 THEN ((industry_type)::text || '-trial-convert'::text)
            WHEN 14 THEN ((industry_type)::text || '-trial-end'::text)
            ELSE NULL::text
        END AS expected_template
   FROM marketing.contacts c
  WHERE ((status = 'trial'::marketing.contact_status) AND (industry_type = ANY (ARRAY['restaurant'::marketing.industry_type, 'liquor_store'::marketing.industry_type])) AND (trial_start_date IS NOT NULL) AND ((EXTRACT(day FROM (now() - trial_start_date)))::integer = ANY (ARRAY[0, 3, 7, 10, 13, 14])) AND (NOT (EXISTS ( SELECT 1
           FROM marketing.email_log el
          WHERE ((el.contact_id = c.id) AND (el.template =
                CASE (EXTRACT(day FROM (now() - c.trial_start_date)))::integer
                    WHEN 0 THEN ((c.industry_type)::text || '-trial-start'::text)
                    WHEN 3 THEN ((c.industry_type)::text || '-trial-checkin'::text)
                    WHEN 7 THEN ((c.industry_type)::text || '-trial-mid'::text)
                    WHEN 10 THEN ((c.industry_type)::text || '-trial-nudge'::text)
                    WHEN 13 THEN ((c.industry_type)::text || '-trial-convert'::text)
                    WHEN 14 THEN ((c.industry_type)::text || '-trial-end'::text)
                    ELSE NULL::text
                END) AND (el.status = ANY (ARRAY['queued'::marketing.email_status, 'sent'::marketing.email_status, 'opened'::marketing.email_status, 'clicked'::marketing.email_status])))))));


--
-- Name: VIEW v_trial_onboarding_due; Type: COMMENT; Schema: marketing; Owner: -
--

COMMENT ON VIEW marketing.v_trial_onboarding_due IS 'Driver view for Workflow D (trial onboarding scheduler).';


--
-- Name: v_waitlist_nurture_due; Type: VIEW; Schema: marketing; Owner: -
--

CREATE VIEW marketing.v_waitlist_nurture_due AS
 SELECT id AS contact_id,
    email,
    first_name,
    business_name,
    city,
    industry_type,
    source,
    signup_date,
    (EXTRACT(day FROM (now() - signup_date)))::integer AS day_offset,
        CASE (EXTRACT(day FROM (now() - signup_date)))::integer
            WHEN 2 THEN ((industry_type)::text || '-waitlist-intel'::text)
            WHEN 5 THEN ((industry_type)::text || '-waitlist-proof'::text)
            WHEN 8 THEN ((industry_type)::text || '-waitlist-feature'::text)
            WHEN 12 THEN ((industry_type)::text || '-waitlist-soon'::text)
            ELSE NULL::text
        END AS expected_template
   FROM marketing.contacts c
  WHERE ((status = 'waitlist'::marketing.contact_status) AND (industry_type = ANY (ARRAY['restaurant'::marketing.industry_type, 'liquor_store'::marketing.industry_type])) AND ((EXTRACT(day FROM (now() - signup_date)))::integer = ANY (ARRAY[2, 5, 8, 12])) AND (NOT (EXISTS ( SELECT 1
           FROM marketing.email_log el
          WHERE ((el.contact_id = c.id) AND (el.template =
                CASE (EXTRACT(day FROM (now() - c.signup_date)))::integer
                    WHEN 2 THEN ((c.industry_type)::text || '-waitlist-intel'::text)
                    WHEN 5 THEN ((c.industry_type)::text || '-waitlist-proof'::text)
                    WHEN 8 THEN ((c.industry_type)::text || '-waitlist-feature'::text)
                    WHEN 12 THEN ((c.industry_type)::text || '-waitlist-soon'::text)
                    ELSE NULL::text
                END) AND (el.status = ANY (ARRAY['queued'::marketing.email_status, 'sent'::marketing.email_status, 'opened'::marketing.email_status, 'clicked'::marketing.email_status])))))));


--
-- Name: VIEW v_waitlist_nurture_due; Type: COMMENT; Schema: marketing; Owner: -
--

COMMENT ON VIEW marketing.v_waitlist_nurture_due IS 'Driver view for Workflow B (nurture scheduler). One row per contact x day_offset to send today.';


--
-- Name: admin_activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_activity_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_user_id uuid NOT NULL,
    admin_email text,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id text,
    details jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    reason text,
    actor_type text DEFAULT 'admin'::text NOT NULL,
    CONSTRAINT admin_activity_log_actor_type_check CHECK ((actor_type = ANY (ARRAY['admin'::text, 'system'::text])))
);


--
-- Name: COLUMN admin_activity_log.reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.admin_activity_log.reason IS 'Operator-supplied justification; required by the app on destructive actions (Phase 6b).';


--
-- Name: COLUMN admin_activity_log.actor_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.admin_activity_log.actor_type IS 'admin = a platform admin via the panel; system = an automated writer (e.g. the Stripe webhook).';


--
-- Name: ask_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ask_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    question text NOT NULL,
    answer text NOT NULL,
    confidence text DEFAULT 'low'::text NOT NULL,
    sources jsonb DEFAULT '[]'::jsonb NOT NULL,
    grounded boolean DEFAULT false NOT NULL,
    source text DEFAULT 'user'::text NOT NULL,
    asked_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ask_history_confidence_check CHECK ((confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text]))),
    CONSTRAINT ask_history_source_check CHECK ((source = ANY (ARRAY['user'::text, 'standing'::text])))
);


--
-- Name: beta_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.beta_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    location_id uuid,
    user_id uuid NOT NULL,
    category text,
    message text NOT NULL,
    page_path text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: brief_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brief_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    date_key date NOT NULL,
    play_key text NOT NULL,
    verdict text NOT NULL,
    severity integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT brief_feedback_verdict_check CHECK ((verdict = ANY (ARRAY['good'::text, 'bad'::text])))
);


--
-- Name: busy_times; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.busy_times (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    snapshot_id uuid,
    competitor_id uuid NOT NULL,
    day_of_week integer NOT NULL,
    hourly_scores integer[] NOT NULL,
    peak_hour integer,
    peak_score integer,
    slow_hours integer[],
    typical_time_spent text,
    current_popularity integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT busy_times_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)))
);


--
-- Name: competitor_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.competitor_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    snapshot_id uuid,
    competitor_id uuid NOT NULL,
    place_photo_name text NOT NULL,
    image_hash text NOT NULL,
    image_url text,
    width_px integer,
    height_px integer,
    author_attribution jsonb DEFAULT '[]'::jsonb,
    analysis_result jsonb,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: competitors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.competitors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    provider text DEFAULT 'dataforseo'::text NOT NULL,
    provider_entity_id text NOT NULL,
    name text,
    category text,
    address text,
    phone text,
    website text,
    relevance_score numeric,
    is_active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    display_label text
);


--
-- Name: COLUMN competitors.display_label; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.competitors.display_label IS 'Optional operator-set display name shown in the UI INSTEAD of `name` (ALT-225). Display-only — never used for matching/de-dup, so it cannot break the Google Places link. NULL = show the canonical `name`.';


--
-- Name: daily_briefs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_briefs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    date_key date NOT NULL,
    brief jsonb NOT NULL,
    fallback boolean DEFAULT false NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: event_matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_matches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    competitor_id uuid,
    date_key date NOT NULL,
    event_uid text NOT NULL,
    match_type text NOT NULL,
    confidence text NOT NULL,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT event_matches_confidence_check CHECK ((confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text])))
);


--
-- Name: evergreen_dismissals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evergreen_dismissals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    play_key text NOT NULL,
    dismissed_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: evergreen_plays; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evergreen_plays (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    play_key text NOT NULL,
    play jsonb NOT NULL,
    saved_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fixtures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fixtures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    competition_id text NOT NULL,
    venue_id text NOT NULL,
    place_name text,
    city text,
    aliases text[] DEFAULT '{}'::text[] NOT NULL,
    lat double precision,
    lng double precision,
    tz text,
    window_start date,
    window_end date,
    local_date date,
    local_kickoff text,
    round text,
    label text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: insight_pool_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.insight_pool_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    play_key text NOT NULL,
    play jsonb NOT NULL,
    first_seen_date text NOT NULL,
    last_seen_date text NOT NULL,
    combined_score numeric DEFAULT 0 NOT NULL,
    category text,
    kind text,
    confidence text,
    is_top boolean DEFAULT false NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: insight_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.insight_preferences (
    organization_id uuid NOT NULL,
    insight_type text NOT NULL,
    weight numeric DEFAULT 1.0 NOT NULL,
    useful_count integer DEFAULT 0 NOT NULL,
    dismissed_count integer DEFAULT 0 NOT NULL,
    last_feedback_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: insights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.insights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    competitor_id uuid,
    date_key date NOT NULL,
    insight_type text NOT NULL,
    title text NOT NULL,
    summary text NOT NULL,
    confidence text NOT NULL,
    severity text DEFAULT 'info'::text NOT NULL,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    recommendations jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_feedback text,
    feedback_at timestamp with time zone,
    feedback_by uuid,
    reviewed_status text DEFAULT 'open'::text NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    CONSTRAINT insights_confidence_check CHECK ((confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text]))),
    CONSTRAINT insights_reviewed_status_check CHECK ((reviewed_status = ANY (ARRAY['open'::text, 'resolved'::text]))),
    CONSTRAINT insights_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text]))),
    CONSTRAINT insights_status_check CHECK ((status = ANY (ARRAY['new'::text, 'read'::text, 'todo'::text, 'actioned'::text, 'snoozed'::text, 'dismissed'::text, 'inaccurate'::text]))),
    CONSTRAINT insights_user_feedback_check CHECK ((user_feedback = ANY (ARRAY['useful'::text, 'not_useful'::text])))
);


--
-- Name: COLUMN insights.reviewed_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.insights.reviewed_status IS 'ALT-246 triage state for a source-quality flag (status=inaccurate rows only, in practice) — open|resolved. Data-quality audit trail ONLY: never read by lib/skills/feedback-rollup.ts, never feeds the band weights in lib/skills/feedback-signals.ts.';


--
-- Name: COLUMN insights.reviewed_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.insights.reviewed_by IS 'ALT-246 — auth.users.id of the platform admin who last set reviewed_status. NULL until first triaged.';


--
-- Name: COLUMN insights.reviewed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.insights.reviewed_at IS 'ALT-246 — when reviewed_status was last changed. NULL until first triaged.';


--
-- Name: job_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    job_type text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    attempt integer DEFAULT 1 NOT NULL,
    trace_id uuid,
    message text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT job_runs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text, 'failed'::text])))
);


--
-- Name: location_busy_times; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.location_busy_times (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    day_of_week integer NOT NULL,
    hourly_scores integer[] NOT NULL,
    peak_hour integer,
    peak_score integer,
    slow_hours integer[],
    current_popularity integer,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT location_busy_times_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)))
);


--
-- Name: location_density; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.location_density (
    location_id uuid NOT NULL,
    tier text DEFAULT 'suburban'::text NOT NULL,
    residential_density double precision,
    commercial_proxy integer,
    source text DEFAULT 'default'::text NOT NULL,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: location_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.location_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    snapshot_id uuid,
    location_id uuid NOT NULL,
    place_photo_name text NOT NULL,
    image_hash text NOT NULL,
    image_url text,
    width_px integer,
    height_px integer,
    author_attribution jsonb DEFAULT '[]'::jsonb,
    analysis_result jsonb,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: location_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.location_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    source text DEFAULT 'google_places'::text NOT NULL,
    source_review_id text NOT NULL,
    author_name text,
    author_key text,
    rating integer,
    review_text text,
    published_at timestamp with time zone,
    relative_published text,
    google_maps_uri text,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    authenticity_score integer,
    authenticity_confidence text,
    authenticity_rationale text,
    severity_score integer,
    severity_rationale text,
    red_flags jsonb,
    scored_at timestamp with time zone,
    score_version text,
    triage_status text DEFAULT 'open'::text NOT NULL,
    triage_updated_at timestamp with time zone,
    triage_updated_by uuid,
    operator_verdict text,
    operator_verdict_at timestamp with time zone,
    draft_text text,
    draft_generated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sentiment_score integer,
    CONSTRAINT location_reviews_authenticity_confidence_check CHECK ((authenticity_confidence = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))),
    CONSTRAINT location_reviews_authenticity_score_check CHECK (((authenticity_score >= 0) AND (authenticity_score <= 100))),
    CONSTRAINT location_reviews_operator_verdict_check CHECK ((operator_verdict = ANY (ARRAY['genuine'::text, 'not_genuine'::text]))),
    CONSTRAINT location_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5))),
    CONSTRAINT location_reviews_sentiment_score_check CHECK (((sentiment_score >= '-100'::integer) AND (sentiment_score <= 100))),
    CONSTRAINT location_reviews_severity_score_check CHECK (((severity_score >= 0) AND (severity_score <= 100))),
    CONSTRAINT location_reviews_triage_status_check CHECK ((triage_status = ANY (ARRAY['open'::text, 'responded'::text, 'dismissed'::text])))
);


--
-- Name: TABLE location_reviews; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.location_reviews IS 'Review Intelligence (ALT-347): one row per customer review seen in the Google Places feed for an OWN location. Accumulates across daily builds (upsert on location_id/source/source_review_id). Scoring columns null until lib/reviews/scoring.ts runs.';


--
-- Name: COLUMN location_reviews.author_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.location_reviews.author_key IS 'Reviewer identity for within-our-data aggregates (ALT-349): authorAttribution.uri when present, else normalized display name. NOT a cross-platform identity.';


--
-- Name: COLUMN location_reviews.triage_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.location_reviews.triage_status IS 'Operator triage state (open|responded|dismissed). TRIAGE ONLY — never feeds feedback-rollup/band weights.';


--
-- Name: COLUMN location_reviews.operator_verdict; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.location_reviews.operator_verdict IS 'Operator''s genuineness call on a review (genuine|not_genuine). Provisional learning signal captured via lib/reviews/review-signals.ts; adjusts display immediately.';


--
-- Name: COLUMN location_reviews.sentiment_score; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.location_reviews.sentiment_score IS 'ALT-359 — model-read sentiment of the review, -100 (furious/hostile) .. 0 (neutral) .. 100 (delighted). Drives the sentiment spectrum bar + list ordering. NULL until scored by lib/reviews/scoring.ts (ri-v2+); engine-owned (service-role writes only).';


--
-- Name: location_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.location_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    provider text NOT NULL,
    date_key date NOT NULL,
    captured_at timestamp with time zone NOT NULL,
    raw_data jsonb NOT NULL,
    diff_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    content_as_of timestamp with time zone,
    freshness text DEFAULT 'undated'::text NOT NULL,
    CONSTRAINT location_snapshots_freshness_check CHECK ((freshness = ANY (ARRAY['fresh'::text, 'aging'::text, 'dormant'::text, 'empty'::text, 'undated'::text])))
);


--
-- Name: location_weather; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.location_weather (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    date date NOT NULL,
    temp_high_f numeric,
    temp_low_f numeric,
    feels_like_high_f numeric,
    humidity_avg integer,
    wind_speed_max_mph numeric,
    weather_condition text,
    weather_description text,
    weather_icon text,
    precipitation_in numeric DEFAULT 0,
    is_severe boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    address_line1 text,
    address_line2 text,
    city text,
    region text,
    postal_code text,
    country text DEFAULT 'US'::text,
    geo_lat double precision,
    geo_lng double precision,
    timezone text DEFAULT 'America/New_York'::text NOT NULL,
    primary_place_id text,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    website text,
    voice_tone text,
    brand_tolerance integer DEFAULT 50 NOT NULL,
    standing_question text,
    generosity_threshold integer DEFAULT 50 NOT NULL,
    CONSTRAINT locations_generosity_threshold_check CHECK (((generosity_threshold >= 0) AND (generosity_threshold <= 100)))
);


--
-- Name: COLUMN locations.generosity_threshold; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.locations.generosity_threshold IS 'ALT-351 — operator''s make-good posture for review responses, 0 (respond-only) .. 100 (generous). Consumed by lib/reviews/make-good.ts to place the discount/comp cut-points. Recommendation-only: Ticket never executes a make-good.';


--
-- Name: ops_brief_backup_20260717; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ops_brief_backup_20260717 (
    id uuid,
    location_id uuid,
    date_key date,
    brief jsonb,
    fallback boolean,
    generated_at timestamp with time zone
);


--
-- Name: ops_brief_backup_20260717b; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ops_brief_backup_20260717b (
    id uuid,
    location_id uuid,
    date_key date,
    brief jsonb,
    fallback boolean,
    generated_at timestamp with time zone
);


--
-- Name: organization_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])))
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    subscription_tier text DEFAULT 'mid'::text NOT NULL,
    stripe_customer_id text,
    stripe_subscription_id text,
    billing_email text,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    trial_started_at timestamp with time zone,
    trial_ends_at timestamp with time zone,
    waitlist_signup_id uuid,
    industry_type text DEFAULT 'restaurant'::text NOT NULL,
    stripe_price_id text,
    current_period_end timestamp with time zone,
    cancel_at_period_end boolean DEFAULT false NOT NULL,
    payment_state text,
    org_kind text DEFAULT 'real'::text NOT NULL,
    deleted_at timestamp with time zone,
    display_name text,
    pending_billing_email text,
    billing_email_token_hash text,
    billing_email_token_expires_at timestamp with time zone,
    billing_email_token_sent_at timestamp with time zone,
    CONSTRAINT organizations_industry_type_check CHECK ((industry_type = ANY (ARRAY['restaurant'::text, 'liquor_store'::text]))),
    CONSTRAINT organizations_org_kind_check CHECK ((org_kind = ANY (ARRAY['real'::text, 'demo'::text, 'test'::text]))),
    CONSTRAINT organizations_payment_state_check CHECK (((payment_state IS NULL) OR (payment_state = ANY (ARRAY['trialing'::text, 'active'::text, 'past_due'::text, 'canceled'::text, 'incomplete'::text, 'incomplete_expired'::text, 'unpaid'::text, 'paused'::text])))),
    CONSTRAINT organizations_subscription_tier_check_v2 CHECK ((subscription_tier = ANY (ARRAY['free'::text, 'entry'::text, 'mid'::text, 'top'::text, 'suspended'::text])))
);


--
-- Name: COLUMN organizations.deleted_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organizations.deleted_at IS 'Soft-delete tombstone (Phase 6c). NOT NULL => hidden from all lists/counts/crons; a super_admin purge hard-removes it. NULL => live.';


--
-- Name: COLUMN organizations.display_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organizations.display_name IS 'Optional editable display name for the org, shown in the UI INSTEAD of the legal `name` (ALT-226). NULL = show `name`. The legal `name` stays immutable in the settings UI.';


--
-- Name: partner_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partner_catalog (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    place_id text,
    name text NOT NULL,
    partner_type text NOT NULL,
    primary_type text,
    lat double precision,
    lng double precision,
    distance_mi double precision,
    size_proxy_low integer,
    size_proxy_high integer,
    size_band text DEFAULT 'medium'::text NOT NULL,
    size_confidence text DEFAULT 'prior'::text NOT NULL,
    size_proxy_kind text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pipeline_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pipeline_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    location_id uuid NOT NULL,
    competitor_id uuid,
    pipeline text NOT NULL,
    outcome text NOT NULL,
    reason text,
    signals jsonb DEFAULT '{}'::jsonb NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pipeline_runs_outcome_check CHECK ((outcome = ANY (ARRAY['fresh'::text, 'served_stale'::text, 'dormant'::text, 'no_data'::text, 'partial'::text, 'failed'::text, 'skipped'::text])))
);


--
-- Name: platform_admins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_admins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    email text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    role text DEFAULT 'super_admin'::text NOT NULL,
    CONSTRAINT platform_admins_role_check CHECK ((role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'read_only'::text])))
);


--
-- Name: play_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.play_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    date_key date NOT NULL,
    play_key text NOT NULL,
    action text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reason text,
    note text,
    reviewed_status text DEFAULT 'open'::text NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    CONSTRAINT play_actions_action_check CHECK ((action = ANY (ARRAY['saved'::text, 'snoozed'::text, 'dismissed'::text]))),
    CONSTRAINT play_actions_reviewed_status_check CHECK ((reviewed_status = ANY (ARRAY['open'::text, 'resolved'::text])))
);


--
-- Name: COLUMN play_actions.reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.play_actions.reason IS 'Optional stable dismissal-reason code (not_relevant|already_doing|looks_wrong) for action=dismissed. Disambiguates a Remove into a directional learning signal; NULL = bare visibility-only dismissal. Semantics live in lib/skills/feedback-signals.ts (DISMISS_REASONS + the dismissed:<code> band entries).';


--
-- Name: COLUMN play_actions.note; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.play_actions.note IS 'Optional free-text operator note captured with a dismissal (ALT-172, surfaced for reason=looks_wrong). Treated as DATA-QUALITY feedback about third-party source data — NOT a negative signal against the recommendation model. NULL = no note. Bounded to a short note in the capture layer (brief-actions.ts).';


--
-- Name: COLUMN play_actions.reviewed_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.play_actions.reviewed_status IS 'ALT-246 triage state for a source-quality flag (reason=looks_wrong rows only, in practice) — open|resolved. Data-quality audit trail ONLY: never read by lib/skills/feedback-rollup.ts, never feeds the band weights in lib/skills/feedback-signals.ts.';


--
-- Name: COLUMN play_actions.reviewed_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.play_actions.reviewed_by IS 'ALT-246 — auth.users.id of the platform admin who last set reviewed_status. NULL until first triaged.';


--
-- Name: COLUMN play_actions.reviewed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.play_actions.reviewed_at IS 'ALT-246 — when reviewed_status was last changed. NULL until first triaged.';


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text,
    full_name text,
    avatar_url text,
    current_organization_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: refresh_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    location_id uuid NOT NULL,
    job_type text NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    total_steps integer DEFAULT 0 NOT NULL,
    current_step integer DEFAULT 0 NOT NULL,
    steps jsonb DEFAULT '[]'::jsonb NOT NULL,
    result jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT refresh_jobs_job_type_check CHECK ((job_type = ANY (ARRAY['content'::text, 'visibility'::text, 'events'::text, 'insights'::text, 'photos'::text, 'busy_times'::text, 'weather'::text, 'social'::text, 'meta_ads'::text, 'refresh_all'::text]))),
    CONSTRAINT refresh_jobs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: skill_feedback_rollup; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_feedback_rollup (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    skill_id text NOT NULL,
    scope text DEFAULT 'global'::text NOT NULL,
    scope_id uuid,
    play_type_key text NOT NULL,
    good_count numeric DEFAULT 0 NOT NULL,
    bad_count numeric DEFAULT 0 NOT NULL,
    good_weighted numeric DEFAULT 0 NOT NULL,
    bad_weighted numeric DEFAULT 0 NOT NULL,
    bayes_score numeric DEFAULT 0.5 NOT NULL,
    multiplier numeric DEFAULT 1.0 NOT NULL,
    support_n integer DEFAULT 0 NOT NULL,
    org_support_n integer DEFAULT 0 NOT NULL,
    last_recompute timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT skill_feedback_rollup_multiplier_check CHECK (((multiplier >= 0.7) AND (multiplier <= 1.3))),
    CONSTRAINT skill_feedback_rollup_scope_check CHECK ((scope = ANY (ARRAY['global'::text, 'org'::text, 'location'::text]))),
    CONSTRAINT skill_feedback_rollup_scope_id_ck CHECK ((((scope = 'global'::text) AND (scope_id IS NULL)) OR ((scope <> 'global'::text) AND (scope_id IS NOT NULL))))
);


--
-- Name: skill_knowledge; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_knowledge (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    skill_id text NOT NULL,
    scope text DEFAULT 'global'::text NOT NULL,
    scope_id uuid,
    learning_kind text NOT NULL,
    title text NOT NULL,
    snippet text NOT NULL,
    provenance jsonb DEFAULT '{}'::jsonb NOT NULL,
    confidence smallint DEFAULT 0 NOT NULL,
    support_n integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'candidate'::text NOT NULL,
    knowledge_version text NOT NULL,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    effective_to timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT skill_knowledge_confidence_check CHECK (((confidence >= 0) AND (confidence <= 100))),
    CONSTRAINT skill_knowledge_learning_kind_check CHECK ((learning_kind = ANY (ARRAY['external_trend'::text, 'feedback_pattern'::text, 'question_demand'::text, 'editorial'::text]))),
    CONSTRAINT skill_knowledge_scope_check CHECK ((scope = ANY (ARRAY['global'::text, 'org'::text, 'location'::text]))),
    CONSTRAINT skill_knowledge_scope_id_ck CHECK ((((scope = 'global'::text) AND (scope_id IS NULL)) OR ((scope <> 'global'::text) AND (scope_id IS NOT NULL)))),
    CONSTRAINT skill_knowledge_status_check CHECK ((status = ANY (ARRAY['candidate'::text, 'shadow'::text, 'active'::text, 'retired'::text])))
);


--
-- Name: skill_source_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_source_registry (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    skill_ids text[] DEFAULT '{}'::text[] NOT NULL,
    name text NOT NULL,
    vertical text NOT NULL,
    url text NOT NULL,
    fetch_strategy text DEFAULT 'scrape'::text NOT NULL,
    auth_kind text DEFAULT 'none'::text NOT NULL,
    trust_tier smallint DEFAULT 2 NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    last_fetch timestamp with time zone,
    last_status text,
    failure_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT skill_source_registry_auth_kind_check CHECK ((auth_kind = ANY (ARRAY['none'::text, 'free-token'::text, 'paid'::text]))),
    CONSTRAINT skill_source_registry_fetch_strategy_check CHECK ((fetch_strategy = ANY (ARRAY['rss'::text, 'scrape'::text, 'scrape-browser-headers'::text, 'data-api'::text]))),
    CONSTRAINT skill_source_registry_trust_tier_check CHECK ((trust_tier = ANY (ARRAY[1, 2, 3])))
);


--
-- Name: snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    competitor_id uuid NOT NULL,
    captured_at timestamp with time zone NOT NULL,
    date_key date NOT NULL,
    provider text NOT NULL,
    raw_data jsonb NOT NULL,
    diff_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    snapshot_type text DEFAULT 'listing_daily'::text NOT NULL,
    content_as_of timestamp with time zone,
    freshness text DEFAULT 'undated'::text NOT NULL,
    CONSTRAINT snapshots_freshness_check CHECK ((freshness = ANY (ARRAY['fresh'::text, 'aging'::text, 'dormant'::text, 'empty'::text, 'undated'::text])))
);


--
-- Name: social_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.social_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    platform text NOT NULL,
    handle text NOT NULL,
    profile_url text,
    discovery_method text DEFAULT 'manual'::text NOT NULL,
    is_verified boolean DEFAULT false NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT social_profiles_discovery_method_check CHECK ((discovery_method = ANY (ARRAY['auto_scrape'::text, 'data365_search'::text, 'manual'::text]))),
    CONSTRAINT social_profiles_entity_type_check CHECK ((entity_type = ANY (ARRAY['location'::text, 'competitor'::text]))),
    CONSTRAINT social_profiles_platform_check CHECK ((platform = ANY (ARRAY['instagram'::text, 'facebook'::text, 'tiktok'::text])))
);


--
-- Name: social_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.social_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    social_profile_id uuid NOT NULL,
    date_key date NOT NULL,
    raw_data jsonb NOT NULL,
    diff_hash text NOT NULL,
    captured_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    content_as_of timestamp with time zone,
    freshness text DEFAULT 'undated'::text NOT NULL,
    CONSTRAINT social_snapshots_freshness_check CHECK ((freshness = ANY (ARRAY['fresh'::text, 'aging'::text, 'dormant'::text, 'empty'::text, 'undated'::text])))
);


--
-- Name: stripe_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stripe_events (
    event_id text NOT NULL,
    event_type text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    organization_id uuid,
    stripe_customer_id text,
    stripe_subscription_id text,
    price_id text,
    brand text,
    tier text,
    cadence text,
    skipped_reason text,
    warning text,
    error_message text,
    payload jsonb NOT NULL
);


--
-- Name: TABLE stripe_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.stripe_events IS 'Append-only audit + idempotency log for Stripe webhook events delivered to the Neat app. Includes dropped non-Neat-brand events.';


--
-- Name: COLUMN stripe_events.skipped_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.stripe_events.skipped_reason IS 'Reason this event was not applied to organizations (e.g. non_neat_brand, unresolvable_price, org_not_found, industry_mismatch).';


--
-- Name: COLUMN stripe_events.warning; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.stripe_events.warning IS 'Non-fatal anomalies observed while processing (free-form).';


--
-- Name: COLUMN stripe_events.error_message; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.stripe_events.error_message IS 'Fatal error while processing — webhook returned 500 to force Stripe retry. Null on success.';


--
-- Name: stripe_webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stripe_webhook_events (
    event_id text NOT NULL,
    event_type text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    error text
);


--
-- Name: TABLE stripe_webhook_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.stripe_webhook_events IS 'Idempotency ledger for POST /api/stripe/webhook. Handler inserts (event_id) with ON CONFLICT DO NOTHING; zero rows = duplicate, skip.';


--
-- Name: tracked_keywords; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tracked_keywords (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    keyword text NOT NULL,
    source text DEFAULT 'auto'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    tags jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tracked_keywords_source_check CHECK ((source = ANY (ARRAY['auto'::text, 'manual'::text])))
);


--
-- Name: trial_reminder_sends; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trial_reminder_sends (
    organization_id uuid NOT NULL,
    reminder_day integer NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trial_reminder_sends_reminder_day_check CHECK ((reminder_day = ANY (ARRAY[10, 13])))
);


--
-- Name: TABLE trial_reminder_sends; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.trial_reminder_sends IS 'Dedupe log for /api/cron/trial-reminders. PK = (org_id, reminder_day). Insert happens in the same transaction as the Resend send.';


--
-- Name: venue_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.venue_catalog (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    place_id text,
    name text NOT NULL,
    primary_type text,
    lat double precision,
    lng double precision,
    distance_mi double precision,
    capacity_low integer,
    capacity_high integer,
    capacity_confidence text DEFAULT 'prior'::text NOT NULL,
    aliases text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: venue_geocode_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.venue_geocode_cache (
    query_key text NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    resolved_at timestamp with time zone DEFAULT now() NOT NULL,
    website text
);


--
-- Name: waitlist_signups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waitlist_signups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    business_name text,
    city text,
    source text DEFAULT 'landing_page'::text NOT NULL,
    referred_by text,
    status text DEFAULT 'pending'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    first_name text,
    last_name text,
    admin_notes text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    CONSTRAINT waitlist_signups_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'declined'::text])))
);


--
-- Name: contacts contacts_email_key; Type: CONSTRAINT; Schema: marketing; Owner: -
--

ALTER TABLE ONLY marketing.contacts
    ADD CONSTRAINT contacts_email_key UNIQUE (email);


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: marketing; Owner: -
--

ALTER TABLE ONLY marketing.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);


--
-- Name: email_log email_log_pkey; Type: CONSTRAINT; Schema: marketing; Owner: -
--

ALTER TABLE ONLY marketing.email_log
    ADD CONSTRAINT email_log_pkey PRIMARY KEY (id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: marketing; Owner: -
--

ALTER TABLE ONLY marketing.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: failed_events failed_events_pkey; Type: CONSTRAINT; Schema: marketing; Owner: -
--

ALTER TABLE ONLY marketing.failed_events
    ADD CONSTRAINT failed_events_pkey PRIMARY KEY (id);


--
-- Name: mentions mentions_pkey; Type: CONSTRAINT; Schema: marketing; Owner: -
--

ALTER TABLE ONLY marketing.mentions
    ADD CONSTRAINT mentions_pkey PRIMARY KEY (mention_id);


--
-- Name: outbound_queue outbound_queue_pkey; Type: CONSTRAINT; Schema: marketing; Owner: -
--

ALTER TABLE ONLY marketing.outbound_queue
    ADD CONSTRAINT outbound_queue_pkey PRIMARY KEY (id);


--
-- Name: prospects prospects_email_key; Type: CONSTRAINT; Schema: marketing; Owner: -
--

ALTER TABLE ONLY marketing.prospects
    ADD CONSTRAINT prospects_email_key UNIQUE (email);


--
-- Name: prospects prospects_pkey; Type: CONSTRAINT; Schema: marketing; Owner: -
--

ALTER TABLE ONLY marketing.prospects
    ADD CONSTRAINT prospects_pkey PRIMARY KEY (id);


--
-- Name: replies_processed replies_processed_pkey; Type: CONSTRAINT; Schema: marketing; Owner: -
--

ALTER TABLE ONLY marketing.replies_processed
    ADD CONSTRAINT replies_processed_pkey PRIMARY KEY (reply_id);


--
-- Name: shared_domain_daily_counter shared_domain_daily_counter_pkey; Type: CONSTRAINT; Schema: marketing; Owner: -
--

ALTER TABLE ONLY marketing.shared_domain_daily_counter
    ADD CONSTRAINT shared_domain_daily_counter_pkey PRIMARY KEY (domain, send_date);


--
-- Name: studio_outbound_pending_approval studio_outbound_pending_approval_pkey; Type: CONSTRAINT; Schema: marketing; Owner: -
--

ALTER TABLE ONLY marketing.studio_outbound_pending_approval
    ADD CONSTRAINT studio_outbound_pending_approval_pkey PRIMARY KEY (id);


--
-- Name: admin_activity_log admin_activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_activity_log
    ADD CONSTRAINT admin_activity_log_pkey PRIMARY KEY (id);


--
-- Name: ask_history ask_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ask_history
    ADD CONSTRAINT ask_history_pkey PRIMARY KEY (id);


--
-- Name: beta_feedback beta_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beta_feedback
    ADD CONSTRAINT beta_feedback_pkey PRIMARY KEY (id);


--
-- Name: brief_feedback brief_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brief_feedback
    ADD CONSTRAINT brief_feedback_pkey PRIMARY KEY (id);


--
-- Name: busy_times busy_times_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.busy_times
    ADD CONSTRAINT busy_times_pkey PRIMARY KEY (id);


--
-- Name: competitor_photos competitor_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitor_photos
    ADD CONSTRAINT competitor_photos_pkey PRIMARY KEY (id);


--
-- Name: competitors competitors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitors
    ADD CONSTRAINT competitors_pkey PRIMARY KEY (id);


--
-- Name: competitors competitors_provider_provider_entity_id_location_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitors
    ADD CONSTRAINT competitors_provider_provider_entity_id_location_id_key UNIQUE (provider, provider_entity_id, location_id);


--
-- Name: daily_briefs daily_briefs_location_id_date_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_briefs
    ADD CONSTRAINT daily_briefs_location_id_date_key_key UNIQUE (location_id, date_key);


--
-- Name: daily_briefs daily_briefs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_briefs
    ADD CONSTRAINT daily_briefs_pkey PRIMARY KEY (id);


--
-- Name: event_matches event_matches_location_id_competitor_id_date_key_event_uid__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_matches
    ADD CONSTRAINT event_matches_location_id_competitor_id_date_key_event_uid__key UNIQUE (location_id, competitor_id, date_key, event_uid, match_type);


--
-- Name: event_matches event_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_matches
    ADD CONSTRAINT event_matches_pkey PRIMARY KEY (id);


--
-- Name: evergreen_dismissals evergreen_dismissals_location_id_play_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evergreen_dismissals
    ADD CONSTRAINT evergreen_dismissals_location_id_play_key_key UNIQUE (location_id, play_key);


--
-- Name: evergreen_dismissals evergreen_dismissals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evergreen_dismissals
    ADD CONSTRAINT evergreen_dismissals_pkey PRIMARY KEY (id);


--
-- Name: evergreen_plays evergreen_plays_location_id_play_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evergreen_plays
    ADD CONSTRAINT evergreen_plays_location_id_play_key_key UNIQUE (location_id, play_key);


--
-- Name: evergreen_plays evergreen_plays_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evergreen_plays
    ADD CONSTRAINT evergreen_plays_pkey PRIMARY KEY (id);


--
-- Name: fixtures fixtures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fixtures
    ADD CONSTRAINT fixtures_pkey PRIMARY KEY (id);


--
-- Name: insight_pool_entries insight_pool_entries_location_id_play_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insight_pool_entries
    ADD CONSTRAINT insight_pool_entries_location_id_play_key_key UNIQUE (location_id, play_key);


--
-- Name: insight_pool_entries insight_pool_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insight_pool_entries
    ADD CONSTRAINT insight_pool_entries_pkey PRIMARY KEY (id);


--
-- Name: insight_preferences insight_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insight_preferences
    ADD CONSTRAINT insight_preferences_pkey PRIMARY KEY (organization_id, insight_type);


--
-- Name: insights insights_location_id_competitor_id_date_key_insight_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insights
    ADD CONSTRAINT insights_location_id_competitor_id_date_key_insight_type_key UNIQUE (location_id, competitor_id, date_key, insight_type);


--
-- Name: insights insights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insights
    ADD CONSTRAINT insights_pkey PRIMARY KEY (id);


--
-- Name: job_runs job_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_runs
    ADD CONSTRAINT job_runs_pkey PRIMARY KEY (id);


--
-- Name: location_busy_times location_busy_times_location_id_day_of_week_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_busy_times
    ADD CONSTRAINT location_busy_times_location_id_day_of_week_key UNIQUE (location_id, day_of_week);


--
-- Name: location_busy_times location_busy_times_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_busy_times
    ADD CONSTRAINT location_busy_times_pkey PRIMARY KEY (id);


--
-- Name: location_density location_density_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_density
    ADD CONSTRAINT location_density_pkey PRIMARY KEY (location_id);


--
-- Name: location_photos location_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_photos
    ADD CONSTRAINT location_photos_pkey PRIMARY KEY (id);


--
-- Name: location_reviews location_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_reviews
    ADD CONSTRAINT location_reviews_pkey PRIMARY KEY (id);


--
-- Name: location_reviews location_reviews_source_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_reviews
    ADD CONSTRAINT location_reviews_source_key UNIQUE (location_id, source, source_review_id);


--
-- Name: location_snapshots location_snapshots_location_id_provider_date_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_snapshots
    ADD CONSTRAINT location_snapshots_location_id_provider_date_key_key UNIQUE (location_id, provider, date_key);


--
-- Name: location_snapshots location_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_snapshots
    ADD CONSTRAINT location_snapshots_pkey PRIMARY KEY (id);


--
-- Name: location_weather location_weather_location_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_weather
    ADD CONSTRAINT location_weather_location_id_date_key UNIQUE (location_id, date);


--
-- Name: location_weather location_weather_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_weather
    ADD CONSTRAINT location_weather_pkey PRIMARY KEY (id);


--
-- Name: locations locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_pkey PRIMARY KEY (id);


--
-- Name: organization_members organization_members_organization_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_organization_id_user_id_key UNIQUE (organization_id, user_id);


--
-- Name: organization_members organization_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_slug_key UNIQUE (slug);


--
-- Name: partner_catalog partner_catalog_location_id_place_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_catalog
    ADD CONSTRAINT partner_catalog_location_id_place_id_key UNIQUE (location_id, place_id);


--
-- Name: partner_catalog partner_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_catalog
    ADD CONSTRAINT partner_catalog_pkey PRIMARY KEY (id);


--
-- Name: pipeline_runs pipeline_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_runs
    ADD CONSTRAINT pipeline_runs_pkey PRIMARY KEY (id);


--
-- Name: platform_admins platform_admins_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admins
    ADD CONSTRAINT platform_admins_email_key UNIQUE (email);


--
-- Name: platform_admins platform_admins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admins
    ADD CONSTRAINT platform_admins_pkey PRIMARY KEY (id);


--
-- Name: platform_admins platform_admins_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admins
    ADD CONSTRAINT platform_admins_user_id_key UNIQUE (user_id);


--
-- Name: play_actions play_actions_location_id_date_key_play_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.play_actions
    ADD CONSTRAINT play_actions_location_id_date_key_play_key_key UNIQUE (location_id, date_key, play_key);


--
-- Name: play_actions play_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.play_actions
    ADD CONSTRAINT play_actions_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: refresh_jobs refresh_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_jobs
    ADD CONSTRAINT refresh_jobs_pkey PRIMARY KEY (id);


--
-- Name: signal_jobs signal_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_jobs
    ADD CONSTRAINT signal_jobs_pkey PRIMARY KEY (id);


--
-- Name: skill_feedback_rollup skill_feedback_rollup_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_feedback_rollup
    ADD CONSTRAINT skill_feedback_rollup_pkey PRIMARY KEY (id);


--
-- Name: skill_knowledge skill_knowledge_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_knowledge
    ADD CONSTRAINT skill_knowledge_pkey PRIMARY KEY (id);


--
-- Name: skill_source_registry skill_source_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_source_registry
    ADD CONSTRAINT skill_source_registry_pkey PRIMARY KEY (id);


--
-- Name: skill_source_registry skill_source_registry_url_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_source_registry
    ADD CONSTRAINT skill_source_registry_url_key UNIQUE (url);


--
-- Name: snapshots snapshots_competitor_date_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snapshots
    ADD CONSTRAINT snapshots_competitor_date_type_key UNIQUE (competitor_id, date_key, snapshot_type);


--
-- Name: snapshots snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snapshots
    ADD CONSTRAINT snapshots_pkey PRIMARY KEY (id);


--
-- Name: social_profiles social_profiles_entity_type_entity_id_platform_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_profiles
    ADD CONSTRAINT social_profiles_entity_type_entity_id_platform_key UNIQUE (entity_type, entity_id, platform);


--
-- Name: social_profiles social_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_profiles
    ADD CONSTRAINT social_profiles_pkey PRIMARY KEY (id);


--
-- Name: social_snapshots social_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_snapshots
    ADD CONSTRAINT social_snapshots_pkey PRIMARY KEY (id);


--
-- Name: social_snapshots social_snapshots_social_profile_id_date_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_snapshots
    ADD CONSTRAINT social_snapshots_social_profile_id_date_key_key UNIQUE (social_profile_id, date_key);


--
-- Name: stripe_events stripe_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_events
    ADD CONSTRAINT stripe_events_pkey PRIMARY KEY (event_id);


--
-- Name: stripe_webhook_events stripe_webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_webhook_events
    ADD CONSTRAINT stripe_webhook_events_pkey PRIMARY KEY (event_id);


--
-- Name: tracked_keywords tracked_keywords_location_id_keyword_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracked_keywords
    ADD CONSTRAINT tracked_keywords_location_id_keyword_key UNIQUE (location_id, keyword);


--
-- Name: tracked_keywords tracked_keywords_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracked_keywords
    ADD CONSTRAINT tracked_keywords_pkey PRIMARY KEY (id);


--
-- Name: trial_reminder_sends trial_reminder_sends_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trial_reminder_sends
    ADD CONSTRAINT trial_reminder_sends_pkey PRIMARY KEY (organization_id, reminder_day);


--
-- Name: venue_catalog venue_catalog_location_id_place_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_catalog
    ADD CONSTRAINT venue_catalog_location_id_place_id_key UNIQUE (location_id, place_id);


--
-- Name: venue_catalog venue_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_catalog
    ADD CONSTRAINT venue_catalog_pkey PRIMARY KEY (id);


--
-- Name: venue_geocode_cache venue_geocode_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_geocode_cache
    ADD CONSTRAINT venue_geocode_cache_pkey PRIMARY KEY (query_key);


--
-- Name: waitlist_signups waitlist_signups_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist_signups
    ADD CONSTRAINT waitlist_signups_email_key UNIQUE (email);


--
-- Name: waitlist_signups waitlist_signups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist_signups
    ADD CONSTRAINT waitlist_signups_pkey PRIMARY KEY (id);


--
-- Name: idx_contacts_industry_status; Type: INDEX; Schema: marketing; Owner: -
--

CREATE INDEX idx_contacts_industry_status ON marketing.contacts USING btree (industry_type, status);


--
-- Name: idx_contacts_signup_date; Type: INDEX; Schema: marketing; Owner: -
--

CREATE INDEX idx_contacts_signup_date ON marketing.contacts USING btree (signup_date);


--
-- Name: idx_contacts_source; Type: INDEX; Schema: marketing; Owner: -
--

CREATE INDEX idx_contacts_source ON marketing.contacts USING btree (source);


--
-- Name: idx_contacts_status; Type: INDEX; Schema: marketing; Owner: -
--

CREATE INDEX idx_contacts_status ON marketing.contacts USING btree (status);


--
-- Name: idx_contacts_stripe_customer_id; Type: INDEX; Schema: marketing; Owner: -
--

CREATE INDEX idx_contacts_stripe_customer_id ON marketing.contacts USING btree (stripe_customer_id) WHERE (stripe_customer_id IS NOT NULL);


--
-- Name: idx_contacts_trial_start_date; Type: INDEX; Schema: marketing; Owner: -
--

CREATE INDEX idx_contacts_trial_start_date ON marketing.contacts USING btree (trial_start_date) WHERE (trial_start_date IS NOT NULL);


--
-- Name: idx_email_log_contact_id; Type: INDEX; Schema: marketing; Owner: -
--

CREATE INDEX idx_email_log_contact_id ON marketing.email_log USING btree (contact_id);


--
-- Name: idx_email_log_resend_email_id; Type: INDEX; Schema: marketing; Owner: -
--

CREATE INDEX idx_email_log_resend_email_id ON marketing.email_log USING btree (resend_email_id) WHERE (resend_email_id IS NOT NULL);


--
-- Name: idx_email_log_sent_at; Type: INDEX; Schema: marketing; Owner: -
--

CREATE INDEX idx_email_log_sent_at ON marketing.email_log USING btree (sent_at DESC);


--
-- Name: idx_email_log_template_contact; Type: INDEX; Schema: marketing; Owner: -
--

CREATE INDEX idx_email_log_template_contact ON marketing.email_log USING btree (contact_id, template);


--
-- Name: idx_events_contact_id; Type: INDEX; Schema: marketing; Owner: -
--

CREATE INDEX idx_events_contact_id ON marketing.events USING btree (contact_id);


--
-- Name: idx_events_created_at; Type: INDEX; Schema: marketing; Owner: -
--

CREATE INDEX idx_events_created_at ON marketing.events USING btree (created_at DESC);


--
-- Name: idx_events_event_type; Type: INDEX; Schema: marketing; Owner: -
--

CREATE INDEX idx_events_event_type ON marketing.events USING btree (event_type);


--
-- Name: idx_failed_events_unresolved; Type: INDEX; Schema: marketing; Owner: -
--

CREATE INDEX idx_failed_events_unresolved ON marketing.failed_events USING btree (failed_at DESC) WHERE (resolved_at IS NULL);


--
-- Name: idx_mentions_brand_captured; Type: INDEX; Schema: marketing; Owner: -
--

CREATE INDEX idx_mentions_brand_captured ON marketing.mentions USING btree (brand, captured_at DESC);


--
-- Name: idx_mentions_classification; Type: INDEX; Schema: marketing; Owner: -
--

CREATE INDEX idx_mentions_classification ON marketing.mentions USING btree (classification) WHERE (classification IS NOT NULL);


--
-- Name: idx_mentions_is_prospect; Type: INDEX; Schema: marketing; Owner: -
--

CREATE INDEX idx_mentions_is_prospect ON marketing.mentions USING btree (is_prospect) WHERE (is_prospect = true);


--
-- Name: idx_mentions_sentiment; Type: INDEX; Schema: marketing; Owner: -
--

CREATE INDEX idx_mentions_sentiment ON marketing.mentions USING btree (sentiment);


--
-- Name: ix_outbound_queue_brand_status; Type: INDEX; Schema: marketing; Owner: -
--

CREATE INDEX ix_outbound_queue_brand_status ON marketing.outbound_queue USING btree (brand, status, created_at);


--
-- Name: ix_prospects_brand_status; Type: INDEX; Schema: marketing; Owner: -
--

CREATE INDEX ix_prospects_brand_status ON marketing.prospects USING btree (brand, status);


--
-- Name: ix_prospects_instantly_contact_id; Type: INDEX; Schema: marketing; Owner: -
--

CREATE INDEX ix_prospects_instantly_contact_id ON marketing.prospects USING btree (instantly_contact_id) WHERE (instantly_contact_id IS NOT NULL);


--
-- Name: ix_replies_processed_email; Type: INDEX; Schema: marketing; Owner: -
--

CREATE INDEX ix_replies_processed_email ON marketing.replies_processed USING btree (email);


--
-- Name: ix_studio_pending_status; Type: INDEX; Schema: marketing; Owner: -
--

CREATE INDEX ix_studio_pending_status ON marketing.studio_outbound_pending_approval USING btree (status, created_at);


--
-- Name: ux_outbound_queue_email_active; Type: INDEX; Schema: marketing; Owner: -
--

CREATE UNIQUE INDEX ux_outbound_queue_email_active ON marketing.outbound_queue USING btree (brand, email) WHERE (status = ANY (ARRAY['pending'::text, 'personalized'::text]));


--
-- Name: ux_studio_pending_email_pending; Type: INDEX; Schema: marketing; Owner: -
--

CREATE UNIQUE INDEX ux_studio_pending_email_pending ON marketing.studio_outbound_pending_approval USING btree (email) WHERE (status = 'pending'::text);


--
-- Name: beta_feedback_org_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beta_feedback_org_created_idx ON public.beta_feedback USING btree (organization_id, created_at DESC);


--
-- Name: idx_activity_log_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_log_created ON public.admin_activity_log USING btree (created_at DESC);


--
-- Name: idx_activity_log_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_log_target ON public.admin_activity_log USING btree (target_type, target_id);


--
-- Name: idx_ask_history_location_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ask_history_location_created ON public.ask_history USING btree (location_id, created_at DESC);


--
-- Name: idx_brief_feedback_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brief_feedback_location ON public.brief_feedback USING btree (location_id, created_at DESC);


--
-- Name: idx_busy_times_competitor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_busy_times_competitor ON public.busy_times USING btree (competitor_id);


--
-- Name: idx_busy_times_snapshot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_busy_times_snapshot ON public.busy_times USING btree (snapshot_id);


--
-- Name: idx_competitor_photos_competitor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competitor_photos_competitor ON public.competitor_photos USING btree (competitor_id);


--
-- Name: idx_competitor_photos_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competitor_photos_hash ON public.competitor_photos USING btree (image_hash);


--
-- Name: idx_competitor_photos_snapshot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competitor_photos_snapshot ON public.competitor_photos USING btree (snapshot_id);


--
-- Name: idx_competitors_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competitors_active ON public.competitors USING btree (is_active);


--
-- Name: idx_competitors_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competitors_location ON public.competitors USING btree (location_id);


--
-- Name: idx_daily_briefs_location_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_briefs_location_date ON public.daily_briefs USING btree (location_id, date_key DESC);


--
-- Name: idx_evergreen_dismissals_location_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evergreen_dismissals_location_expires ON public.evergreen_dismissals USING btree (location_id, expires_at DESC);


--
-- Name: idx_evergreen_plays_location_saved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evergreen_plays_location_saved ON public.evergreen_plays USING btree (location_id, saved_at DESC);


--
-- Name: idx_fixtures_competition; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fixtures_competition ON public.fixtures USING btree (competition_id);


--
-- Name: idx_fixtures_venue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fixtures_venue ON public.fixtures USING btree (venue_id);


--
-- Name: idx_fixtures_venue_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fixtures_venue_date ON public.fixtures USING btree (venue_id, local_date);


--
-- Name: idx_insight_pool_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_insight_pool_expires ON public.insight_pool_entries USING btree (expires_at);


--
-- Name: idx_insight_pool_location_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_insight_pool_location_category ON public.insight_pool_entries USING btree (location_id, category, last_seen_date DESC);


--
-- Name: idx_insight_pool_location_top; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_insight_pool_location_top ON public.insight_pool_entries USING btree (location_id, is_top DESC, combined_score DESC);


--
-- Name: idx_insights_location_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_insights_location_date ON public.insights USING btree (location_id, date_key);


--
-- Name: idx_insights_reviewed_status_feedback_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_insights_reviewed_status_feedback_at ON public.insights USING btree (reviewed_status, feedback_at DESC);


--
-- Name: idx_job_runs_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_runs_org ON public.job_runs USING btree (organization_id);


--
-- Name: idx_location_busy_times_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_location_busy_times_location ON public.location_busy_times USING btree (location_id);


--
-- Name: idx_location_photos_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_location_photos_hash ON public.location_photos USING btree (image_hash);


--
-- Name: idx_location_photos_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_location_photos_location ON public.location_photos USING btree (location_id);


--
-- Name: idx_location_photos_snapshot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_location_photos_snapshot ON public.location_photos USING btree (snapshot_id);


--
-- Name: idx_location_reviews_author; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_location_reviews_author ON public.location_reviews USING btree (location_id, author_key);


--
-- Name: idx_location_reviews_triage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_location_reviews_triage ON public.location_reviews USING btree (location_id, triage_status, severity_score DESC NULLS LAST, published_at DESC NULLS LAST);


--
-- Name: idx_location_reviews_unscored; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_location_reviews_unscored ON public.location_reviews USING btree (location_id) WHERE (scored_at IS NULL);


--
-- Name: idx_location_snapshots_freshness; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_location_snapshots_freshness ON public.location_snapshots USING btree (location_id, provider, content_as_of DESC) WHERE (freshness = ANY (ARRAY['fresh'::text, 'aging'::text]));


--
-- Name: idx_location_snapshots_loc_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_location_snapshots_loc_date ON public.location_snapshots USING btree (location_id, date_key);


--
-- Name: idx_location_weather_location_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_location_weather_location_date ON public.location_weather USING btree (location_id, date);


--
-- Name: idx_locations_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_locations_org ON public.locations USING btree (organization_id);


--
-- Name: idx_organizations_industry_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_organizations_industry_type ON public.organizations USING btree (industry_type);


--
-- Name: idx_partner_catalog_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_partner_catalog_location ON public.partner_catalog USING btree (location_id, distance_mi);


--
-- Name: idx_partner_catalog_location_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_partner_catalog_location_type ON public.partner_catalog USING btree (location_id, partner_type);


--
-- Name: idx_pipeline_runs_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pipeline_runs_location ON public.pipeline_runs USING btree (location_id, created_at DESC);


--
-- Name: idx_pipeline_runs_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pipeline_runs_run ON public.pipeline_runs USING btree (run_id);


--
-- Name: idx_play_actions_location_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_play_actions_location_created ON public.play_actions USING btree (location_id, created_at DESC);


--
-- Name: idx_play_actions_reviewed_status_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_play_actions_reviewed_status_updated_at ON public.play_actions USING btree (reviewed_status, updated_at DESC);


--
-- Name: idx_refresh_jobs_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refresh_jobs_location ON public.refresh_jobs USING btree (location_id, status);


--
-- Name: idx_refresh_jobs_org_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refresh_jobs_org_status ON public.refresh_jobs USING btree (organization_id, status);


--
-- Name: idx_signal_jobs_claim; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signal_jobs_claim ON public.signal_jobs USING btree (status, scheduled_for) WHERE (status = 'queued'::text);


--
-- Name: idx_signal_jobs_loc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signal_jobs_loc ON public.signal_jobs USING btree (location_id, created_at DESC);


--
-- Name: idx_signal_jobs_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signal_jobs_run ON public.signal_jobs USING btree (run_id);


--
-- Name: idx_skill_feedback_rollup_scope_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_skill_feedback_rollup_scope_id ON public.skill_feedback_rollup USING btree (scope_id) WHERE (scope_id IS NOT NULL);


--
-- Name: idx_skill_feedback_rollup_skill_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_skill_feedback_rollup_skill_scope ON public.skill_feedback_rollup USING btree (skill_id, scope);


--
-- Name: idx_skill_knowledge_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_skill_knowledge_active ON public.skill_knowledge USING btree (skill_id, scope, status);


--
-- Name: idx_skill_knowledge_scope_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_skill_knowledge_scope_id ON public.skill_knowledge USING btree (scope_id) WHERE (scope_id IS NOT NULL);


--
-- Name: idx_skill_source_registry_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_skill_source_registry_enabled ON public.skill_source_registry USING btree (enabled) WHERE enabled;


--
-- Name: idx_snapshots_competitor_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_snapshots_competitor_date ON public.snapshots USING btree (competitor_id, date_key);


--
-- Name: idx_snapshots_date_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_snapshots_date_type ON public.snapshots USING btree (date_key, snapshot_type);


--
-- Name: idx_snapshots_freshness; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_snapshots_freshness ON public.snapshots USING btree (competitor_id, content_as_of DESC) WHERE (freshness = ANY (ARRAY['fresh'::text, 'aging'::text]));


--
-- Name: idx_social_profiles_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_social_profiles_entity ON public.social_profiles USING btree (entity_type, entity_id);


--
-- Name: idx_social_profiles_platform; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_social_profiles_platform ON public.social_profiles USING btree (platform);


--
-- Name: idx_social_snapshots_freshness; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_social_snapshots_freshness ON public.social_snapshots USING btree (social_profile_id, content_as_of DESC) WHERE (freshness = ANY (ARRAY['fresh'::text, 'aging'::text]));


--
-- Name: idx_social_snapshots_profile_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_social_snapshots_profile_date ON public.social_snapshots USING btree (social_profile_id, date_key);


--
-- Name: idx_tracked_keywords_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tracked_keywords_location ON public.tracked_keywords USING btree (location_id);


--
-- Name: idx_venue_catalog_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venue_catalog_location ON public.venue_catalog USING btree (location_id, distance_mi);


--
-- Name: idx_waitlist_signups_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_waitlist_signups_created ON public.waitlist_signups USING btree (created_at DESC);


--
-- Name: idx_waitlist_signups_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_waitlist_signups_email ON public.waitlist_signups USING btree (email);


--
-- Name: idx_waitlist_signups_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_waitlist_signups_status ON public.waitlist_signups USING btree (status);


--
-- Name: organizations_deleted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organizations_deleted_at_idx ON public.organizations USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: organizations_org_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organizations_org_kind_idx ON public.organizations USING btree (org_kind) WHERE (org_kind <> 'real'::text);


--
-- Name: organizations_payment_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organizations_payment_state_idx ON public.organizations USING btree (payment_state) WHERE (payment_state IS NOT NULL);


--
-- Name: organizations_stripe_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organizations_stripe_customer_id_idx ON public.organizations USING btree (stripe_customer_id);


--
-- Name: organizations_stripe_customer_id_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX organizations_stripe_customer_id_uniq ON public.organizations USING btree (stripe_customer_id) WHERE (stripe_customer_id IS NOT NULL);


--
-- Name: organizations_stripe_subscription_id_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX organizations_stripe_subscription_id_uniq ON public.organizations USING btree (stripe_subscription_id) WHERE (stripe_subscription_id IS NOT NULL);


--
-- Name: stripe_events_event_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stripe_events_event_type_idx ON public.stripe_events USING btree (event_type);


--
-- Name: stripe_events_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stripe_events_organization_id_idx ON public.stripe_events USING btree (organization_id);


--
-- Name: stripe_events_received_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stripe_events_received_at_idx ON public.stripe_events USING btree (received_at DESC);


--
-- Name: stripe_events_skipped_reason_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stripe_events_skipped_reason_idx ON public.stripe_events USING btree (skipped_reason) WHERE (skipped_reason IS NOT NULL);


--
-- Name: uq_fixtures_match_row; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_fixtures_match_row ON public.fixtures USING btree (competition_id, venue_id, local_date, local_kickoff) WHERE (local_date IS NOT NULL);


--
-- Name: uq_fixtures_venue_row; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_fixtures_venue_row ON public.fixtures USING btree (competition_id, venue_id) WHERE (local_date IS NULL);


--
-- Name: uq_skill_feedback_rollup_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_skill_feedback_rollup_dedupe ON public.skill_feedback_rollup USING btree (skill_id, scope, scope_id, play_type_key) NULLS NOT DISTINCT;


--
-- Name: uq_skill_knowledge_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_skill_knowledge_dedupe ON public.skill_knowledge USING btree (skill_id, scope, scope_id, learning_kind, title) NULLS NOT DISTINCT;


--
-- Name: contacts trg_contacts_log_status_change; Type: TRIGGER; Schema: marketing; Owner: -
--

CREATE TRIGGER trg_contacts_log_status_change BEFORE UPDATE OF status ON marketing.contacts FOR EACH ROW EXECUTE FUNCTION marketing.log_contact_status_change();


--
-- Name: contacts trg_contacts_notify_access_granted; Type: TRIGGER; Schema: marketing; Owner: -
--

CREATE TRIGGER trg_contacts_notify_access_granted AFTER UPDATE OF status ON marketing.contacts FOR EACH ROW EXECUTE FUNCTION marketing.notify_access_granted();


--
-- Name: contacts trg_contacts_set_trial_end_date; Type: TRIGGER; Schema: marketing; Owner: -
--

CREATE TRIGGER trg_contacts_set_trial_end_date BEFORE INSERT OR UPDATE OF trial_start_date ON marketing.contacts FOR EACH ROW EXECUTE FUNCTION marketing.set_trial_end_date();


--
-- Name: contacts trg_contacts_set_updated_at; Type: TRIGGER; Schema: marketing; Owner: -
--

CREATE TRIGGER trg_contacts_set_updated_at BEFORE UPDATE ON marketing.contacts FOR EACH ROW EXECUTE FUNCTION marketing.set_updated_at();


--
-- Name: waitlist_signups waitlist_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER waitlist_updated_at BEFORE UPDATE ON public.waitlist_signups FOR EACH ROW EXECUTE FUNCTION public.update_waitlist_updated_at();


--
-- Name: email_log email_log_contact_id_fkey; Type: FK CONSTRAINT; Schema: marketing; Owner: -
--

ALTER TABLE ONLY marketing.email_log
    ADD CONSTRAINT email_log_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES marketing.contacts(id) ON DELETE CASCADE;


--
-- Name: events events_contact_id_fkey; Type: FK CONSTRAINT; Schema: marketing; Owner: -
--

ALTER TABLE ONLY marketing.events
    ADD CONSTRAINT events_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES marketing.contacts(id) ON DELETE CASCADE;


--
-- Name: outbound_queue fk_outbound_queue_prospect_id; Type: FK CONSTRAINT; Schema: marketing; Owner: -
--

ALTER TABLE ONLY marketing.outbound_queue
    ADD CONSTRAINT fk_outbound_queue_prospect_id FOREIGN KEY (prospect_id) REFERENCES marketing.prospects(id) ON DELETE SET NULL;


--
-- Name: prospects prospects_converted_to_contact_id_fkey; Type: FK CONSTRAINT; Schema: marketing; Owner: -
--

ALTER TABLE ONLY marketing.prospects
    ADD CONSTRAINT prospects_converted_to_contact_id_fkey FOREIGN KEY (converted_to_contact_id) REFERENCES marketing.contacts(id);


--
-- Name: replies_processed replies_processed_prospect_id_fkey; Type: FK CONSTRAINT; Schema: marketing; Owner: -
--

ALTER TABLE ONLY marketing.replies_processed
    ADD CONSTRAINT replies_processed_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES marketing.prospects(id);


--
-- Name: studio_outbound_pending_approval studio_outbound_pending_approval_outbound_queue_id_fkey; Type: FK CONSTRAINT; Schema: marketing; Owner: -
--

ALTER TABLE ONLY marketing.studio_outbound_pending_approval
    ADD CONSTRAINT studio_outbound_pending_approval_outbound_queue_id_fkey FOREIGN KEY (outbound_queue_id) REFERENCES marketing.outbound_queue(id);


--
-- Name: ask_history ask_history_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ask_history
    ADD CONSTRAINT ask_history_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: beta_feedback beta_feedback_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beta_feedback
    ADD CONSTRAINT beta_feedback_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE SET NULL;


--
-- Name: beta_feedback beta_feedback_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beta_feedback
    ADD CONSTRAINT beta_feedback_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: beta_feedback beta_feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beta_feedback
    ADD CONSTRAINT beta_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: brief_feedback brief_feedback_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brief_feedback
    ADD CONSTRAINT brief_feedback_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: busy_times busy_times_competitor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.busy_times
    ADD CONSTRAINT busy_times_competitor_id_fkey FOREIGN KEY (competitor_id) REFERENCES public.competitors(id) ON DELETE CASCADE;


--
-- Name: competitor_photos competitor_photos_competitor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitor_photos
    ADD CONSTRAINT competitor_photos_competitor_id_fkey FOREIGN KEY (competitor_id) REFERENCES public.competitors(id) ON DELETE CASCADE;


--
-- Name: competitors competitors_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitors
    ADD CONSTRAINT competitors_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: daily_briefs daily_briefs_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_briefs
    ADD CONSTRAINT daily_briefs_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: event_matches event_matches_competitor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_matches
    ADD CONSTRAINT event_matches_competitor_id_fkey FOREIGN KEY (competitor_id) REFERENCES public.competitors(id) ON DELETE SET NULL;


--
-- Name: event_matches event_matches_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_matches
    ADD CONSTRAINT event_matches_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: evergreen_dismissals evergreen_dismissals_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evergreen_dismissals
    ADD CONSTRAINT evergreen_dismissals_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: evergreen_plays evergreen_plays_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evergreen_plays
    ADD CONSTRAINT evergreen_plays_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: insight_pool_entries insight_pool_entries_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insight_pool_entries
    ADD CONSTRAINT insight_pool_entries_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: insight_preferences insight_preferences_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insight_preferences
    ADD CONSTRAINT insight_preferences_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: insights insights_competitor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insights
    ADD CONSTRAINT insights_competitor_id_fkey FOREIGN KEY (competitor_id) REFERENCES public.competitors(id) ON DELETE SET NULL;


--
-- Name: insights insights_feedback_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insights
    ADD CONSTRAINT insights_feedback_by_fkey FOREIGN KEY (feedback_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: insights insights_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insights
    ADD CONSTRAINT insights_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: insights insights_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insights
    ADD CONSTRAINT insights_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id);


--
-- Name: job_runs job_runs_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_runs
    ADD CONSTRAINT job_runs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: location_busy_times location_busy_times_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_busy_times
    ADD CONSTRAINT location_busy_times_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: location_density location_density_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_density
    ADD CONSTRAINT location_density_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: location_photos location_photos_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_photos
    ADD CONSTRAINT location_photos_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: location_reviews location_reviews_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_reviews
    ADD CONSTRAINT location_reviews_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: location_reviews location_reviews_triage_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_reviews
    ADD CONSTRAINT location_reviews_triage_updated_by_fkey FOREIGN KEY (triage_updated_by) REFERENCES auth.users(id);


--
-- Name: location_snapshots location_snapshots_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_snapshots
    ADD CONSTRAINT location_snapshots_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: location_weather location_weather_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location_weather
    ADD CONSTRAINT location_weather_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: locations locations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_members organization_members_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_members organization_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: organizations organizations_waitlist_signup_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_waitlist_signup_id_fkey FOREIGN KEY (waitlist_signup_id) REFERENCES public.waitlist_signups(id);


--
-- Name: partner_catalog partner_catalog_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_catalog
    ADD CONSTRAINT partner_catalog_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: pipeline_runs pipeline_runs_competitor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_runs
    ADD CONSTRAINT pipeline_runs_competitor_id_fkey FOREIGN KEY (competitor_id) REFERENCES public.competitors(id) ON DELETE CASCADE;


--
-- Name: pipeline_runs pipeline_runs_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_runs
    ADD CONSTRAINT pipeline_runs_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: platform_admins platform_admins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admins
    ADD CONSTRAINT platform_admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: play_actions play_actions_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.play_actions
    ADD CONSTRAINT play_actions_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: play_actions play_actions_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.play_actions
    ADD CONSTRAINT play_actions_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id);


--
-- Name: profiles profiles_current_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_current_organization_id_fkey FOREIGN KEY (current_organization_id) REFERENCES public.organizations(id);


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: refresh_jobs refresh_jobs_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_jobs
    ADD CONSTRAINT refresh_jobs_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: refresh_jobs refresh_jobs_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_jobs
    ADD CONSTRAINT refresh_jobs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: signal_jobs signal_jobs_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_jobs
    ADD CONSTRAINT signal_jobs_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: signal_jobs signal_jobs_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_jobs
    ADD CONSTRAINT signal_jobs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: snapshots snapshots_competitor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snapshots
    ADD CONSTRAINT snapshots_competitor_id_fkey FOREIGN KEY (competitor_id) REFERENCES public.competitors(id) ON DELETE CASCADE;


--
-- Name: social_snapshots social_snapshots_social_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_snapshots
    ADD CONSTRAINT social_snapshots_social_profile_id_fkey FOREIGN KEY (social_profile_id) REFERENCES public.social_profiles(id) ON DELETE CASCADE;


--
-- Name: stripe_events stripe_events_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_events
    ADD CONSTRAINT stripe_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: tracked_keywords tracked_keywords_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracked_keywords
    ADD CONSTRAINT tracked_keywords_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: trial_reminder_sends trial_reminder_sends_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trial_reminder_sends
    ADD CONSTRAINT trial_reminder_sends_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: venue_catalog venue_catalog_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_catalog
    ADD CONSTRAINT venue_catalog_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;


--
-- Name: contacts; Type: ROW SECURITY; Schema: marketing; Owner: -
--

ALTER TABLE marketing.contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: contacts contacts_anon_deny; Type: POLICY; Schema: marketing; Owner: -
--

CREATE POLICY contacts_anon_deny ON marketing.contacts TO anon USING (false) WITH CHECK (false);


--
-- Name: email_log; Type: ROW SECURITY; Schema: marketing; Owner: -
--

ALTER TABLE marketing.email_log ENABLE ROW LEVEL SECURITY;

--
-- Name: email_log email_log_anon_deny; Type: POLICY; Schema: marketing; Owner: -
--

CREATE POLICY email_log_anon_deny ON marketing.email_log TO anon USING (false) WITH CHECK (false);


--
-- Name: events; Type: ROW SECURITY; Schema: marketing; Owner: -
--

ALTER TABLE marketing.events ENABLE ROW LEVEL SECURITY;

--
-- Name: events events_anon_deny; Type: POLICY; Schema: marketing; Owner: -
--

CREATE POLICY events_anon_deny ON marketing.events TO anon USING (false) WITH CHECK (false);


--
-- Name: failed_events; Type: ROW SECURITY; Schema: marketing; Owner: -
--

ALTER TABLE marketing.failed_events ENABLE ROW LEVEL SECURITY;

--
-- Name: failed_events failed_events_anon_deny; Type: POLICY; Schema: marketing; Owner: -
--

CREATE POLICY failed_events_anon_deny ON marketing.failed_events TO anon USING (false) WITH CHECK (false);


--
-- Name: mentions; Type: ROW SECURITY; Schema: marketing; Owner: -
--

ALTER TABLE marketing.mentions ENABLE ROW LEVEL SECURITY;

--
-- Name: mentions mentions_anon_deny; Type: POLICY; Schema: marketing; Owner: -
--

CREATE POLICY mentions_anon_deny ON marketing.mentions TO anon USING (false) WITH CHECK (false);


--
-- Name: outbound_queue; Type: ROW SECURITY; Schema: marketing; Owner: -
--

ALTER TABLE marketing.outbound_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: outbound_queue outbound_queue_anon_deny; Type: POLICY; Schema: marketing; Owner: -
--

CREATE POLICY outbound_queue_anon_deny ON marketing.outbound_queue TO anon USING (false) WITH CHECK (false);


--
-- Name: prospects; Type: ROW SECURITY; Schema: marketing; Owner: -
--

ALTER TABLE marketing.prospects ENABLE ROW LEVEL SECURITY;

--
-- Name: prospects prospects_anon_deny; Type: POLICY; Schema: marketing; Owner: -
--

CREATE POLICY prospects_anon_deny ON marketing.prospects TO anon USING (false) WITH CHECK (false);


--
-- Name: replies_processed; Type: ROW SECURITY; Schema: marketing; Owner: -
--

ALTER TABLE marketing.replies_processed ENABLE ROW LEVEL SECURITY;

--
-- Name: replies_processed replies_processed_anon_deny; Type: POLICY; Schema: marketing; Owner: -
--

CREATE POLICY replies_processed_anon_deny ON marketing.replies_processed TO anon USING (false) WITH CHECK (false);


--
-- Name: shared_domain_daily_counter; Type: ROW SECURITY; Schema: marketing; Owner: -
--

ALTER TABLE marketing.shared_domain_daily_counter ENABLE ROW LEVEL SECURITY;

--
-- Name: shared_domain_daily_counter shared_domain_daily_counter_anon_deny; Type: POLICY; Schema: marketing; Owner: -
--

CREATE POLICY shared_domain_daily_counter_anon_deny ON marketing.shared_domain_daily_counter TO anon USING (false) WITH CHECK (false);


--
-- Name: studio_outbound_pending_approval; Type: ROW SECURITY; Schema: marketing; Owner: -
--

ALTER TABLE marketing.studio_outbound_pending_approval ENABLE ROW LEVEL SECURITY;

--
-- Name: studio_outbound_pending_approval studio_outbound_pending_approval_anon_deny; Type: POLICY; Schema: marketing; Owner: -
--

CREATE POLICY studio_outbound_pending_approval_anon_deny ON marketing.studio_outbound_pending_approval TO anon USING (false) WITH CHECK (false);


--
-- Name: insight_preferences Members can read own org preferences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members can read own org preferences" ON public.insight_preferences FOR SELECT USING ((organization_id IN ( SELECT organization_members.organization_id
   FROM public.organization_members
  WHERE (organization_members.user_id = auth.uid()))));


--
-- Name: insight_preferences Members can update own org preferences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members can update own org preferences" ON public.insight_preferences FOR UPDATE USING ((organization_id IN ( SELECT organization_members.organization_id
   FROM public.organization_members
  WHERE (organization_members.user_id = auth.uid()))));


--
-- Name: insight_preferences Members can upsert own org preferences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members can upsert own org preferences" ON public.insight_preferences FOR INSERT WITH CHECK ((organization_id IN ( SELECT organization_members.organization_id
   FROM public.organization_members
  WHERE (organization_members.user_id = auth.uid()))));


--
-- Name: admin_activity_log No public access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "No public access" ON public.admin_activity_log USING (false);


--
-- Name: platform_admins No public access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "No public access" ON public.platform_admins USING (false);


--
-- Name: admin_activity_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_activity_log ENABLE ROW LEVEL SECURITY;

--
-- Name: ask_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ask_history ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations authenticated can create org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated can create org" ON public.organizations FOR INSERT WITH CHECK ((auth.uid() IS NOT NULL));


--
-- Name: fixtures authenticated can read fixtures; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated can read fixtures" ON public.fixtures FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: skill_source_registry authenticated can read skill_source_registry; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated can read skill_source_registry" ON public.skill_source_registry FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: beta_feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.beta_feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: beta_feedback beta_feedback_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY beta_feedback_insert ON public.beta_feedback FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.organization_members m
  WHERE ((m.organization_id = beta_feedback.organization_id) AND (m.user_id = auth.uid()))))));


--
-- Name: beta_feedback beta_feedback_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY beta_feedback_select ON public.beta_feedback FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.organization_members m
  WHERE ((m.organization_id = beta_feedback.organization_id) AND (m.user_id = auth.uid())))));


--
-- Name: brief_feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.brief_feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: busy_times; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.busy_times ENABLE ROW LEVEL SECURITY;

--
-- Name: competitor_photos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.competitor_photos ENABLE ROW LEVEL SECURITY;

--
-- Name: competitors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.competitors ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_briefs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.daily_briefs ENABLE ROW LEVEL SECURITY;

--
-- Name: event_matches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_matches ENABLE ROW LEVEL SECURITY;

--
-- Name: evergreen_dismissals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.evergreen_dismissals ENABLE ROW LEVEL SECURITY;

--
-- Name: evergreen_plays; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.evergreen_plays ENABLE ROW LEVEL SECURITY;

--
-- Name: fixtures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fixtures ENABLE ROW LEVEL SECURITY;

--
-- Name: skill_feedback_rollup global skill_feedback_rollup readable by all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "global skill_feedback_rollup readable by all" ON public.skill_feedback_rollup FOR SELECT USING (((scope = 'global'::text) AND (auth.role() = 'authenticated'::text)));


--
-- Name: skill_knowledge global skill_knowledge readable by all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "global skill_knowledge readable by all" ON public.skill_knowledge FOR SELECT USING (((scope = 'global'::text) AND (auth.role() = 'authenticated'::text)));


--
-- Name: insight_pool_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.insight_pool_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: insight_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.insight_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: insights; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.insights ENABLE ROW LEVEL SECURITY;

--
-- Name: job_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: location_busy_times; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.location_busy_times ENABLE ROW LEVEL SECURITY;

--
-- Name: location_density; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.location_density ENABLE ROW LEVEL SECURITY;

--
-- Name: location_photos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.location_photos ENABLE ROW LEVEL SECURITY;

--
-- Name: location_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.location_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: location_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.location_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: location_weather; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.location_weather ENABLE ROW LEVEL SECURITY;

--
-- Name: locations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

--
-- Name: ops_brief_backup_20260717; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ops_brief_backup_20260717 ENABLE ROW LEVEL SECURITY;

--
-- Name: ops_brief_backup_20260717b; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ops_brief_backup_20260717b ENABLE ROW LEVEL SECURITY;

--
-- Name: busy_times org admins can delete busy times; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can delete busy times" ON public.busy_times FOR DELETE USING ((EXISTS ( SELECT 1
   FROM ((public.competitors c
     JOIN public.locations l ON ((l.id = c.location_id)))
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((c.id = busy_times.competitor_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: competitor_photos org admins can delete competitor photos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can delete competitor photos" ON public.competitor_photos FOR DELETE USING ((EXISTS ( SELECT 1
   FROM ((public.competitors c
     JOIN public.locations l ON ((l.id = c.location_id)))
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((c.id = competitor_photos.competitor_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: competitors org admins can delete competitors; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can delete competitors" ON public.competitors FOR DELETE USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = competitors.location_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: event_matches org admins can delete event_matches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can delete event_matches" ON public.event_matches FOR DELETE USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = event_matches.location_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: location_photos org admins can delete location photos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can delete location photos" ON public.location_photos FOR DELETE USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = location_photos.location_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: location_weather org admins can delete location weather; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can delete location weather" ON public.location_weather FOR DELETE USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = location_weather.location_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: location_snapshots org admins can delete location_snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can delete location_snapshots" ON public.location_snapshots FOR DELETE USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = location_snapshots.location_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: locations org admins can delete locations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can delete locations" ON public.locations FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.organization_members m
  WHERE ((m.organization_id = locations.organization_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: social_profiles org admins can delete social profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can delete social profiles" ON public.social_profiles FOR DELETE USING ((((entity_type = 'location'::text) AND (entity_id IN ( SELECT l.id
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text])))))) OR ((entity_type = 'competitor'::text) AND (entity_id IN ( SELECT c.id
   FROM ((public.competitors c
     JOIN public.locations l ON ((l.id = c.location_id)))
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))))));


--
-- Name: tracked_keywords org admins can delete tracked keywords; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can delete tracked keywords" ON public.tracked_keywords FOR DELETE USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = tracked_keywords.location_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: busy_times org admins can insert busy times; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can insert busy times" ON public.busy_times FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ((public.competitors c
     JOIN public.locations l ON ((l.id = c.location_id)))
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((c.id = busy_times.competitor_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: competitor_photos org admins can insert competitor photos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can insert competitor photos" ON public.competitor_photos FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ((public.competitors c
     JOIN public.locations l ON ((l.id = c.location_id)))
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((c.id = competitor_photos.competitor_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: competitors org admins can insert competitors; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can insert competitors" ON public.competitors FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = competitors.location_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: event_matches org admins can insert event_matches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can insert event_matches" ON public.event_matches FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = event_matches.location_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: insights org admins can insert insights; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can insert insights" ON public.insights FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = insights.location_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: job_runs org admins can insert job runs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can insert job runs" ON public.job_runs FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.organization_members m
  WHERE ((m.organization_id = job_runs.organization_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: location_photos org admins can insert location photos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can insert location photos" ON public.location_photos FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = location_photos.location_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: location_weather org admins can insert location weather; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can insert location weather" ON public.location_weather FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = location_weather.location_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: location_snapshots org admins can insert location_snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can insert location_snapshots" ON public.location_snapshots FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = location_snapshots.location_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: locations org admins can insert locations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can insert locations" ON public.locations FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.organization_members m
  WHERE ((m.organization_id = locations.organization_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: snapshots org admins can insert snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can insert snapshots" ON public.snapshots FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ((public.competitors c
     JOIN public.locations l ON ((l.id = c.location_id)))
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((c.id = snapshots.competitor_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: social_profiles org admins can insert social profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can insert social profiles" ON public.social_profiles FOR INSERT WITH CHECK ((((entity_type = 'location'::text) AND (entity_id IN ( SELECT l.id
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text])))))) OR ((entity_type = 'competitor'::text) AND (entity_id IN ( SELECT c.id
   FROM ((public.competitors c
     JOIN public.locations l ON ((l.id = c.location_id)))
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))))));


--
-- Name: social_snapshots org admins can insert social snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can insert social snapshots" ON public.social_snapshots FOR INSERT WITH CHECK ((social_profile_id IN ( SELECT sp.id
   FROM public.social_profiles sp
  WHERE (((sp.entity_type = 'location'::text) AND (sp.entity_id IN ( SELECT l.id
           FROM (public.locations l
             JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
          WHERE ((m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text])))))) OR ((sp.entity_type = 'competitor'::text) AND (sp.entity_id IN ( SELECT c.id
           FROM ((public.competitors c
             JOIN public.locations l ON ((l.id = c.location_id)))
             JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
          WHERE ((m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))))))));


--
-- Name: tracked_keywords org admins can insert tracked keywords; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can insert tracked keywords" ON public.tracked_keywords FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = tracked_keywords.location_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: competitor_photos org admins can update competitor photos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can update competitor photos" ON public.competitor_photos FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM ((public.competitors c
     JOIN public.locations l ON ((l.id = c.location_id)))
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((c.id = competitor_photos.competitor_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: competitors org admins can update competitors; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can update competitors" ON public.competitors FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = competitors.location_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: event_matches org admins can update event_matches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can update event_matches" ON public.event_matches FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = event_matches.location_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: location_photos org admins can update location photos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can update location photos" ON public.location_photos FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = location_photos.location_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: location_snapshots org admins can update location_snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can update location_snapshots" ON public.location_snapshots FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = location_snapshots.location_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: locations org admins can update locations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can update locations" ON public.locations FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.organization_members m
  WHERE ((m.organization_id = locations.organization_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: snapshots org admins can update snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can update snapshots" ON public.snapshots FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM ((public.competitors c
     JOIN public.locations l ON ((l.id = c.location_id)))
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((c.id = snapshots.competitor_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ((public.competitors c
     JOIN public.locations l ON ((l.id = c.location_id)))
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((c.id = snapshots.competitor_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: social_profiles org admins can update social profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can update social profiles" ON public.social_profiles FOR UPDATE USING ((((entity_type = 'location'::text) AND (entity_id IN ( SELECT l.id
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text])))))) OR ((entity_type = 'competitor'::text) AND (entity_id IN ( SELECT c.id
   FROM ((public.competitors c
     JOIN public.locations l ON ((l.id = c.location_id)))
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))))));


--
-- Name: social_snapshots org admins can update social snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can update social snapshots" ON public.social_snapshots FOR UPDATE USING ((social_profile_id IN ( SELECT sp.id
   FROM public.social_profiles sp
  WHERE (((sp.entity_type = 'location'::text) AND (sp.entity_id IN ( SELECT l.id
           FROM (public.locations l
             JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
          WHERE ((m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text])))))) OR ((sp.entity_type = 'competitor'::text) AND (sp.entity_id IN ( SELECT c.id
           FROM ((public.competitors c
             JOIN public.locations l ON ((l.id = c.location_id)))
             JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
          WHERE ((m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text])))))))))) WITH CHECK ((social_profile_id IN ( SELECT sp.id
   FROM public.social_profiles sp
  WHERE (((sp.entity_type = 'location'::text) AND (sp.entity_id IN ( SELECT l.id
           FROM (public.locations l
             JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
          WHERE ((m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text])))))) OR ((sp.entity_type = 'competitor'::text) AND (sp.entity_id IN ( SELECT c.id
           FROM ((public.competitors c
             JOIN public.locations l ON ((l.id = c.location_id)))
             JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
          WHERE ((m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))))))));


--
-- Name: tracked_keywords org admins can update tracked keywords; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org admins can update tracked keywords" ON public.tracked_keywords FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = tracked_keywords.location_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: organization_members org creator can add first membership; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org creator can add first membership" ON public.organization_members FOR INSERT WITH CHECK (((user_id = auth.uid()) AND (role = 'owner'::text) AND (( SELECT count(*) AS count
   FROM public.organization_members m
  WHERE (m.organization_id = organization_members.organization_id)) = 0)));


--
-- Name: evergreen_dismissals org members can delete evergreen_dismissals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can delete evergreen_dismissals" ON public.evergreen_dismissals FOR DELETE USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = evergreen_dismissals.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: evergreen_plays org members can delete evergreen_plays; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can delete evergreen_plays" ON public.evergreen_plays FOR DELETE USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = evergreen_plays.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: play_actions org members can delete play_actions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can delete play_actions" ON public.play_actions FOR DELETE USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = play_actions.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: brief_feedback org members can insert brief_feedback; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can insert brief_feedback" ON public.brief_feedback FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = brief_feedback.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: evergreen_dismissals org members can insert evergreen_dismissals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can insert evergreen_dismissals" ON public.evergreen_dismissals FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = evergreen_dismissals.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: evergreen_plays org members can insert evergreen_plays; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can insert evergreen_plays" ON public.evergreen_plays FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = evergreen_plays.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: play_actions org members can insert play_actions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can insert play_actions" ON public.play_actions FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = play_actions.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: ask_history org members can read ask_history; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read ask_history" ON public.ask_history FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = ask_history.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: brief_feedback org members can read brief_feedback; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read brief_feedback" ON public.brief_feedback FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = brief_feedback.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: busy_times org members can read busy times; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read busy times" ON public.busy_times FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ((public.competitors c
     JOIN public.locations l ON ((l.id = c.location_id)))
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((c.id = busy_times.competitor_id) AND (m.user_id = auth.uid())))));


--
-- Name: competitor_photos org members can read competitor photos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read competitor photos" ON public.competitor_photos FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ((public.competitors c
     JOIN public.locations l ON ((l.id = c.location_id)))
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((c.id = competitor_photos.competitor_id) AND (m.user_id = auth.uid())))));


--
-- Name: competitors org members can read competitors; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read competitors" ON public.competitors FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = competitors.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: daily_briefs org members can read daily_briefs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read daily_briefs" ON public.daily_briefs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = daily_briefs.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: event_matches org members can read event_matches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read event_matches" ON public.event_matches FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = event_matches.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: evergreen_dismissals org members can read evergreen_dismissals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read evergreen_dismissals" ON public.evergreen_dismissals FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = evergreen_dismissals.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: evergreen_plays org members can read evergreen_plays; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read evergreen_plays" ON public.evergreen_plays FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = evergreen_plays.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: insights org members can read insights; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read insights" ON public.insights FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = insights.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: job_runs org members can read job runs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read job runs" ON public.job_runs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.organization_members m
  WHERE ((m.organization_id = job_runs.organization_id) AND (m.user_id = auth.uid())))));


--
-- Name: location_photos org members can read location photos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read location photos" ON public.location_photos FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = location_photos.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: location_weather org members can read location weather; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read location weather" ON public.location_weather FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = location_weather.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: skill_feedback_rollup org members can read location-scoped skill_feedback_rollup; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read location-scoped skill_feedback_rollup" ON public.skill_feedback_rollup FOR SELECT USING (((scope = 'location'::text) AND (EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = skill_feedback_rollup.scope_id) AND (m.user_id = auth.uid()))))));


--
-- Name: skill_knowledge org members can read location-scoped skill_knowledge; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read location-scoped skill_knowledge" ON public.skill_knowledge FOR SELECT USING (((scope = 'location'::text) AND (EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = skill_knowledge.scope_id) AND (m.user_id = auth.uid()))))));


--
-- Name: location_busy_times org members can read location_busy_times; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read location_busy_times" ON public.location_busy_times FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = location_busy_times.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: location_density org members can read location_density; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read location_density" ON public.location_density FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = location_density.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: location_snapshots org members can read location_snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read location_snapshots" ON public.location_snapshots FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = location_snapshots.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: locations org members can read locations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read locations" ON public.locations FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.organization_members m
  WHERE ((m.organization_id = locations.organization_id) AND (m.user_id = auth.uid())))));


--
-- Name: organization_members org members can read membership; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read membership" ON public.organization_members FOR SELECT USING (((user_id = auth.uid()) OR public.is_org_admin(organization_id)));


--
-- Name: organizations org members can read org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read org" ON public.organizations FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.organization_members m
  WHERE ((m.organization_id = organizations.id) AND (m.user_id = auth.uid())))));


--
-- Name: skill_feedback_rollup org members can read org-scoped skill_feedback_rollup; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read org-scoped skill_feedback_rollup" ON public.skill_feedback_rollup FOR SELECT USING (((scope = 'org'::text) AND (EXISTS ( SELECT 1
   FROM public.organization_members m
  WHERE ((m.organization_id = skill_feedback_rollup.scope_id) AND (m.user_id = auth.uid()))))));


--
-- Name: skill_knowledge org members can read org-scoped skill_knowledge; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read org-scoped skill_knowledge" ON public.skill_knowledge FOR SELECT USING (((scope = 'org'::text) AND (EXISTS ( SELECT 1
   FROM public.organization_members m
  WHERE ((m.organization_id = skill_knowledge.scope_id) AND (m.user_id = auth.uid()))))));


--
-- Name: partner_catalog org members can read partner_catalog; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read partner_catalog" ON public.partner_catalog FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = partner_catalog.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: pipeline_runs org members can read pipeline_runs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read pipeline_runs" ON public.pipeline_runs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = pipeline_runs.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: play_actions org members can read play_actions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read play_actions" ON public.play_actions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = play_actions.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: signal_jobs org members can read signal_jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read signal_jobs" ON public.signal_jobs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = signal_jobs.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: snapshots org members can read snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read snapshots" ON public.snapshots FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ((public.competitors c
     JOIN public.locations l ON ((l.id = c.location_id)))
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((c.id = snapshots.competitor_id) AND (m.user_id = auth.uid())))));


--
-- Name: social_profiles org members can read social profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read social profiles" ON public.social_profiles FOR SELECT USING ((((entity_type = 'location'::text) AND (entity_id IN ( SELECT l.id
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE (m.user_id = auth.uid())))) OR ((entity_type = 'competitor'::text) AND (entity_id IN ( SELECT c.id
   FROM ((public.competitors c
     JOIN public.locations l ON ((l.id = c.location_id)))
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE (m.user_id = auth.uid()))))));


--
-- Name: social_snapshots org members can read social snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read social snapshots" ON public.social_snapshots FOR SELECT USING ((social_profile_id IN ( SELECT sp.id
   FROM public.social_profiles sp
  WHERE (((sp.entity_type = 'location'::text) AND (sp.entity_id IN ( SELECT l.id
           FROM (public.locations l
             JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
          WHERE (m.user_id = auth.uid())))) OR ((sp.entity_type = 'competitor'::text) AND (sp.entity_id IN ( SELECT c.id
           FROM ((public.competitors c
             JOIN public.locations l ON ((l.id = c.location_id)))
             JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
          WHERE (m.user_id = auth.uid()))))))));


--
-- Name: tracked_keywords org members can read tracked keywords; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read tracked keywords" ON public.tracked_keywords FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = tracked_keywords.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: venue_catalog org members can read venue_catalog; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can read venue_catalog" ON public.venue_catalog FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = venue_catalog.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: evergreen_dismissals org members can update evergreen_dismissals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can update evergreen_dismissals" ON public.evergreen_dismissals FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = evergreen_dismissals.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: evergreen_plays org members can update evergreen_plays; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can update evergreen_plays" ON public.evergreen_plays FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = evergreen_plays.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: insights org members can update insights; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can update insights" ON public.insights FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = insights.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: play_actions org members can update play_actions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members can update play_actions" ON public.play_actions FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = play_actions.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: location_reviews org members insert location_reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members insert location_reviews" ON public.location_reviews FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = location_reviews.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: insight_pool_entries org members read insight_pool_entries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members read insight_pool_entries" ON public.insight_pool_entries FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = insight_pool_entries.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: location_reviews org members read location_reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members read location_reviews" ON public.location_reviews FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = location_reviews.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: location_reviews org members update location_reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org members update location_reviews" ON public.location_reviews FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM (public.locations l
     JOIN public.organization_members m ON ((m.organization_id = l.organization_id)))
  WHERE ((l.id = location_reviews.location_id) AND (m.user_id = auth.uid())))));


--
-- Name: organization_members org owners/admins can delete membership; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org owners/admins can delete membership" ON public.organization_members FOR DELETE USING (public.is_org_admin(organization_id));


--
-- Name: organization_members org owners/admins can manage membership; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org owners/admins can manage membership" ON public.organization_members FOR INSERT WITH CHECK ((public.is_org_admin(organization_id) OR ((user_id = auth.uid()) AND (role = 'owner'::text) AND (( SELECT count(*) AS count
   FROM public.organization_members m
  WHERE (m.organization_id = organization_members.organization_id)) = 0))));


--
-- Name: organization_members org owners/admins can update membership; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org owners/admins can update membership" ON public.organization_members FOR UPDATE USING (public.is_org_admin(organization_id));


--
-- Name: organizations org owners/admins can update org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "org owners/admins can update org" ON public.organizations FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.organization_members m
  WHERE ((m.organization_id = organizations.id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: organization_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: partner_catalog; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.partner_catalog ENABLE ROW LEVEL SECURITY;

--
-- Name: pipeline_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_admins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

--
-- Name: play_actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.play_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: refresh_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.refresh_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: refresh_jobs refresh_jobs_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refresh_jobs_insert ON public.refresh_jobs FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.organization_members m
  WHERE ((m.organization_id = refresh_jobs.organization_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: refresh_jobs refresh_jobs_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refresh_jobs_select ON public.refresh_jobs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.organization_members m
  WHERE ((m.organization_id = refresh_jobs.organization_id) AND (m.user_id = auth.uid())))));


--
-- Name: refresh_jobs refresh_jobs_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refresh_jobs_update ON public.refresh_jobs FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.organization_members m
  WHERE ((m.organization_id = refresh_jobs.organization_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: signal_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.signal_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: skill_feedback_rollup; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.skill_feedback_rollup ENABLE ROW LEVEL SECURITY;

--
-- Name: skill_knowledge; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.skill_knowledge ENABLE ROW LEVEL SECURITY;

--
-- Name: skill_source_registry; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.skill_source_registry ENABLE ROW LEVEL SECURITY;

--
-- Name: snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: social_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.social_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: social_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.social_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: stripe_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;

--
-- Name: stripe_events stripe_events_service_role_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY stripe_events_service_role_only ON public.stripe_events USING (false) WITH CHECK (false);


--
-- Name: stripe_webhook_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

--
-- Name: stripe_webhook_events stripe_webhook_events_anon_deny; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY stripe_webhook_events_anon_deny ON public.stripe_webhook_events TO anon USING (false) WITH CHECK (false);


--
-- Name: tracked_keywords; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tracked_keywords ENABLE ROW LEVEL SECURITY;

--
-- Name: trial_reminder_sends; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trial_reminder_sends ENABLE ROW LEVEL SECURITY;

--
-- Name: trial_reminder_sends trial_reminder_sends_anon_deny; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trial_reminder_sends_anon_deny ON public.trial_reminder_sends TO anon USING (false) WITH CHECK (false);


--
-- Name: profiles users can insert own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users can insert own profile" ON public.profiles FOR INSERT WITH CHECK ((id = auth.uid()));


--
-- Name: profiles users can read own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users can read own profile" ON public.profiles FOR SELECT USING ((id = auth.uid()));


--
-- Name: profiles users can update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users can update own profile" ON public.profiles FOR UPDATE USING ((id = auth.uid()));


--
-- Name: venue_catalog; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.venue_catalog ENABLE ROW LEVEL SECURITY;

--
-- Name: venue_geocode_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.venue_geocode_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: waitlist_signups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waitlist_signups ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA marketing; Type: ACL; Schema: -; Owner: -
--

GRANT ALL ON SCHEMA marketing TO marketing_ops;
GRANT USAGE ON SCHEMA marketing TO service_role;
GRANT USAGE ON SCHEMA marketing TO anon;
GRANT USAGE ON SCHEMA marketing TO authenticated;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT USAGE ON SCHEMA public TO marketing_ops;


--
-- Name: FUNCTION filter_new_mentions(incoming_hashes text[]); Type: ACL; Schema: marketing; Owner: -
--

REVOKE ALL ON FUNCTION marketing.filter_new_mentions(incoming_hashes text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION marketing.filter_new_mentions(incoming_hashes text[]) TO service_role;


--
-- Name: FUNCTION notify_access_granted(); Type: ACL; Schema: marketing; Owner: -
--

REVOKE ALL ON FUNCTION marketing.notify_access_granted() FROM PUBLIC;
GRANT ALL ON FUNCTION marketing.notify_access_granted() TO service_role;


--
-- Name: FUNCTION cascade_delete_organization(p_org_id uuid, p_keep_shell boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cascade_delete_organization(p_org_id uuid, p_keep_shell boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cascade_delete_organization(p_org_id uuid, p_keep_shell boolean) TO service_role;


--
-- Name: TABLE signal_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.signal_jobs TO anon;
GRANT ALL ON TABLE public.signal_jobs TO authenticated;
GRANT ALL ON TABLE public.signal_jobs TO service_role;


--
-- Name: FUNCTION claim_signal_jobs(batch integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_signal_jobs(batch integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_signal_jobs(batch integer) TO service_role;


--
-- Name: FUNCTION is_org_admin(org_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_org_admin(org_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_org_admin(org_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_org_admin(org_id uuid) TO service_role;


--
-- Name: FUNCTION is_org_member(org_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_org_member(org_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_org_member(org_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_org_member(org_id uuid) TO service_role;


--
-- Name: FUNCTION update_waitlist_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_waitlist_updated_at() TO anon;
GRANT ALL ON FUNCTION public.update_waitlist_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.update_waitlist_updated_at() TO service_role;


--
-- Name: TABLE contacts; Type: ACL; Schema: marketing; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE marketing.contacts TO marketing_ops;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE marketing.contacts TO service_role;


--
-- Name: TABLE email_log; Type: ACL; Schema: marketing; Owner: -
--

GRANT ALL ON TABLE marketing.email_log TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE marketing.email_log TO marketing_ops;


--
-- Name: TABLE events; Type: ACL; Schema: marketing; Owner: -
--

GRANT ALL ON TABLE marketing.events TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE marketing.events TO marketing_ops;


--
-- Name: TABLE failed_events; Type: ACL; Schema: marketing; Owner: -
--

GRANT ALL ON TABLE marketing.failed_events TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE marketing.failed_events TO marketing_ops;


--
-- Name: TABLE mentions; Type: ACL; Schema: marketing; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE marketing.mentions TO service_role;


--
-- Name: TABLE outbound_queue; Type: ACL; Schema: marketing; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE marketing.outbound_queue TO service_role;


--
-- Name: TABLE prospects; Type: ACL; Schema: marketing; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE marketing.prospects TO service_role;


--
-- Name: TABLE replies_processed; Type: ACL; Schema: marketing; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE marketing.replies_processed TO service_role;


--
-- Name: TABLE shared_domain_daily_counter; Type: ACL; Schema: marketing; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE marketing.shared_domain_daily_counter TO service_role;


--
-- Name: TABLE studio_outbound_pending_approval; Type: ACL; Schema: marketing; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE marketing.studio_outbound_pending_approval TO service_role;


--
-- Name: TABLE v_auric_crosssell_due; Type: ACL; Schema: marketing; Owner: -
--

GRANT ALL ON TABLE marketing.v_auric_crosssell_due TO service_role;
GRANT SELECT ON TABLE marketing.v_auric_crosssell_due TO marketing_ops;


--
-- Name: TABLE v_outbound_queue_depth; Type: ACL; Schema: marketing; Owner: -
--

GRANT SELECT ON TABLE marketing.v_outbound_queue_depth TO service_role;


--
-- Name: TABLE v_trial_onboarding_due; Type: ACL; Schema: marketing; Owner: -
--

GRANT ALL ON TABLE marketing.v_trial_onboarding_due TO service_role;
GRANT SELECT ON TABLE marketing.v_trial_onboarding_due TO marketing_ops;


--
-- Name: TABLE v_waitlist_nurture_due; Type: ACL; Schema: marketing; Owner: -
--

GRANT ALL ON TABLE marketing.v_waitlist_nurture_due TO service_role;
GRANT SELECT ON TABLE marketing.v_waitlist_nurture_due TO marketing_ops;


--
-- Name: TABLE admin_activity_log; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.admin_activity_log TO anon;
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.admin_activity_log TO authenticated;
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.admin_activity_log TO service_role;


--
-- Name: TABLE ask_history; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ask_history TO anon;
GRANT ALL ON TABLE public.ask_history TO authenticated;
GRANT ALL ON TABLE public.ask_history TO service_role;


--
-- Name: TABLE beta_feedback; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.beta_feedback TO anon;
GRANT ALL ON TABLE public.beta_feedback TO authenticated;
GRANT ALL ON TABLE public.beta_feedback TO service_role;


--
-- Name: TABLE brief_feedback; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.brief_feedback TO anon;
GRANT ALL ON TABLE public.brief_feedback TO authenticated;
GRANT ALL ON TABLE public.brief_feedback TO service_role;


--
-- Name: TABLE busy_times; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.busy_times TO anon;
GRANT ALL ON TABLE public.busy_times TO authenticated;
GRANT ALL ON TABLE public.busy_times TO service_role;


--
-- Name: TABLE competitor_photos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.competitor_photos TO anon;
GRANT ALL ON TABLE public.competitor_photos TO authenticated;
GRANT ALL ON TABLE public.competitor_photos TO service_role;


--
-- Name: TABLE competitors; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.competitors TO anon;
GRANT ALL ON TABLE public.competitors TO authenticated;
GRANT ALL ON TABLE public.competitors TO service_role;


--
-- Name: TABLE daily_briefs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.daily_briefs TO anon;
GRANT ALL ON TABLE public.daily_briefs TO authenticated;
GRANT ALL ON TABLE public.daily_briefs TO service_role;


--
-- Name: TABLE event_matches; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.event_matches TO anon;
GRANT ALL ON TABLE public.event_matches TO authenticated;
GRANT ALL ON TABLE public.event_matches TO service_role;


--
-- Name: TABLE evergreen_dismissals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.evergreen_dismissals TO anon;
GRANT ALL ON TABLE public.evergreen_dismissals TO authenticated;
GRANT ALL ON TABLE public.evergreen_dismissals TO service_role;


--
-- Name: TABLE evergreen_plays; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.evergreen_plays TO anon;
GRANT ALL ON TABLE public.evergreen_plays TO authenticated;
GRANT ALL ON TABLE public.evergreen_plays TO service_role;


--
-- Name: TABLE fixtures; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.fixtures TO anon;
GRANT ALL ON TABLE public.fixtures TO authenticated;
GRANT ALL ON TABLE public.fixtures TO service_role;


--
-- Name: TABLE insight_pool_entries; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.insight_pool_entries TO anon;
GRANT ALL ON TABLE public.insight_pool_entries TO authenticated;
GRANT ALL ON TABLE public.insight_pool_entries TO service_role;


--
-- Name: TABLE insight_preferences; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.insight_preferences TO anon;
GRANT ALL ON TABLE public.insight_preferences TO authenticated;
GRANT ALL ON TABLE public.insight_preferences TO service_role;


--
-- Name: TABLE insights; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.insights TO anon;
GRANT ALL ON TABLE public.insights TO authenticated;
GRANT ALL ON TABLE public.insights TO service_role;


--
-- Name: TABLE job_runs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.job_runs TO anon;
GRANT ALL ON TABLE public.job_runs TO authenticated;
GRANT ALL ON TABLE public.job_runs TO service_role;


--
-- Name: TABLE location_busy_times; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.location_busy_times TO anon;
GRANT ALL ON TABLE public.location_busy_times TO authenticated;
GRANT ALL ON TABLE public.location_busy_times TO service_role;


--
-- Name: TABLE location_density; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.location_density TO anon;
GRANT ALL ON TABLE public.location_density TO authenticated;
GRANT ALL ON TABLE public.location_density TO service_role;


--
-- Name: TABLE location_photos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.location_photos TO anon;
GRANT ALL ON TABLE public.location_photos TO authenticated;
GRANT ALL ON TABLE public.location_photos TO service_role;


--
-- Name: TABLE location_reviews; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.location_reviews TO anon;
GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.location_reviews TO authenticated;
GRANT ALL ON TABLE public.location_reviews TO service_role;


--
-- Name: COLUMN location_reviews.location_id; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(location_id),UPDATE(location_id) ON TABLE public.location_reviews TO authenticated;


--
-- Name: COLUMN location_reviews.source; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(source),UPDATE(source) ON TABLE public.location_reviews TO authenticated;


--
-- Name: COLUMN location_reviews.source_review_id; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(source_review_id),UPDATE(source_review_id) ON TABLE public.location_reviews TO authenticated;


--
-- Name: COLUMN location_reviews.author_name; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(author_name),UPDATE(author_name) ON TABLE public.location_reviews TO authenticated;


--
-- Name: COLUMN location_reviews.author_key; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(author_key),UPDATE(author_key) ON TABLE public.location_reviews TO authenticated;


--
-- Name: COLUMN location_reviews.rating; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(rating),UPDATE(rating) ON TABLE public.location_reviews TO authenticated;


--
-- Name: COLUMN location_reviews.review_text; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(review_text),UPDATE(review_text) ON TABLE public.location_reviews TO authenticated;


--
-- Name: COLUMN location_reviews.published_at; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(published_at),UPDATE(published_at) ON TABLE public.location_reviews TO authenticated;


--
-- Name: COLUMN location_reviews.relative_published; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(relative_published),UPDATE(relative_published) ON TABLE public.location_reviews TO authenticated;


--
-- Name: COLUMN location_reviews.google_maps_uri; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(google_maps_uri),UPDATE(google_maps_uri) ON TABLE public.location_reviews TO authenticated;


--
-- Name: COLUMN location_reviews.last_seen_at; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(last_seen_at),UPDATE(last_seen_at) ON TABLE public.location_reviews TO authenticated;


--
-- Name: COLUMN location_reviews.triage_status; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(triage_status) ON TABLE public.location_reviews TO authenticated;


--
-- Name: COLUMN location_reviews.triage_updated_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(triage_updated_at) ON TABLE public.location_reviews TO authenticated;


--
-- Name: COLUMN location_reviews.triage_updated_by; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(triage_updated_by) ON TABLE public.location_reviews TO authenticated;


--
-- Name: COLUMN location_reviews.operator_verdict; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(operator_verdict) ON TABLE public.location_reviews TO authenticated;


--
-- Name: COLUMN location_reviews.operator_verdict_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(operator_verdict_at) ON TABLE public.location_reviews TO authenticated;


--
-- Name: COLUMN location_reviews.draft_text; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(draft_text) ON TABLE public.location_reviews TO authenticated;


--
-- Name: COLUMN location_reviews.draft_generated_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(draft_generated_at) ON TABLE public.location_reviews TO authenticated;


--
-- Name: COLUMN location_reviews.updated_at; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(updated_at),UPDATE(updated_at) ON TABLE public.location_reviews TO authenticated;


--
-- Name: TABLE location_snapshots; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.location_snapshots TO anon;
GRANT ALL ON TABLE public.location_snapshots TO authenticated;
GRANT ALL ON TABLE public.location_snapshots TO service_role;


--
-- Name: TABLE location_weather; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.location_weather TO anon;
GRANT ALL ON TABLE public.location_weather TO authenticated;
GRANT ALL ON TABLE public.location_weather TO service_role;


--
-- Name: TABLE locations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.locations TO anon;
GRANT ALL ON TABLE public.locations TO authenticated;
GRANT ALL ON TABLE public.locations TO service_role;


--
-- Name: TABLE ops_brief_backup_20260717; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ops_brief_backup_20260717 TO anon;
GRANT ALL ON TABLE public.ops_brief_backup_20260717 TO authenticated;
GRANT ALL ON TABLE public.ops_brief_backup_20260717 TO service_role;


--
-- Name: TABLE ops_brief_backup_20260717b; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ops_brief_backup_20260717b TO anon;
GRANT ALL ON TABLE public.ops_brief_backup_20260717b TO authenticated;
GRANT ALL ON TABLE public.ops_brief_backup_20260717b TO service_role;


--
-- Name: TABLE organization_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.organization_members TO anon;
GRANT ALL ON TABLE public.organization_members TO authenticated;
GRANT ALL ON TABLE public.organization_members TO service_role;


--
-- Name: TABLE organizations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.organizations TO anon;
GRANT ALL ON TABLE public.organizations TO authenticated;
GRANT ALL ON TABLE public.organizations TO service_role;


--
-- Name: COLUMN organizations.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id) ON TABLE public.organizations TO marketing_ops;


--
-- Name: COLUMN organizations.name; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(name) ON TABLE public.organizations TO marketing_ops;


--
-- Name: COLUMN organizations.slug; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(slug) ON TABLE public.organizations TO marketing_ops;


--
-- Name: COLUMN organizations.subscription_tier; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(subscription_tier) ON TABLE public.organizations TO marketing_ops;


--
-- Name: COLUMN organizations.stripe_customer_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(stripe_customer_id) ON TABLE public.organizations TO marketing_ops;


--
-- Name: COLUMN organizations.stripe_subscription_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(stripe_subscription_id) ON TABLE public.organizations TO marketing_ops;


--
-- Name: COLUMN organizations.billing_email; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(billing_email) ON TABLE public.organizations TO marketing_ops;


--
-- Name: COLUMN organizations.created_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(created_at) ON TABLE public.organizations TO marketing_ops;


--
-- Name: COLUMN organizations.updated_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(updated_at) ON TABLE public.organizations TO marketing_ops;


--
-- Name: COLUMN organizations.trial_started_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(trial_started_at) ON TABLE public.organizations TO marketing_ops;


--
-- Name: COLUMN organizations.trial_ends_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(trial_ends_at) ON TABLE public.organizations TO marketing_ops;


--
-- Name: COLUMN organizations.industry_type; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(industry_type) ON TABLE public.organizations TO marketing_ops;


--
-- Name: TABLE partner_catalog; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.partner_catalog TO anon;
GRANT ALL ON TABLE public.partner_catalog TO authenticated;
GRANT ALL ON TABLE public.partner_catalog TO service_role;


--
-- Name: TABLE pipeline_runs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.pipeline_runs TO anon;
GRANT ALL ON TABLE public.pipeline_runs TO authenticated;
GRANT ALL ON TABLE public.pipeline_runs TO service_role;


--
-- Name: TABLE platform_admins; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.platform_admins TO anon;
GRANT ALL ON TABLE public.platform_admins TO authenticated;
GRANT ALL ON TABLE public.platform_admins TO service_role;


--
-- Name: TABLE play_actions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.play_actions TO anon;
GRANT ALL ON TABLE public.play_actions TO authenticated;
GRANT ALL ON TABLE public.play_actions TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: TABLE refresh_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.refresh_jobs TO anon;
GRANT ALL ON TABLE public.refresh_jobs TO authenticated;
GRANT ALL ON TABLE public.refresh_jobs TO service_role;


--
-- Name: TABLE skill_feedback_rollup; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.skill_feedback_rollup TO anon;
GRANT ALL ON TABLE public.skill_feedback_rollup TO authenticated;
GRANT ALL ON TABLE public.skill_feedback_rollup TO service_role;


--
-- Name: TABLE skill_knowledge; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.skill_knowledge TO anon;
GRANT ALL ON TABLE public.skill_knowledge TO authenticated;
GRANT ALL ON TABLE public.skill_knowledge TO service_role;


--
-- Name: TABLE skill_source_registry; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.skill_source_registry TO anon;
GRANT ALL ON TABLE public.skill_source_registry TO authenticated;
GRANT ALL ON TABLE public.skill_source_registry TO service_role;


--
-- Name: TABLE snapshots; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.snapshots TO anon;
GRANT ALL ON TABLE public.snapshots TO authenticated;
GRANT ALL ON TABLE public.snapshots TO service_role;


--
-- Name: TABLE social_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.social_profiles TO anon;
GRANT ALL ON TABLE public.social_profiles TO authenticated;
GRANT ALL ON TABLE public.social_profiles TO service_role;


--
-- Name: TABLE social_snapshots; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.social_snapshots TO anon;
GRANT ALL ON TABLE public.social_snapshots TO authenticated;
GRANT ALL ON TABLE public.social_snapshots TO service_role;


--
-- Name: TABLE stripe_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.stripe_events TO service_role;


--
-- Name: TABLE stripe_webhook_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.stripe_webhook_events TO anon;
GRANT ALL ON TABLE public.stripe_webhook_events TO authenticated;
GRANT ALL ON TABLE public.stripe_webhook_events TO service_role;


--
-- Name: TABLE tracked_keywords; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tracked_keywords TO anon;
GRANT ALL ON TABLE public.tracked_keywords TO authenticated;
GRANT ALL ON TABLE public.tracked_keywords TO service_role;


--
-- Name: TABLE trial_reminder_sends; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.trial_reminder_sends TO anon;
GRANT ALL ON TABLE public.trial_reminder_sends TO authenticated;
GRANT ALL ON TABLE public.trial_reminder_sends TO service_role;


--
-- Name: TABLE venue_catalog; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.venue_catalog TO anon;
GRANT ALL ON TABLE public.venue_catalog TO authenticated;
GRANT ALL ON TABLE public.venue_catalog TO service_role;


--
-- Name: TABLE venue_geocode_cache; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.venue_geocode_cache TO anon;
GRANT ALL ON TABLE public.venue_geocode_cache TO authenticated;
GRANT ALL ON TABLE public.venue_geocode_cache TO service_role;


--
-- Name: TABLE waitlist_signups; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.waitlist_signups TO anon;
GRANT ALL ON TABLE public.waitlist_signups TO authenticated;
GRANT ALL ON TABLE public.waitlist_signups TO service_role;
GRANT SELECT ON TABLE public.waitlist_signups TO marketing_ops;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: marketing; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: marketing; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: marketing; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- PostgreSQL database dump complete
--


