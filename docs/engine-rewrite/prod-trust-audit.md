# Production Trust Audit — triodvdspdsuudooyura

> Read-only. Generated against `https://triodvdspdsuudooyura.supabase.co` at 2026-06-09T15:37:19.677Z.
> Buckets compare content publish-date vs the row's `captured_at` (the "as-of" the system claims).

## Organizations — who the daily cron actually serves
Total **15** · would-run **8** · skipped (trial expired / no sub) **7**

| org | tier | trial_ends | runs? |
|---|---|---|---|
| Rosa's Cafe | free | 2026-04-06T23:04:05.50987+00:00 | ⛔ skipped |
| Marcel | free | 2026-04-10T21:29:43.97+00:00 | ⛔ skipped |
| Nada | top | 2099-12-31T23:59:59+00:00 | ✅ |
| Wagyu House Atlanta | top | 2099-12-31T23:59:59+00:00 | ✅ |
| Lockwood Distilling | top | 2099-12-31T23:59:59+00:00 | ✅ |
| bar Vetti | top | 2099-12-31T23:59:59+00:00 | ✅ |
| J. Alexanders | top | 2099-12-31T23:59:59+00:00 | ✅ |
| Kres Chophouse | top | 2099-12-31T23:59:59+00:00 | ✅ |
| Chris Hershberger's Organization | free | 2026-05-19T21:52:15.541+00:00 | ⛔ skipped |
| Chris Hershberger's Organization | free | 2026-05-19T21:52:18.216+00:00 | ⛔ skipped |
| Chris NeatTest's Organization | free | 2026-05-19T21:52:20.053+00:00 | ⛔ skipped |
| Hersh's Restaurant | free | 2026-04-08T20:30:54.327671+00:00 | ⛔ skipped |
| Test Restaurant | free | 2026-04-29T19:25:00.541+00:00 | ⛔ skipped |
| BevMo | free | 2026-06-12T22:48:30.639+00:00 | ✅ |
| Bush's Chicken | free | 2026-06-23T14:21:38.476+00:00 | ✅ |

## Social (Data365) — content age vs capture stamp  ← the headline check
**57** social snapshots analyzed.

Freshness of newest post inside each snapshot (vs when we "captured" it):

| bucket | count |
|---|---|
| fresh (≤30d) | 24 |
| no-date | 24 |
| ancient (>365d) | 5 |
| stale (91–365d) | 4 |

### Worst offenders — "captured" recently but newest content is >90 days old (top 25)
| platform | handle | captured | newest post | content age (days) | verified | method |
|---|---|---|---|---|---|---|
| instagram | bushscknforney | 2026-06-09 | 2022-01-07 | **1614** | true | manual |
| instagram | terillisrestaurant | 2026-03-01 | 2022-06-02 | **1369** | true | manual |
| tiktok | quadro_ristorante | 2026-03-07 | 2023-04-11 | **1061** | true | data365_search |
| instagram | gyukakuatlanta | 2026-03-06 | 2023-08-31 | **918** | true | auto_scrape |
| facebook | gyukakuatlantaga | 2026-03-06 | 2023-10-27 | **861** | true | auto_scrape |
| facebook | ristoranteciaoamore | 2026-03-07 | 2025-03-13 | **359** | true | data365_search |
| facebook | ristoranteciaoamore | 2026-03-06 | 2025-03-13 | **358** | true | data365_search |
| facebook | chiroriatlanta | 2026-03-06 | 2025-10-21 | **137** | true | auto_scrape |
| instagram | chiroriatlanta | 2026-03-06 | 2025-11-30 | **97** | true | auto_scrape |

### Discovery quality
Profiles: **44** · verified **37** · unverified **7**
By discovery method: manual=17 · auto_scrape=16 · data365_search=11

## Competitor snapshots (Google listing / SEO labs)
**190** rows. Freshness of `captured_at` vs now:
| bucket | count |
|---|---|
| stale (91–365d) | 121 |
| aging (31–90d) | 61 |
| fresh (≤30d) | 8 |

By snapshot_type (newest captured_at):
| type | count | newest |
|---|---|---|
| seo_domain_intersection_weekly | 37 | 2026-05-29 |
| seo_domain_rank_overview_weekly | 37 | 2026-05-29 |
| web_menu_weekly | 35 | 2026-05-29 |
| seo_relevant_pages_weekly | 30 | 2026-05-29 |
| seo_ranked_keywords_weekly | 30 | 2026-05-29 |
| seo_historical_rank_weekly | 19 | 2026-05-29 |
| meta_ads_daily | 2 | 2026-05-30 |

