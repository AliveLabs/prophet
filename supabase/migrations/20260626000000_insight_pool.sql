-- Insight pool (overnight 2026-06-26 · #1/#2)
-- Today the daily brief OVERWRITES the insight set each run (daily_briefs upsert on
-- (location_id, date_key); only the latest is read). Bryan wants insights to accumulate in a
-- POOL kept over time: ~5-7 "top" insights surface and push older ones out of top, but every
-- insight stays available via a "see all insights" view, filterable by type (category).
--
-- This table is ADDITIVE + fail-soft (read path returns [] pre-types-regen, like evergreen_*).
-- One row per (location, play_key); is_top is a recomputed cache of the current top set.
-- The unique key is NON-partial + both NOT NULL so it is a valid supabase-js onConflict target
-- (see the partial-index/onConflict 42P10 gotcha that silently no-op'd spine upserts).

create table if not exists public.insight_pool_entries (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  play_key text not null,                       -- stableKey, else skillId+title-slug (dedup handle)
  play jsonb not null,                          -- the EnrichedRecommendation snapshot
  first_seen_date text not null,                -- YYYY-MM-DD this play_key first entered the pool
  last_seen_date text not null,                 -- YYYY-MM-DD of the most recent brief that contained it
  combined_score numeric not null default 0,    -- latest synthesis score (pool ranking)
  category text,                                -- play.category — the filter axis
  kind text,                                    -- play.kind — secondary axis
  confidence text,                              -- play.confidence
  is_top boolean not null default false,        -- in the current top-N surface (recomputed each run)
  expires_at timestamptz not null,              -- retention: drop entries unseen for N days
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, play_key)
);

create index if not exists idx_insight_pool_location_top
  on public.insight_pool_entries (location_id, is_top desc, combined_score desc);
create index if not exists idx_insight_pool_location_category
  on public.insight_pool_entries (location_id, category, last_seen_date desc);
create index if not exists idx_insight_pool_expires
  on public.insight_pool_entries (expires_at);

alter table public.insight_pool_entries enable row level security;

-- Org members can read their location's pool (mirrors evergreen_plays RLS). Writes are
-- service-role only (the build-brief / worker path bypasses RLS).
drop policy if exists "org members read insight_pool_entries" on public.insight_pool_entries;
create policy "org members read insight_pool_entries"
  on public.insight_pool_entries for select
  using (exists (
    select 1
    from public.locations l
    join public.organization_members m on m.organization_id = l.organization_id
    where l.id = insight_pool_entries.location_id
      and m.user_id = auth.uid()
  ));
