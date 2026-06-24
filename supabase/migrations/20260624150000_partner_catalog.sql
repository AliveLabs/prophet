-- Grassroots Growth P16 §4.1 — per-location partner-entity catalog (the grassroots anchor set).
--
-- Why: the grassroots/guerrilla skill could only emit generic advice ("partner with local
-- businesses") because it had no DATA about WHICH non-competitor entities are actually nearby. This
-- catalog is the sibling of venue_catalog: where venue_catalog sweeps DEMAND venues (stadiums/arenas
-- that drive foot traffic), partner_catalog sweeps the nearby NON-competitor entities whose AUDIENCE
-- a restaurant can borrow — schools/PTA, youth-sports, churches/boosters, gyms, offices/coworking,
-- hospitals, hotels, dealerships, theaters, breweries, bakeries, farmers-markets — each tagged by
-- partner_type with distance + a COARSE audience-size proxy (enrollment band / staff headcount /
-- venue capacity). The upgraded skill turns these into partner-named playbooks (spirit nights,
-- catering drivers, reciprocal cross-promos).
--
-- This table is PURE UPSIDE + FAIL-SOFT: the dossier read (lib/local/partner-catalog.ts
-- loadPartnerCatalog) swallows a missing-table error and returns [], so PREVIEW works today with NO
-- migration — the grassroots entity-grounded archetypes simply don't fire and the skill stays on its
-- number-free fallback (today's behavior). Running this on prod only ADDS the catalog; once the events
-- pipeline (ensurePartnerCatalog) populates it on its next run, the entity-grounded archetypes light up.
--
-- Built ONCE per location by the events pipeline (Places searchNearby over the partner-type taxonomy)
-- + refreshed quarterly (partners are static), exactly like venue_catalog. NEVER run against prod from
-- the agent shell — Bryan applies this against triodvdspdsuudooyura via scripts/db/sql.mts.

create table if not exists partner_catalog (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  place_id text,                              -- Google Places id (stable identity, dedup)
  name text not null,
  partner_type text not null,                 -- taxonomy: school|youth_sports|church|gym|office|hospital|hotel|dealership|theater|brewery|bakery|farmers_market
  primary_type text,                          -- raw Places primaryType (provenance), e.g. "primary_school"
  lat double precision,
  lng double precision,
  distance_mi double precision,               -- straight-line miles from the restaurant
  size_proxy_low integer,                     -- LOW anchor of the coarse audience-size proxy (NEVER asserted as a true count)
  size_proxy_high integer,
  size_band text not null default 'medium',   -- ordinal: 'small' | 'medium' | 'large' (what the economics scale on)
  size_confidence text not null default 'prior',  -- 'measured' (rare) | 'prior' (type default)
  size_proxy_kind text,                       -- what the proxy measures: 'enrollment band' | 'staff headcount' | 'rooms' | ...
  created_at timestamptz not null default now(),
  refreshed_at timestamptz not null default now(),
  unique (location_id, place_id)
);

create index if not exists idx_partner_catalog_location
  on partner_catalog(location_id, distance_mi);
-- The grassroots skill selects partners BY type per archetype (school → spirit_night, office → catering).
create index if not exists idx_partner_catalog_location_type
  on partner_catalog(location_id, partner_type);

-- Pipeline-only table (built by the service-role events cron). RLS on + read policy for org members
-- so the dashboard can show "partners near you"; writes are service-role only. Mirrors venue_catalog.
alter table partner_catalog enable row level security;

create policy "org members can read partner_catalog"
  on partner_catalog for select
  using (exists (
    select 1 from locations l
    join organization_members m on m.organization_id = l.organization_id
    where l.id = partner_catalog.location_id and m.user_id = auth.uid()
  ));
