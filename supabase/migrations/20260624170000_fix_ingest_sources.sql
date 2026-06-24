-- Learning Spine — PIPELINE 1 source-registry FIX (2026-06-24).
--
-- A live dry-run + content inspection found 5 of 15 enabled sources were broken:
--   • NRA What's Hot           — 404 (NRA restructured /economists-notebook/ → /research-reports/)
--   • NRA Menu Prices          — 404 (NRA moved /economists-notebook/ → /restaurant-economic-insights/)
--   • FSR Magazine             — bad URL (fsrmagazine.com/rss.xml does not exist)
--   • QSR Magazine             — 403 bot-block on /rss.xml
--   • Toast Restaurant Trends  — 403 bot-block on the live blog
--
-- This migration corrects the URLs / strategies. The COMPANION CODE CHANGE
-- (lib/skills/ingest-knowledge.ts) now extracts REAL article bodies (follows RSS item links +
-- scrapes index → article pages), so the distill gate finally sees article prose, not nav/teasers.
--
-- Every NEW url below was VERIFIED to resolve on 2026-06-24 (WebSearch + WebFetch + a browser-header
-- curl HEAD/GET): each returned HTTP 200 with real article/feed content (NOT a 404 or 403), EXCEPT
-- Toast, which is a hard 403 bot-block with no live alternative (only a dead 2013 WordPress mirror) →
-- disabled with a note rather than burning weekly fetches on a guaranteed failure.
--
-- Idempotent: UPDATE ... WHERE url = '<old>' only touches the broken rows; re-running is a no-op once
-- the URLs are corrected. Same gates still apply downstream (adversarial distill + corroboration);
-- this only changes WHICH pages are fetched. NOTHING here relaxes the gate or grounding.
--
-- DO NOT RUN FROM THE AGENT SHELL — Bryan / the orchestrator applies this against prod.

-- (1) NRA What's Hot Culinary Forecast — restructured path. New page loads the 2026 forecast body.
--     VERIFIED 200 + real content ("Our 2026 What's Hot Culinary Forecast offers a sneak peek …").
update skill_source_registry
set url = 'https://restaurant.org/research-and-media/research/research-reports/whats-hot-food-beverage-trends/',
    fetch_strategy = 'scrape',
    enabled = true,
    last_status = 'url-fixed-2026-06-24',
    failure_count = 0,
    updated_at = now()
where url = 'https://restaurant.org/research-and-media/research/whats-hot/';

-- (2) NRA Menu Prices Economic Indicator — moved under /restaurant-economic-insights/.
--     VERIFIED 200 + real content ("Restaurant menu prices rise 0.3% in May …").
update skill_source_registry
set url = 'https://restaurant.org/research-and-media/research/restaurant-economic-insights/economic-indicators/menu-prices/',
    fetch_strategy = 'scrape',
    enabled = true,
    last_status = 'url-fixed-2026-06-24',
    failure_count = 0,
    updated_at = now()
where url = 'https://restaurant.org/research-and-media/research/economists-notebook/economic-indicators/menu-prices/';

-- (3) FSR Magazine — the old fsrmagazine.com/rss.xml does not exist. The WordPress feed at /feed/
--     IS a valid RSS 2.0 feed with FULL content:encoded bodies (verified: 18 items, real titles).
--     Switch strategy scrape-browser-headers → rss (the new extractor follows item links / uses the
--     full feed body directly).  VERIFIED 200 + valid feed.
update skill_source_registry
set url = 'https://www.fsrmagazine.com/feed/',
    fetch_strategy = 'rss',
    enabled = true,
    last_status = 'url-fixed-2026-06-24',
    failure_count = 0,
    updated_at = now()
where url = 'https://www.fsrmagazine.com/rss.xml';

-- (4) QSR Magazine — /rss.xml is 403 bot-blocked, but the WordPress feed at /feed/ returns 200 WITH
--     RICHER BROWSER HEADERS (user-agent + accept-language + referer, now in BROWSER_HEADERS) and
--     carries 25 full content:encoded article bodies. Switch to rss + the new /feed/ URL.
--     VERIFIED 200 (browser-header curl) + fresh feed (lastBuildDate 2026-06-24, 25 full-body items).
--     NOTE: the /feed/ 200 was VERIFIED ONLY WITH browser headers (a bare fetch is the same 403 as
--     /rss.xml). The companion code change makes the `rss` strategy send BROWSER_HEADERS too (it
--     previously sent them only for scrape-browser-headers), so this plain-rss row reaches 200.
update skill_source_registry
set url = 'https://www.qsrmagazine.com/feed/',
    fetch_strategy = 'rss',
    enabled = true,
    last_status = 'url-fixed-2026-06-24',
    failure_count = 0,
    updated_at = now()
where url = 'https://www.qsrmagazine.com/rss.xml';

-- (5) Toast — pos.toasttab.com/blog AND /blog/rss.xml are a HARD 403 bot-block (still 403 even with
--     full browser headers + referer). The only reachable Toast feed is toasttab.wordpress.com/feed/,
--     a DEAD/abandoned 2013 mirror (lastBuildDate Aug 2013) — stale junk, not the current restaurant
--     content. Rather than burn a weekly fetch on a guaranteed 403, DISABLE it with a clear note.
--     enabled=false means the run skips it entirely (no failure_count churn). Re-enable if Toast ever
--     exposes a fetchable feed.  VERIFIED: live blog 403; wordpress mirror 200 but 2013-stale.
update skill_source_registry
set enabled = false,
    last_status = 'disabled: hard 403 bot-block (no live feed; wp mirror is 2013-stale) 2026-06-24',
    updated_at = now()
where url = 'https://pos.toasttab.com/blog';
