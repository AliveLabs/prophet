-- Events Impact Engine P0 — persistent venue geocode cache.
--
-- Why: lib/events/geo.ts cached geocodes in a per-PROCESS Map. On Vercel serverless that map is
-- cold on most invocations, so every event re-geocodes its venue via the PAID Places searchText
-- endpoint. Expanding event keywords (P1) returns MORE events, multiplying that bill. This table
-- makes a venue geocode a one-time cost: venues repeat week to week, so a hit is free forever.
-- Successful resolutions only are persisted (a transient null is not poisoned permanently).

create table if not exists venue_geocode_cache (
  query_key text primary key,              -- lower(trim("<name>, <address>"))
  lat double precision not null,
  lng double precision not null,
  resolved_at timestamptz not null default now()
);

-- Locked down: only the service role (brief/cron path) reads/writes this. RLS on + no policies =
-- no anon/auth access; the service role bypasses RLS. Mirrors the other pipeline-only tables.
alter table venue_geocode_cache enable row level security;
