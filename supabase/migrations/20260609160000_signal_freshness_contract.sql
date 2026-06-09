-- Spine rewrite · Phase 1 — the data-integrity contract (additive, leads-safe).
--
-- Root defect: snapshots are stamped captured_at = now regardless of how old their
-- CONTENT is, so a social account dark since 2022 is presented as current activity.
-- Fix: store the real recency of the content (content_as_of) separately from when we
-- fetched (captured_at), plus a write-time freshness classification, on every snapshot
-- table. Plus a pipeline_runs table for honest run outcomes (not just "completed").
--
-- All changes are additive: old code ignores the new columns/table. Existing rows get
-- content_as_of = null / freshness = 'undated' until backfilled (Phase 5/6).

-- ── content_as_of + freshness on the three snapshot tables ──
alter table social_snapshots   add column if not exists content_as_of timestamptz;
alter table snapshots          add column if not exists content_as_of timestamptz;
alter table location_snapshots add column if not exists content_as_of timestamptz;

-- freshness ∈ fresh | aging | dormant | empty | undated  (undated = not yet classified)
alter table social_snapshots   add column if not exists freshness text not null default 'undated'
  check (freshness in ('fresh','aging','dormant','empty','undated'));
alter table snapshots          add column if not exists freshness text not null default 'undated'
  check (freshness in ('fresh','aging','dormant','empty','undated'));
alter table location_snapshots add column if not exists freshness text not null default 'undated'
  check (freshness in ('fresh','aging','dormant','empty','undated'));

-- Partial indexes so the dossier can cheaply find usable (non-dormant/empty) rows.
create index if not exists idx_social_snapshots_freshness   on social_snapshots(social_profile_id, content_as_of desc) where freshness in ('fresh','aging');
create index if not exists idx_snapshots_freshness          on snapshots(competitor_id, content_as_of desc)         where freshness in ('fresh','aging');
create index if not exists idx_location_snapshots_freshness on location_snapshots(location_id, provider, content_as_of desc) where freshness in ('fresh','aging');

-- ── pipeline_runs: honest run outcomes + reasons (observability) ──
-- One row per (run, location, pipeline). outcome captures WHAT happened to the data,
-- not just whether the call returned. signals carries a per-signal freshness summary.
create table if not exists pipeline_runs (
  id            uuid        primary key default gen_random_uuid(),
  run_id        uuid        not null,                    -- groups one orchestrator pass
  location_id   uuid        not null references locations(id) on delete cascade,
  competitor_id uuid        references competitors(id) on delete cascade,
  pipeline      text        not null,                    -- social | content | events | visibility | weather | traffic | insights | refresh_all
  outcome       text        not null
                  check (outcome in ('fresh','served_stale','dormant','no_data','partial','failed','skipped')),
  reason        text,                                    -- human-readable ("Data365 newest post 2022-01-07 → dormant")
  signals       jsonb       not null default '{}'::jsonb,-- { social: 'dormant', events: 'fresh', ... }
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists idx_pipeline_runs_location on pipeline_runs(location_id, created_at desc);
create index if not exists idx_pipeline_runs_run       on pipeline_runs(run_id);

alter table pipeline_runs enable row level security;

-- Read: org members can see their location's run history (mirrors the insights/brief policy).
create policy "org members can read pipeline_runs"
on pipeline_runs for select
using (
  exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = pipeline_runs.location_id and m.user_id = auth.uid()
  )
);
-- Writes are service_role only (bypasses RLS) — same as the snapshot/insight pipelines.
