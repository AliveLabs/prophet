-- menu_ingest_events: add the "degraded" outcome and the coverage columns behind it.
--
-- The original taxonomy (20260812150000) had three outcomes: succeeded, empty, failed. It has
-- no way to say the thing menu reliability actually fails on: the run DID return a menu, it
-- DID save, and it is badly incomplete. Measured in prod 2026-08-14, one location's 21 weekly
-- reads of the same unchanged menu ran 12, 30, 49, 49, 54, 62, 69, 70, 71, 81, 81, 89, 96, 98,
-- 104, 112, 135, 137, 147, 149, 169 items. Under the old taxonomy the 12-item read recorded as
-- "succeeded", identical to the 137-item one.
--
-- 'degraded' is deliberately NOT folded into 'failed': a run that produced no answer and a run
-- that produced a confidently wrong answer need different fixes, and only the second one
-- reaches the customer as a claim.
--
-- coverage_ratio / historical_high_items are promoted out of the `stages` jsonb into columns
-- so the reliability rollup can filter and average without unpacking jsonb. Both are NULLABLE
-- and null means NO VERDICT (a new or thinly-sampled target), never "coverage was fine":
-- same polarity as parseMeta.coverageRatio being absent rather than 1.
--
-- Safe to apply to the live table: verified 2026-08-14, the table exists in prod and holds
-- ZERO rows (the content job runs Sundays and the recorder landed after the last one), the
-- constraint is only widened, and both new columns are nullable.
--
-- DEPLOY ORDER: apply this BEFORE (or with) the code that emits 'degraded'. The recorder
-- swallows insert errors by design, so running the new code against the old constraint loses
-- degraded events silently instead of erroring.

alter table public.menu_ingest_events
  drop constraint if exists menu_ingest_events_outcome_check;

alter table public.menu_ingest_events
  add constraint menu_ingest_events_outcome_check
  check (outcome = any (array['succeeded'::text, 'degraded'::text, 'empty'::text, 'failed'::text]));

alter table public.menu_ingest_events
  add column if not exists coverage_ratio numeric null,
  add column if not exists historical_high_items integer null;

-- Rollups are "how bad was last week", so they scan by outcome over a trailing window.
create index if not exists menu_ingest_events_degraded_idx
  on public.menu_ingest_events (created_at)
  where outcome = 'degraded';

comment on column public.menu_ingest_events.outcome is
  'succeeded | degraded (a menu was saved but holds < 85% of this menu''s best known item count) | empty (looked, found no menu) | failed (no trustworthy answer).';

comment on column public.menu_ingest_events.coverage_ratio is
  'items_total / historical_high_items for this run, from menuCoverage() in lib/content/menu-parse.ts. NULL means no verdict was available (too little history), never good coverage.';

comment on column public.menu_ingest_events.historical_high_items is
  'Best item count credibly read for this same menu before this run (high outliers excluded). Denominator of coverage_ratio.';
