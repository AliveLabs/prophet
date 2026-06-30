-- ALT-210 data layer — carry the venue's official website on the geocode cache.
--
-- lib/events/geo.ts now resolves the geocoded venue's Google Place `websiteUri` on the SAME
-- paid searchText call it already makes to geocode each event venue. The events page deep-link
-- picker (pickEventDeepLink) prefers this real venue URL over a generic bureau/convention-center
-- landing page when the scrape carried nothing event-specific. Caching it here makes the website
-- a one-time cost per venue (same economics as the geocode itself).
--
-- Nullable + fail-soft: rows written before this column existed keep a null website until they
-- are backfilled (annotateEventsGeo backfills a few of the nearest venues per run).

alter table venue_geocode_cache add column if not exists website text;
