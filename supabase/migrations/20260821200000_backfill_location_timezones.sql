-- ALT-739 one-time backfill. APPLIED TO PROD 2026-08-21; recorded here so a fresh environment
-- reaches the same state. Verified after: all 5 rows corrected, 0 still Eastern.
--
-- Every locations row said America/New_York and not one was Eastern, because both onboarding
-- insert paths hardcoded it. The code fix is lib/geo/us-timezone.ts; this corrects rows already
-- written.
--
-- Deliberately NOT a general re-implementation of the resolver in SQL: that would be a second copy
-- of an ongoing rule that has to agree with the TypeScript one, which is the drift pattern this
-- audit keeps finding. Narrow, one-time, over the states actually present, and it only touches rows
-- still claiming Eastern so it cannot clobber a zone somebody set on purpose.
update public.locations l
set timezone = case
      when lower(l.region) in ('california')            then 'America/Los_Angeles'
      when lower(l.region) in ('missouri')              then 'America/Chicago'
      -- Texas is Central except El Paso and Hudspeth counties in the far west.
      when lower(l.region) = 'texas' and l.geo_lng < -105.0 then 'America/Denver'
      when lower(l.region) = 'texas'                    then 'America/Chicago'
      else l.timezone
    end,
    updated_at = now()
where l.timezone = 'America/New_York'
  and lower(l.region) in ('california', 'missouri', 'texas');
