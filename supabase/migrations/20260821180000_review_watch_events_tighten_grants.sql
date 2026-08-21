-- Applied to prod 2026-08-21, immediately after 20260814093000_review_watch_events.sql (ALT-703).
--
-- WHY THIS EXISTS. That migration granted only SELECT to `authenticated`, and its comment states
-- the posture plainly: these rows are engine-owned, written by the pipeline under the service
-- role, and "an operator can never author or edit a finding about themselves".
--
-- The applied table did not match. This project's DEFAULT PRIVILEGES grant ALL on new public
-- tables to `anon` and `authenticated`, so review_watch_events came out of that migration with
-- INSERT, UPDATE, DELETE and TRUNCATE for both roles. A migration's GRANT lines describe what it
-- ADDS, never the privileges the table ends up with.
--
-- RLS was already denying the writes (the table has exactly one policy, a SELECT policy), so
-- nothing was exploitable through PostgREST. Two reasons to fix it anyway:
--
--   1. TRUNCATE is NOT subject to RLS. A role holding TRUNCATE can empty the table whatever the
--      policies say. `anon` and `authenticated` both held it.
--   2. RLS was the ONLY barrier. Disabling RLS on the table, or adding one permissive policy,
--      would have silently made operator-authored findings possible.
--
-- Verified after applying: authenticated = SELECT, anon = (none), service_role = ALL.
--
-- ⚠️ THIS IS NOT SPECIFIC TO THIS TABLE. 56 public tables carry the same loose write grants, and
-- on 27 of them RLS is the sole barrier because they have zero write policies. `location_reviews`
-- is the only table where someone narrowed them. That is a schema-wide posture decision, tracked
-- separately, and deliberately NOT swept here: revoking across 56 tables needs its own change
-- with its own testing, not a side effect of promoting one table.
REVOKE ALL ON TABLE public.review_watch_events FROM anon;
REVOKE ALL ON TABLE public.review_watch_events FROM authenticated;
GRANT SELECT ON TABLE public.review_watch_events TO authenticated;
