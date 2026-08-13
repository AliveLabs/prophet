-- menu_ingest_events: per-attempt menu ingestion reliability telemetry (beta rescue 2.6,
-- ALT-363).
--
-- Menu data is the product's known weak spot (MENU_INSIGHTS is default-off because menu
-- insights were unreliable). Before any menu rehab we need to know WHERE the pipeline fails
-- and how often — and today a run that produces nothing writes NO row anywhere (the snapshot
-- upsert only happens when items were found), so failure volume is invisible. This table is
-- that missing ledger: one row per menu-ingestion attempt (per location or competitor, per
-- run), with the outcome and a failure classification.
--
-- Written via lib/content/menu-telemetry.ts#recordMenuIngestEvent: a fire-and-forget insert
-- (never throws, never blocks the caller, observation only — mirrors lib/ai/spend-events.ts).
-- Read by /admin/health for a "Menu ingestion reliability (7d)" rollup.
--
-- A NEW TABLE rather than a jsonb spot on an existing row, deliberately: the existing menu
-- telemetry home (MenuSnapshot.parseMeta inside snapshots/location_snapshots.raw_data) only
-- exists when a snapshot was SAVED, which is exactly the case we can already see. The failure
-- cases produce no snapshot row to hang telemetry on.
--
-- RLS ENABLED, NO POLICIES: service-role-only ledger, same posture as ai_spend_events (no
-- policy = no row visible to anon/authenticated; service_role bypasses RLS). No end user or
-- org-scoped surface reads this table directly.

create table if not exists public.menu_ingest_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone not null default now(),
  -- Which code path ran the ingestion: 'content_pipeline' (background content job) |
  -- 'content_refresh_action' (manual /content refresh) | 'competitor_enrich' (competitor
  -- approve / single-competitor refresh). Deliberately NOT CHECK-constrained (mirrors
  -- ai_spend_events.surface): new sources get added without a migration.
  run_source text not null,
  -- 'location' (the org's own menu) or 'competitor'.
  target text not null,
  -- Nullable + on delete set null: telemetry must survive its subject being deleted.
  location_id uuid null references public.locations(id) on delete set null,
  competitor_id uuid null references public.competitors(id) on delete set null,
  -- The run's YYYY-MM-DD key, same key the snapshot upserts use, so an event can be joined
  -- back to the snapshot it did (or did not) produce.
  date_key text not null,
  -- 'succeeded' | 'empty' (looked, found no menu) | 'failed' (could not get an answer).
  outcome text not null,
  -- Classification from lib/content/menu-telemetry.ts (null on success): 'no_website' |
  -- 'fetch_failed' | 'parse_empty' | 'enrichment_failed' | 'zero_items' | 'save_failed' |
  -- 'pipeline_error'. Not CHECK-constrained so the taxonomy can grow without a migration.
  failure_reason text null,
  items_total integer not null default 0,
  -- Sources that contributed items (e.g. ["firecrawl","gemini_google_search"]).
  sources jsonb not null default '[]'::jsonb,
  -- The raw MenuStageObservation (scrape attempt/error counts, channel statuses, error
  -- messages) so a reason can be re-derived or re-classified later.
  stages jsonb not null default '{}'::jsonb,
  constraint menu_ingest_events_outcome_check check (outcome = any (array['succeeded'::text, 'empty'::text, 'failed'::text])),
  constraint menu_ingest_events_target_check check (target = any (array['location'::text, 'competitor'::text]))
);

create index if not exists menu_ingest_events_created_at_idx on public.menu_ingest_events (created_at);
create index if not exists menu_ingest_events_outcome_created_at_idx on public.menu_ingest_events (outcome, created_at);
create index if not exists menu_ingest_events_location_idx on public.menu_ingest_events (location_id, created_at);

alter table public.menu_ingest_events enable row level security;

comment on table public.menu_ingest_events is
  'Menu ingestion reliability telemetry (beta rescue 2.6, ALT-363): one row per menu-ingestion attempt (per location/competitor, per run), including the runs that produced nothing and therefore left no snapshot. Written by lib/content/menu-telemetry.ts#recordMenuIngestEvent, service-role only (RLS enabled, no policies). Observation only: recording never alters pipeline behaviour.';