## Location signals (events / weather / SEO / menu) — coverage & freshness
| provider | rows | locations | newest date_key | age (days) |
|---|---|---|---|---|
| firecrawl_menu | 13 | 8 | 2026-06-09 | 1 |
| seo_historical_rank | 7 | 7 | 2026-06-09 | 1 |
| seo_subdomains | 9 | 7 | 2026-06-09 | 1 |
| seo_serp_keywords | 9 | 7 | 2026-06-09 | 1 |
| seo_competitors_domain | 9 | 7 | 2026-06-09 | 1 |
| seo_ranked_keywords | 9 | 7 | 2026-06-09 | 1 |
| seo_domain_rank_overview | 9 | 7 | 2026-06-09 | 1 |
| seo_relevant_pages | 9 | 7 | 2026-06-09 | 1 |
| dataforseo_google_events | 9 | 6 | 2026-06-09 | 1 |
| firecrawl_site_content | 14 | 9 | 2026-06-09 | 1 |
| seo_ads_search | 3 | 3 | 2026-03-23 | 79 |

## Insights — freshness & composition
**506** insights. date_key range 2026-02-01 → 2026-06-09.

Freshness (date_key vs now):
| bucket | count |
|---|---|
| stale (91–365d) | 310 |
| aging (31–90d) | 162 |
| fresh (≤30d) | 34 |

Top insight_type:
| type | count |
|---|---|
| events.new_high_signal_event | 95 |
| competitive_summary | 44 |
| traffic.competitive_opportunity | 42 |
| review_themes | 39 |
| baseline_snapshot | 31 |
| menu.signature_item_missing | 31 |
| menu.price_positioning_shift | 26 |
| menu.category_gap | 24 |
| social.promotional_activity | 13 |
| seo_competitor_keyword_portfolio | 13 |
| seo_competitor_top_page_threat | 13 |
| social.inactive_account | 12 |
| traffic.baseline | 10 |
| social.competitor_promo_blitz | 8 |
| menu.menu_change_detected | 8 |
| seo_historical_traffic_trend | 6 |
| social.posting_frequency_low | 6 |
| social.food_photography_strong | 6 |
| social.top_performing_post | 6 |
| social.engagement_below_average | 6 |

## Pipeline run history (refresh_jobs)
**94** job records. Most recent: 2026-06-09T14:44:50.898749+00:00.
Status mix: completed=91 · failed=3
By type: social=40 · busy_times=10 · meta_ads=9 · photos=8 · visibility=7 · events=6 · insights=6 · weather=3 · content=3 · refresh_all=2

| when | type | status | location |
|---|---|---|---|
| 2026-06-09T14:44 | photos | completed | 910c23b5 |
| 2026-06-09T14:44 | photos | completed | 910c23b5 |
| 2026-06-09T14:35 | social | completed | 910c23b5 |
| 2026-06-09T14:31 | social | completed | 910c23b5 |
| 2026-06-09T14:24 | refresh_all | completed | 910c23b5 |
| 2026-06-02T15:20 | meta_ads | completed | 67107b57 |
| 2026-05-30T14:22 | meta_ads | completed | 67107b57 |
| 2026-05-30T14:10 | meta_ads | completed | 67107b57 |
| 2026-05-30T13:53 | meta_ads | completed | 67107b57 |
| 2026-05-29T23:13 | meta_ads | completed | 67107b57 |
| 2026-05-29T23:00 | meta_ads | completed | 67107b57 |
| 2026-05-29T22:58 | meta_ads | completed | 67107b57 |
| 2026-05-29T22:54 | meta_ads | completed | 67107b57 |
| 2026-05-29T22:52 | meta_ads | completed | 67107b57 |
| 2026-05-29T22:50 | social | completed | 67107b57 |

---

# Interpretation & Recommendation (2026-06-09)

## Verdict
The data layer **systematically stamps stale content as fresh**, confirmed on live prod, on a real
customer, dated today.

- **Smoking gun:** `Bush's Chicken` is a real free-tier signup (trial active). Its Instagram
  (`bushscknforney`) was **captured 2026-06-09 (today)** with a newest post of **2022-01-07 —
  1,614 days / 4.4 years old**, and the profile is marked `verified=true`. The morning's
  `refresh_all → social → photos` run on this location (location `910c23b5`) reported **"completed"**
  the whole way through while ingesting 4.4-year-old data as current. That is exactly the
  "telling you it's doing something other than what it's actually doing" behavior.
