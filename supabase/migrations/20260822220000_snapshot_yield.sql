-- ALT-571 Tier 1: fleet-wide zero-yield detection.
--
-- WHY A DB FUNCTION. Everything that watches pipeline health today reads `pipeline_runs.outcome`,
-- which answers "did the call error?" and nothing else. The 2026-08-05 events blackout returned a
-- clean, well-formed EMPTY for five days: every run logged outcome "fresh", failed 0, and no
-- alerter fired because none of them ever looked at whether a snapshot actually carried data.
--
-- This aggregate counts POPULATED SNAPSHOTS AT THE SOURCE. That separation is the whole point: a
-- health metric must not derive from the same predicate as the behaviour it measures, or a broken
-- predicate reports healthy. `location_snapshots.raw_data` is the artefact the product actually
-- reads, so counting it cannot be fooled by a run that reported success.
--
-- Aggregating in SQL rather than in the cron is not premature optimisation. `seo_serp_keywords`
-- rows carry hundreds of entries each; pulling raw_data for every provider over an 8-day window
-- would ship tens of megabytes to compute two integers per day, and it would get worse with every
-- location added. This returns four small columns per (provider, day).
--
-- The per-provider "what counts as populated" config lives in TypeScript (lib/jobs/zero-yield.ts)
-- and is passed in as jsonb, so there is ONE definition of it rather than one here and one there
-- drifting apart.
create or replace function public.snapshot_yield(p_config jsonb, p_since date)
returns table (provider text, date_key date, snapshots bigint, populated bigint)
language sql
stable
set search_path = public
as $$
  with cfg as (
    select
      c ->> 'provider' as provider,
      c ->> 'path'     as path,
      c ->> 'kind'     as kind
    from jsonb_array_elements(p_config) c
  )
  select
    ls.provider,
    ls.date_key,
    count(*)::bigint as snapshots,
    count(*) filter (
      where case cfg.kind
        -- An array path is populated when it IS an array and holds at least one element. The
        -- typeof check matters: a provider that changes shape must read as NOT populated rather
        -- than erroring the whole aggregate and blinding the alert.
        when 'array' then
          jsonb_typeof(ls.raw_data -> cfg.path) = 'array'
          and jsonb_array_length(ls.raw_data -> cfg.path) > 0
        -- An object/scalar path is populated when it is present and not JSON null. `-> 'k'`
        -- returns SQL NULL for a missing key and jsonb 'null' for an explicit null, and those are
        -- different values that both mean "no data here".
        else
          ls.raw_data -> cfg.path is not null
          and jsonb_typeof(ls.raw_data -> cfg.path) <> 'null'
      end
    )::bigint as populated
  from public.location_snapshots ls
  join cfg on cfg.provider = ls.provider
  where ls.date_key >= p_since
  group by ls.provider, ls.date_key
$$;

-- This project's DEFAULT PRIVILEGES hand EXECUTE on new functions to PUBLIC, so the REVOKE is not
-- decoration: without it `anon` could call this and enumerate per-provider fleet volumes. Same
-- trap documented at length in 20260821180000_review_watch_events_tighten_grants.sql. The only
-- caller is the vendor-health cron, which runs under the service role.
revoke all on function public.snapshot_yield(jsonb, date) from public;
grant all on function public.snapshot_yield(jsonb, date) to service_role;
