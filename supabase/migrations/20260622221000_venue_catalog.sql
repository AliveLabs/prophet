-- Events Impact Engine P1 — per-location marquee-venue catalog (the detection spine).
--
-- Why: the events pipeline only ever queried the generic keyword "events", and Google Events
-- ranks that feed toward local club/music listings — burying stadium mega-events below the
-- depth-10 cutoff (live-proven: the World Cup match a block from a Raising Cane's never appeared
-- under "events", but did under "world cup"/"AT&T Stadium"). The fix is to know the demand-driving
-- venues NEAR each restaurant and probe DataForSEO by their names. This catalog is built once at
-- onboarding (Places searchNearby over a venue-type taxonomy) + refreshed quarterly (venues are
-- static), with best-effort capacity priors used downstream to estimate attendance.

create table if not exists venue_catalog (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  place_id text,                              -- Google Places id (stable identity, dedup)
  name text not null,
  primary_type text,                          -- Places primaryType, e.g. "stadium"
  lat double precision,
  lng double precision,
  distance_mi double precision,               -- straight-line miles from the restaurant
  capacity_low integer,                        -- best-effort attendance prior (LOW end of range)
  capacity_high integer,
  capacity_confidence text not null default 'prior',  -- 'measured' (Wikidata/OSM) | 'prior' (type default)
  aliases text[] not null default '{}',        -- e.g. ["Dallas Stadium"] for FIFA-rebranded "AT&T Stadium"
  created_at timestamptz not null default now(),
  refreshed_at timestamptz not null default now(),
  unique (location_id, place_id)
);

create index if not exists idx_venue_catalog_location
  on venue_catalog(location_id, distance_mi);

-- Pipeline-only table (built by the service-role cron/onboarding path). RLS on + read policy for
-- org members so the dashboard can show "venues we watch near you"; writes are service-role only.
alter table venue_catalog enable row level security;

create policy "org members can read venue_catalog"
  on venue_catalog for select
  using (exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = venue_catalog.location_id and m.user_id = auth.uid()
  ));