- **42% of social snapshots (24 of 57) have no parseable post date at all** — the system can't even
  know how old they are, yet ingests and presents them.
- **Listing/SEO competitor snapshots: only 8 of 190 are fresh** (121 stale, 61 aging); newest is
  2026-05-29, i.e. not refreshed in ~11 days.
- **Insights: only 34 of 506 are fresh** (310 stale, 162 aging), never expired — a brief reading
  "latest insights" without a freshness filter serves months-old conclusions.
- **Real customers mostly get nothing:** 7 of 15 orgs are skipped entirely (expired trials); the
  only consistently-populated orgs are the immortal `trial_ends=2099` internal test accounts. The
  rework was validated against those, never the real signup path.

## Root causes (where the rot actually lives)
1. **Freshness is never validated against content.** Snapshots are stamped `captured_at = now`
   regardless of how old the underlying posts are. Nothing compares post date to capture date; the
   "resilience/last-good" layer keys off the (lying) capture stamp.
2. **"Completed" ≠ "correct."** A Data365 collection that returns a dead/abandoned account's
   2022 posts, or whose `/update` doesn't actually re-crawl, still completes green. Success is
   measured as "the call returned," not "the data is recent and right."
3. **Handle discovery locks in wrong/dead accounts.** Fuzzy `data365_search` (similarity ≥ 0.3)
   produces junk handles; even `auto_scrape`/`manual` handles can point at abandoned accounts
   (gyukakuatlanta last posted 2023). Discovery self-skips any entity that already has a profile
   row, so a wrong handle is never re-checked.
4. **Orchestration is fragile + likely times out (CORRECTED — see note).** Live path = Vercel cron
   `/api/cron/daily`, which fires `/api/jobs/refresh_all` **fire-and-forget** (no await, the SSE
   stream is never consumed → no delivery guarantee). `refresh_all` runs **all 8 sub-pipelines
   sequentially inside one 300s function**; social alone polls Data365 up to ~5 min *per profile*,
   so for any real location the run almost certainly **exceeds `maxDuration = 300` and is killed
   mid-run** — early pipelines complete, the rest silently drop. A legacy/orphaned Supabase
   edge-function path (`orchestrator_daily` returns a jobs array but **never enqueues**) adds
   confusion. `refresh_jobs` history shows bursty, manual-looking runs, not a steady cadence.

   > **CORRECTION (2026-06-09, later):** an earlier draft said "social is not in the daily
   > pipeline." That was wrong — the daily cron's `pipelines` array is only a cosmetic log;
   > `/api/jobs/refresh_all` → `buildRefreshAllSteps()` runs ALL sub-pipelines *including social*.
   > The real defect is the timeout/fire-and-forget above, not a missing pipeline. The cosmetic
   > log also misrepresents which pipelines ran (its own observability bug).
5. **Gating silently turns collection off.** Trial-expiry + tier cadence (free = Mondays only) +
   competitor `metadata.status === "approved"` together mean a real signup easily ends up with no
   running pipelines and no fresh data, with no surfaced reason.

## Layer assessment
- **Keep (the real moat):** provider clients (Data365 / DataForSEO / Outscraper / Firecrawl /
  Google Places / Gemini / OpenWeather / Resend), DB schema, auth, Stripe/billing/tiers.
- **Rebuild (the rotten core):** ingestion → orchestration → freshness/integrity → observability.
  This is the layer the UX rework explicitly *preserved without auditing*.
- **Re-validate (built on bad data):** the new insight engine + editorial brief UI. Good work, but
  its eval-gate result ("$300-worthy", 4.5 vs 1.75) is **not trustworthy** until it runs on
  validated-fresh data.

## Recommendation
**Neither pure retrofit nor full from-scratch rebuild. Rebuild the rotten core; reuse the shell and
the leaves.** Replace the ingestion/orchestration spine with ONE observable pipeline governed by a
**data-integrity contract**:
- Every signal carries a true "as-of" date derived from content, not capture time.
- Freshness is validated at write time; stale/undated data is **excluded or explicitly labelled at
  the source** — never silently presented as current.
- Job status reflects real pipeline outcome (got-fresh-data vs served-stale vs failed), not "the
  call returned 200."
- Handle/competitor discovery requires verification and supports re-discovery; no permanent lock-in
  of a dead account.
- Gating is observable: if a customer isn't getting data, the system says why.

