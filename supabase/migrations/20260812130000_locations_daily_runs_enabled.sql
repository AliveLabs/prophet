-- locations.daily_runs_enabled: per-location on/off switch for the daily machine.
--
-- Demo orgs (and any other location someone wants paused) previously had one lever: delete
-- the org. That's destructive and loses the account. This is a non-destructive pause: when
-- false, the daily cron (/api/cron/daily) stops enqueueing data-pull pipelines for the
-- location, and the brief cron (/api/cron/build-brief) stops enqueueing/building briefs for
-- it. Both crons cost real per-call spend (DataForSEO, Anthropic), so a paused demo location
-- actually stops costing money instead of just going stale.
--
-- Defaults true so every existing location keeps running with zero behavior change on
-- migrate. An explicit ?location_id= request to either cron overrides the flag (a named,
-- deliberate ops/admin action beats the nightly sweep's own opinion). See
-- lib/jobs/build-schedule.ts#shouldRunDailyForLocation.

alter table public.locations
  add column if not exists daily_runs_enabled boolean not null default true;

comment on column public.locations.daily_runs_enabled is
  'Per-location on/off switch for the daily machine (data-pull cron + brief cron). false pauses both without deleting the location/org. Defaults true. An explicit ?location_id= single-location cron request overrides this flag.';
