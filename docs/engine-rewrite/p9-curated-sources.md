# P9 — Curated expertise-feed sources (deep-research seed, 2026-06-23)

Output of a deep-research pass (8 domain searchers → synthesis) to seed the **dynamic expertise feed**
(`knowledge_feeds`). This is the "something to react to and tune" set — **Bryan: review, drop/keep/add
before the next session seeds it.** The infra (migration + weekly fetch/RAG + cron) is NOT built yet.

Legend: **key?** = needs an API key / paid account. Prefer the free RSS/scrapeable ones for v1.

## Priority 1 — must-seed
| Source | Domain | Type | Fetch | Key? |
|---|---|---|---|---|
| NRA Restaurant Economic Insights (Analysis & Commentary) | industry | blog | scrape listing weekly | no |
| NRA Menu Prices Economic Indicator | positioning | data | scrape monthly indicator | no |
| BLS Food Services & Drinking Places (NAICS 722) | operations | data-api | BLS Public Data API | optional |
| PredictHQ Demand Intelligence & Events API (QSR) | local-demand | data-api | geofenced REST/SDK per location | **yes (paid)** |
| NOAA NCEI Climate Data Online (CDO) API | local-demand | data-api | query by ZIP/station | **yes (free token)** |
| NRA What's Hot Culinary Forecast | culinary | report | scrape annual + articles | no |
| Modern Restaurant Management | positioning | **rss** | RSS feed | no |
| Nation's Restaurant News — Menu Trends & Marketing | marketing | blog | scrape daily index | no |
| QSR Magazine | operations | blog | scrape (403 → needs browser-like headers) | no |
| Birdeye — State of Online Reviews | reputation | report | scrape guide + blog | no |
| Black Box Intelligence — In Review | industry | blog | scrape monthly release | no |
| Toast — Restaurant Trends Report | operations | report | scrape quarterly + blog | no |

## Priority 2 — good
- **Datassential FoodBytes** (culinary, scrape free preview; full data paywalled/api-keyed)
- **FSR Magazine** (marketing, scrape — full-service complement to QSR Magazine)
- **US Foods Food Fanatics** (culinary/marketing, scrape) — trends report
- _(plus a few more priority-2/3 from the run; re-discoverable — the priority-1 set is the core)_

## Notes for the build (next session)
- **Free, RSS/scrapeable, no-key sources are the v1 seed** (NRA ×3, MRM RSS, NRN, Birdeye, Black Box, Toast,
  QSR with browser headers). They cover marketing / operations / positioning / reputation / culinary / industry.
- **Key-gated, decide later:** PredictHQ (paid — but it's the single best local-demand events driver; Bryan's
  call on budget) and NOAA CDO (free token — easy to add). BLS API works keyless (key only raises rate limits).
- **local-demand gap if no PredictHQ:** the Events Impact Engine already covers events separately; the feed's
  local-demand value without PredictHQ is thinner — fine for v1.
- Fetchability varies (RSS clean; several need HTML scrape; QSR needs browser-like headers). The P9 fetch job
  should tolerate per-source fetch strategy + failure (one dead source must not break the weekly run).

➡️ **P9 infra still to build:** `knowledge_feeds` migration (sources + fetched content/embeddings) + weekly
fetch/RAG + cron + wiring distilled knowledge into the relevant skills, seeded with the tuned set above.
See `docs/engine-rewrite/insight-engine-phased-plan.md` P9 section. Agent can run the migration via
`scripts/db/sql.mts`.
