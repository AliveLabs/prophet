-- Events Impact Engine P2 — inputs for the per-restaurant impact model.
--
-- Two cheap, cached signals that let us decide whether a detected event MATTERS to a
-- specific restaurant (vs. flooding every brief with metro noise):
--   1. location_density — local market density tier, which calibrates the surface bars
--      (a rural diner surfaces the lone HS game; a dense-urban spot needs a mega-event).
--   2. location_busy_times — the restaurant's OWN popular-times curve (the denominator of
--      the relative-lift door). Competitors' curves were already stored in busy_times, but
--      the location's own curve was only ever fetched live in the dossier. Cached here with
--      a weekly refresh so the events pipeline reads it without a per-run Outscraper call.

create table if not exists location_density (
  location_id uuid primary key references locations(id) on delete cascade,
  tier text not null default 'suburban',     -- rural | suburban | urban | dense_urban
  residential_density double precision,        -- people / sq mi (Census ACS, when available)
  commercial_proxy integer,                     -- nearby competitor count (universal fallback)
  source text not null default 'default',       -- 'census' | 'competitor_proxy' | 'default'
  refreshed_at timestamptz not null default now()
);

create table if not exists location_busy_times (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  day_of_week integer not null check (day_of_week >= 0 and day_of_week <= 6),
  hourly_scores integer[] not null,             -- 0..100 per hour (Google popular-times scale)
  peak_hour integer,
  peak_score integer,
  slow_hours integer[],
  current_popularity integer,
  refreshed_at timestamptz not null default now(),
  unique (location_id, day_of_week)
);

create index if not exists idx_location_busy_times_location on location_busy_times(location_id);

-- Pipeline-only writes (service role). Org members may read for transparency in the dashboard.
alter table location_density enable row level security;
alter table location_busy_times enable row level security;

create policy "org members can read location_density"
  on location_density for select
  using (exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = location_density.location_id and m.user_id = auth.uid()
  ));

create policy "org members can read location_busy_times"
  on location_busy_times for select
  using (exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = location_busy_times.location_id and m.user_id = auth.uid()
  ));