Then re-validate the engine + UI on real, fresh data **before any cutover**. Do **not** ship the
UX rework onto production until the spine is trustworthy — a polished brief on lying data is worse
than today's unpolished-but-not-pretending state.

## Notes on method / honesty
- This audit is **read-only** (SELECT/GET only); the script is `scripts/audit/prod-trust-audit.mjs`.
- Prod credentials were pulled to a gitignored file by Bryan, read for two values, and deleted
  immediately after the run. Prod data was not mutated.
- "would-run" in the org table is an approximation of `isTrialActive` + paid-tier; free orgs in an
  active trial still only run on Mondays. It marks eligibility, not "runs today."

---

# Deep-dive addendum (2026-06-09) — mechanism confirmed

## Read-only Data365 probe (GET only, no re-crawl, no cost)
Asked Data365 for the newest posts (date_desc) for the two worst handles, right now:
- `bushscknforney` → newest post **2022-01-07** (likes 1–3). Dark ~4.5 years.
- `gyukakuatlanta` → newest post **2023-08-31** (likes 0–6). Dark ~2.5 years.

**Conclusion: not a cache/sort bug.** The live Next path fetches newest-first and *still* gets
2022 because 2022 genuinely is the newest content Data365 has for these handles. The accounts are
**dormant or wrong** (a defunct location-specific account while the brand posts elsewhere), and:
- there is **no liveness/recency gate** — the pipeline ingests "the newest N posts that exist,"
  however old, stamps the snapshot `captured_at = today`, and treats it as current activity;
- a `social.inactive_account` insight type **exists** but does NOT gate the other social rules, so
  `social.promotional_activity` / `top_performing_post` fire off dormant accounts;
- discovery marks dormant/wrong handles `verified=true` and never re-checks them.

This is fixable as a **liveness gate + discovery verification**, but it also surfaces a product
truth: many small restaurants' own/competitor social accounts are genuinely dormant, so "social
intelligence" has thin real signal for a chunk of the base — relevant to the value proposition.

## The same failure exists in MY engine (own it)
`lib/insights/dossier/build.ts` decides social freshness from the snapshot's **`date_key` (capture
date)**, never the post content date:
- `loadSocial` returns `latestDate` = freshest `date_key`; `socialFresh = ageDays(socialAsOf) ≤ 30`.
- A snapshot captured today with 2022 posts → `socialFresh = true` → attached to the dossier and
  shown in coverage as "Social ✓ fresh, N accounts" while serving 2022 content.
- The `STALE_AFTER_DAYS` coverage flag also keys off `date_key`, so it can never catch this.
- Stale-content social insights are stamped `date_key = today` by the pipeline, so they pass the
  30-day insight window too.

So the "stale-stamped-fresh" defect is present at BOTH layers — the legacy pipeline and the new
engine I built on top of it. The eval-gate result is doubly untrustworthy.

## Remaining open threads (not yet resolved)
1. **Does the daily cron actually fire on schedule in prod?** `refresh_jobs` history looks bursty/
   manual (clustered on test locations; only 2 `refresh_all` ever), suggesting runs are mostly
   manual, not a reliable daily cadence. Needs a per-date `refresh_jobs` timeline query (prod
   read-only) to confirm, plus whether `CRON_SECRET` is set in prod.
2. **Are the orphaned Supabase edge functions (`orchestrator_daily`/`job_worker`/`digest_weekly`)
   deployed or scheduled** (pg_cron / Supabase schedules)? Needs Supabase dashboard/CLI (Bryan).
3. **No-parseable-date (42% of social snapshots):** likely edge-path raw rows or FB/TikTok field
   shapes the parser missed — confirm whether these are undated content or a normalization gap.

## Capstone: the defect is systemic, not social-specific
A scan of all nine pipelines (`lib/jobs/pipelines/*` + `pipeline.ts`) for any recency/freshness/
liveness check (`freshness|stale|isRecent|recency|publishedAt|olderThan`) returns **zero hits**.
Every pipeline follows the same shape: fetch whatever the provider returns → stamp
`captured_at = now` / `date_key = today` → store as "latest" → diff against the previous
today-stamped row. The insights pipeline then stamps each generated insight `date_key = today`.
**There is no concept of content freshness anywhere in ingestion.** Dormant social accounts are the
most visible symptom; the listing/SEO/insight staleness in the tables above is the same root. This
confirms the rebuild scope: the ingestion → orchestration → freshness → observability **spine**,
governed by a data-integrity contract — not a social-only patch.

