# Phase A — Rule-Depth Audit & Data Ceiling (2026-06-04)

> The decisive first gate of the insight-engine rewrite (see the rewrite plan). The question:
> **can the 76 deterministic rules + a few cross-source joins ground genuinely non-obvious,
> recipe-level recommendations?** Because synthesis (the LLM skill layer) cannot exceed the depth
> of the data beneath it. If the rules can't ground non-obvious plays, we fix the data first.

## Verdict

**Viable, but the data ceiling is real and lower than the rewrite plan optimistically implied.**
Roughly **half** the 76 rules are evidence-only (descriptive), ~30% are shallow/generic
("post more", "improve your photos"), and only ~8-15 ground a genuinely useful, specific play today.
The highest-value, "feels-smarter-than-me" plays the founders want (geotarget the concert crowd,
weather-app ads, capture a rival's slow daypart) **depend on data we do not currently have.**

So the conclusion is not "stop." It is: **the synthesis layer is necessary but not sufficient — a
short list of data acquisitions are prerequisites for the value bar, not nice-to-haves.** Build the
engine AND fund the data, in parallel.

## Depth distribution (76 rules)

| Bucket | Share | Meaning |
|---|---|---|
| Evidence-only | ~50% | Pure description ("rating changed", "new photos", "engagement up"). Should ground a *fact*, never a recommendation. |
| Shallow/generic | ~30% | Fires an obvious action ("post 3x/week", "use these hashtags", "improve photos"). The thing the v3/v5 reviews condemned. |
| Recipe-ready / strong | ~15-20% | Grounds a specific, defensible play today (see below). |

Most rules are **competitor-only and single-source diffs**; there is exactly **one** cross-source
rule in the entire system. "Non-obvious" almost always comes from a *combination* of signals, so the
non-obviousness budget has to be built in a join layer, not conjured by the prompt.

## What grounds a strong play TODAY (the keepers)

- SEO: `seo_keyword_opportunity_gap`, `seo_competitor_keyword_portfolio`, `seo_new_competitor_ads` (commercial-intent keyword gaps competitors win).
- Content: `content.conversion_feature_gap`, `content.delivery_platform_gap`, `menu.catering_pricing_gap`, `menu.promo_signal_detected` (concrete positioning/feature/pricing moves, grounded in real menu scans).
- Events: `events.new_high_signal_event`, `events.competitor_hosting_event`, `events.upcoming_dense_day`, `events.weekend_density_spike` (demand windows + a rating-edge counter-play).

## Cross-source combinators deployable TODAY (no new data)

These are the first things the engine should compute — real interactions, no acquisition required:

1. **Competitor hosts an event + you lack reservations/online-ordering → emergency feature + counter-promo.** (events.competitor_hosting × content.conversion_feature_gap)
2. **Competitor drops price + you rank well + higher rating → position on quality, do NOT price-match.** (menu.price_positioning_shift × seo_keyword_win × rating edge)
3. **High-signal event + competitor's top SEO page on that theme + your topic gap → ride the event with a themed content + offer.** (events.new_high_signal_event × seo_competitor_top_page_threat × keyword portfolio gap)
4. **Competitor lower-rated + hosting a budget event → "better-rated alternative" targeted campaign.** (events.competitor_hosting × rating delta)

These are good and real — but note they skew **competitive/tactical**, not the marquee
"geotarget 30k concertgoers" play, which needs the data below.

## Data gaps that cap the value bar (ranked — these gate "thousands in value")

| # | Missing data | Blocks | Acquire via |
|---|---|---|---|
| 1 | **Event attendance / capacity** (`NormalizedEvent` has none) | All volume-based staffing/promo sizing; the "~30k reach" number is currently *fabricated* | venue-capacity dataset / ticketing signals |
| 2 | **Own-business foot traffic** (busy_times is competitor-only) | "you're slow when they surge" plays; can't verify our own demand | Placer.ai / Foursquare / Google popular-times for own location |
| 3 | **Own review sentiment / themes** (only counts + deltas today) | Reputation plays ("fix the service complaints before promoting") | NLP over review text we already pull |
| 4 | **Competitor menu depth + item tags** (dietary, prep, occasion) | Menu-gap and dietary-positioning plays | extend the menu scrape/parse |
| 5 | **Temporal freshness / recency scoring** | Stale insights ranked equal to live ones; promo may already be over | add `recencyScore`/`staleBefore` to insights |
| 6 | **Competitor keyword velocity, backlink quality, SERP features** | Preempting SEO pivots; reverse-engineering wins | richer DataForSEO pulls |
| 7 | **Margin / cost (own)** | ROI-aware promo targeting ("happy hour on high-margin items only") | POS integration (later; we deliberately avoid sales data for now — treat as optional) |

## Recommendation

1. **Proceed with the engine rewrite** (architecture is sound; the dossier/skill design holds).
2. **Treat data acquisitions #1-#5 as first-class work, sequenced with the build.** The two that most
   directly unlock the founders' marquee plays are **#1 event attendance** and **#2 own foot traffic**.
   #3 review sentiment is the cheapest high-leverage add (we already have the text).
3. **Ship the deployable-today combinators first** so the engine clears the bar on competitive/feature/
   pricing/event plays while the data for the bigger plays is acquired.
4. **Re-rate the gate after #1-#3 land:** the honest read is "competitive-monitor-grade today, strategic-
   decision-engine-grade once the demand-side data (events attendance + own traffic + review sentiment)
   is in." The eval harness (Phase B) measures the climb.

## Open question for Bryan + Chris (the gate decision)

The "best non-obvious play per rule" calls above are a first pass and partly domain judgment — your and
Chris's restaurant-marketing read should validate/extend them. And the data-acquisition shortlist (#1-#5)
is a real spend/effort decision that gates the value ceiling. **That's the Phase A go/no-go to make
together before we commit skill-building effort.**
