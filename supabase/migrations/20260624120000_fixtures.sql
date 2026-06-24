-- Events Validation Gate P13 — authoritative scheduled-event fixtures (the league cross-check).
--
-- Why: the events engine mis-located + mis-dated a World Cup match because it trusted a SCRAPED
-- event title and geocoded the title text. The fix (lib/events/validate.ts) cross-checks any
-- scheduled-league listing against an AUTHORITATIVE schedule keyed by (competition, venue, local
-- date, kickoff). WC2026 is the first competition; this table generalizes the seed to NFL/NBA/
-- MLB/NHL/MLS/NCAA later WITHOUT a code change (the loader reads this table when present).
--
-- This table is PURE UPSIDE: the validator ships with an IN-CODE WC2026 seed
-- (lib/events/fixtures/wc2026.ts) and a FAIL-SOFT loader (lib/events/fixtures/loader.ts) that
-- reads this table when present + non-empty (and containing ≥1 venue row), else falls back to
-- the in-code seed. So PREVIEW works today with NO migration; running this on prod only ADDS the
-- ability to manage/extend fixtures as data instead of code.
--
-- Shape: a SINGLE flat table holding BOTH venue rows and match rows (the loader re-shapes them):
--   • a VENUE row has venue_id + place_name and NO local_date (carries aliases/coords/window).
--   • a MATCH  row has venue_id + local_date + local_kickoff (FK by venue_id, no hard constraint
--     so a match can be loaded before its venue row in any order).

create table if not exists fixtures (
  id uuid primary key default gen_random_uuid(),
  competition_id text not null,               -- e.g. 'fifa-world-cup-2026'
  venue_id text not null,                     -- stable venue identity (kebab of the physical name)
  -- ── venue-row columns (null on match rows) ──
  place_name text,                            -- physical/official stadium name (KNOWN_ALIASES key)
  city text,
  aliases text[] not null default '{}',       -- FIFA event-time aliases, e.g. {"Dallas Stadium"}
  lat double precision,
  lng double precision,
  tz text,                                    -- local timezone label (informational)
  window_start date,                          -- competition window (lets knockouts resolve a venue)
  window_end date,
  -- ── match-row columns (null on venue rows) ──
  local_date date,                            -- LOCAL calendar date at the venue
  local_kickoff text,                         -- LOCAL kickoff, 24h HH:MM
  round text,                                 -- 'group' | 'r32' | 'r16' | 'qf' | 'sf' | 'third' | 'final'
  label text,                                 -- provenance only (e.g. "England vs Croatia") — NEVER customer copy
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Lookups the loader/validator perform: by venue name/alias, and by (venue, local date).
create index if not exists idx_fixtures_competition on fixtures(competition_id);
create index if not exists idx_fixtures_venue on fixtures(venue_id);
create index if not exists idx_fixtures_venue_date on fixtures(venue_id, local_date);

-- Dedupe guards (additive, partial uniques): one venue row per (competition, venue); one match
-- row per (competition, venue, local_date, local_kickoff).
create unique index if not exists uq_fixtures_venue_row
  on fixtures(competition_id, venue_id)
  where local_date is null;
create unique index if not exists uq_fixtures_match_row
  on fixtures(competition_id, venue_id, local_date, local_kickoff)
  where local_date is not null;

-- Reference data, not tenant data: readable by any authenticated user; writes are service-role
-- only (the loader reads via the service role, which bypasses RLS anyway). Mirrors the venue_catalog
-- RLS-on + read-policy posture, but global (no location scoping — fixtures are shared facts).
alter table fixtures enable row level security;

create policy "authenticated can read fixtures"
  on fixtures for select
  using (auth.role() = 'authenticated');

-- ── In-code WC2026 seed is the source of truth until/unless this table is populated. To promote
-- the in-code seed into this table, generate inserts from lib/events/fixtures/wc2026.ts. Example
-- venue + match row shape (left commented — the in-code seed already covers WC2026 on preview):
--
--   insert into fixtures (competition_id, venue_id, place_name, city, aliases, lat, lng, tz, window_start, window_end)
--   values ('fifa-world-cup-2026','att-stadium','AT&T Stadium','Dallas','{"Dallas Stadium"}',32.7473,-97.0945,'America/Chicago','2026-06-11','2026-07-19');
--   insert into fixtures (competition_id, venue_id, local_date, local_kickoff, round, label)
--   values ('fifa-world-cup-2026','att-stadium','2026-06-17','15:00','group','England vs Croatia');
