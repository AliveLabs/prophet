-- Org access requests: duplicate-org prevention at signup (beta rescue phase 3.5,
-- pairs with ALT-576's admin merge tool, which is the cleanup half).
--
-- When a new signup picks a place (locations.primary_place_id) that a live org already
-- owns, the signup no longer creates a second org. Instead it records a request here and
-- notifies the existing org owner; a daily cron (app/api/cron/access-requests) nudges the
-- owner, escalates to us, marks the request granted once the requester shows up in
-- organization_members, and expires stale rows. State rules live in
-- lib/onboarding/access-request.ts.
--
-- kind:
--   'request_access' -> collision with a live CUSTOMER org; the pending/nudged/escalated
--                       lifecycle applies.
--   'demo_contact'   -> collision with a demo/test org (a sales signal: someone real wants
--                       a location we showcase). Created directly as 'escalated' (it is
--                       ours to act on from the start); only 'granted' applies afterwards.

CREATE TABLE public.org_access_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    requester_user_id uuid NOT NULL,
    requester_email text,
    requester_name text,
    place_id text NOT NULL,
    kind text DEFAULT 'request_access' NOT NULL,
    status text DEFAULT 'pending' NOT NULL,
    contact_info text,
    message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    nudged_at timestamp with time zone,
    escalated_at timestamp with time zone,
    resolved_at timestamp with time zone,
    CONSTRAINT org_access_requests_pkey PRIMARY KEY (id),
    CONSTRAINT org_access_requests_kind_chk CHECK (kind IN ('request_access', 'demo_contact')),
    CONSTRAINT org_access_requests_status_chk CHECK (
        status IN ('pending', 'nudged', 'escalated', 'granted', 'expired')
    ),
    CONSTRAINT org_access_requests_organization_id_fkey FOREIGN KEY (organization_id)
        REFERENCES public.organizations (id) ON DELETE CASCADE
);

-- One OPEN request per requester per org per kind. Partial unique index, NOT an upsert
-- target (PostgREST onConflict cannot address a partial index; writers select-then-insert).
CREATE UNIQUE INDEX org_access_requests_one_open
    ON public.org_access_requests (organization_id, requester_user_id, kind)
    WHERE status IN ('pending', 'nudged', 'escalated');

-- The daily cron scans open rows; the team page reads per-org.
CREATE INDEX org_access_requests_status_idx
    ON public.org_access_requests (status)
    WHERE status IN ('pending', 'nudged', 'escalated');
CREATE INDEX org_access_requests_org_idx
    ON public.org_access_requests (organization_id);

-- RLS posture mirrors beta_feedback: RLS on, narrow authenticated SELECTs, all writes via
-- the service role (server actions / cron). The requester is NOT a member of the org
-- (that is the whole point), so there is deliberately no authenticated INSERT policy.
ALTER TABLE public.org_access_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_access_requests_select_own ON public.org_access_requests
    FOR SELECT TO authenticated
    USING (requester_user_id = auth.uid());

CREATE POLICY org_access_requests_select_managers ON public.org_access_requests
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1
        FROM public.organization_members m
        WHERE m.organization_id = org_access_requests.organization_id
          AND m.user_id = auth.uid()
          AND m.role IN ('owner', 'admin')
    ));
