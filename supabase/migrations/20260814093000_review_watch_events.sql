-- Review watchdog (beta rescue phase 4.2). Ships with PR
-- feat/phase4-review-watchdog; NOT applied by that PR, promotion happens in a
-- reviewed batch.
--
-- One row per anomaly the watchdog fired for a location. Detection itself is pure
-- arithmetic over location_reviews (lib/reviews/watchdog.ts, zero model calls);
-- this table exists only so a finding is said ONCE.
--
-- THE DEDUPE, in two halves:
--   1. Same day: the primary key is (location_id, anomaly_key, fired_on) and the
--      insert happens before anything is surfaced, so a retried pipeline run
--      inside one day cannot double-record. Same idiom as trial_reminder_sends
--      and weekly_digest_sends.
--   2. While it persists: cooldown_until. An anomaly's cooldown is its own
--      observation window (a 30-day rating read stays quiet for 30 days), so the
--      watchdog can never report the same reviews twice. Rows still inside their
--      cooldown are ALSO exactly what the /reviews watch panel displays, which is
--      why one index serves both reads.
--
-- anomaly_key is the dedupe identity and carries the direction or category
-- ("rating_move:down", "review_velocity:up", "red_flag_cluster:illness"), so a
-- rating recovery is not silenced by an earlier rating drop.

CREATE TABLE public.review_watch_events (
    location_id uuid NOT NULL,
    anomaly_key text NOT NULL,
    kind text NOT NULL,
    direction text NOT NULL,
    -- |z| of the test that fired. AUDIT ONLY: never shown to an operator (the
    -- surface speaks in stars and counts). Kept so a threshold retune can be
    -- checked against what real locations actually produced.
    strength numeric NOT NULL,
    -- The numbers behind the finding (window, counts, means). The operator-facing
    -- line is rendered from these, so a row is self-contained: re-reading it never
    -- needs the review corpus as it stood that night.
    detail jsonb NOT NULL DEFAULT '{}'::jsonb,
    fired_on date NOT NULL,
    cooldown_until timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_watch_events_pkey PRIMARY KEY (location_id, anomaly_key, fired_on),
    CONSTRAINT review_watch_events_kind_chk CHECK (
        kind IN ('rating_move', 'review_velocity', 'red_flag_cluster')
    ),
    CONSTRAINT review_watch_events_direction_chk CHECK (direction IN ('up', 'down')),
    CONSTRAINT review_watch_events_location_id_fkey FOREIGN KEY (location_id)
        REFERENCES public.locations (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.review_watch_events IS
    'Review watchdog (phase 4.2): one row per fired anomaly. PK (location_id, anomaly_key, fired_on) dedupes same-day retries; cooldown_until suppresses a persisting anomaly for its own observation window. Written by lib/reviews/watch-events.ts from the nightly insights pipeline.';

COMMENT ON COLUMN public.review_watch_events.strength IS
    'Absolute test statistic (Welch z for rating moves, Anscombe Poisson z for velocity and clusters). Audit only, never rendered.';

-- Serves BOTH reads: the cooldown suppression set for the next run, and the
-- /reviews watch panel, which shows exactly the events still inside their window.
CREATE INDEX review_watch_events_active_idx
    ON public.review_watch_events (location_id, cooldown_until DESC);

-- RLS posture mirrors location_reviews: org members READ their own location's
-- events; there is deliberately no authenticated INSERT or UPDATE policy, because
-- these rows are engine-owned (written by the pipeline under the service role,
-- which bypasses RLS). An operator can never author or edit a finding about
-- themselves.
ALTER TABLE public.review_watch_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read review_watch_events" ON public.review_watch_events
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1
        FROM public.locations l
        JOIN public.organization_members m ON m.organization_id = l.organization_id
        WHERE l.id = review_watch_events.location_id
          AND m.user_id = auth.uid()
    ));

GRANT SELECT ON TABLE public.review_watch_events TO authenticated;
GRANT ALL ON TABLE public.review_watch_events TO service_role;
