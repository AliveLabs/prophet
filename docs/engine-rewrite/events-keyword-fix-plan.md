# Events keyword-monoculture fix — build-ready plan

**Written 2026-06-22.** Root cause confirmed in code + a precise change surface, so the build session can
execute fast. See memory `[[ticket-events-keyword-monoculture]]` for the live-DataForSEO proof. **Two
decisions are Bryan's (below) — answer them first; they set scope + cost.**

## Root cause (confirmed in code)
`lib/jobs/pipelines/events.ts:109–116` hardcodes the query keyword to the generic `"events"` (1–2 queries/run):
```ts
queryDefs.push({ keyword: "events", dateRange: "week" }, { keyword: "events", dateRange: "weekend" })
```
→ DataForSEO Google Events (`lib/providers/dataforseo/google-events.ts` `fetchGoogleEvents`, `depth` default 10,
cap 20) returns a generic feed where stadium mega-events sit below local club/music listings → **depth-10
truncates them → never fetched.** Geo/magnitude/role scoring downstream is fine; the events just never arrive.
(Proven: querying `"world cup"` / `"AT&T Stadium"` returns the matches at the top.)

Notably, the tier config ALREADY has an **unused `eventsKeywordSets` (entry 2 / mid 5 / top 5)** hook
(`lib/billing/tiers.ts`), and a `HIGH_SIGNAL_KEYWORDS` list exists but only POST-fetch (`lib/events/insights.ts:21`).

## 🔴 Decisions for Bryan (set scope + cost)
**D1 — How to afford more keywords?** Today `eventsQueriesPerRun` = 1 (entry, weekly) / 2 (mid+top, daily).
Each query = 1 DataForSEO call. To cover N keywords you must either spend more or rotate:
- **(a) Rotate a curated keyword set across runs** within the current 1–2/run budget (cheap, no cost change;
  full coverage takes a few days). 
- **(b) Raise `eventsQueriesPerRun`** (e.g. top→4–6/day) for same-day breadth (≈2–3× events DataForSEO cost).
- **(c) Hybrid (RECOMMENDED):** keep daily budget at 2 for the generic + one rotating high-signal keyword,
  AND add ONE wider monthly sweep (more keywords + `dateRange:"month"` + `depth:20`) on the Monday run only —
  catches far-out mega-events cheaply (~+1 call/location/week). Pick (a)/(b)/(c) or a mix.

**D2 — Venue radar source?** `profile.attributes.nearVenues` exists but is NOT populated in prod (test
fixtures only). To query events BY marquee-venue name we need to populate it. Options:
- **(a)** Google Places nearby-search for stadiums/arenas/theaters within the demand radius, run once on
  location create / first_run, store on the profile (new small builder; ≈free, Places already wired). RECOMMENDED.
- **(b)** Manual per-location venue list (no API, but manual).
- **(c)** Defer venue radar entirely; ship keyword expansion first (it alone unburies most mega-events).

## Implementation (slice it — A is the high-value core)

### Slice A — keyword expansion + month horizon + stadium magnitude  (depends on D1)
- **NEW `lib/events/keywords.ts`:** `FETCH_KEYWORDS` (curated high-signal query terms: `sports`, `concerts`,
  `festival`, `game`, `championship`, plus city-templated variants) + a deterministic per-run rotation helper
  (`keywordsForRun(tier, dateKey)`) so coverage cycles within the per-run budget (D1a/c).
- **`lib/jobs/pipelines/events.ts:100–116`:** replace the hardcoded `queryDefs` with a loop over
  `keywordsForRun(...)`; keep the existing `ensure*`/`getEventsQueriesPerRun` cost gate (add an explicit
  assertion that `queryDefs.length <= getEventsQueriesPerRun(tier)`); add the Monday-only `month`/`depth:20`
  sweep if D1c.
- **`lib/events/relevance.ts:31–34`:** extend `MAJOR_VENUE`/`MAJOR_EVENT` regex with `world cup`, `fifa`,
  `super bowl`, `playoff`, `final`, `cup` so a fetched mega-event classifies `major` (→ `metro_hook` when far).
- **Dedup:** results from multiple keywords merge through the existing `normalizeEventsSnapshot()` UID dedup
  (`lib/events/normalize.ts`) — verify cross-keyword dupes collapse (same UID) and add a test.
- **Also fix the manual-refresh fetch site:** `app/(dashboard)/events/actions.ts` has the SAME hardcoded
  `"events"` keyword — route it through the same `keywordsForRun`/keyword set so the in-app "refresh events"
  button isn't blind too.
- **Secondary (post-fetch) gap:** extend `HIGH_SIGNAL_KEYWORDS` (`lib/events/insights.ts:21`) with
  `soccer`, `world cup`, `fifa`, `match`, `fútbol`, `playoff`, `cup` — else a fetched match still won't flag
  high-signal in the insight layer. (Note venues may rebrand for the event — e.g. AT&T Stadium = "Dallas
  Stadium" for the WC — so venue-name matching must be fuzzy.)
- Cost gate stays the backstop; `[claudeRaw]`-style graceful failure already in `fetchGoogleEvents`.
- Reuse the live probe `scripts/audit/wc-events-probe.ts` to validate the new keywords against DataForSEO.

### Slice B — marquee-venue radar  (depends on D2; do after A)
- **NEW `lib/locations/venue-radar.ts`:** Places nearby-search → marquee venues within radius → persist to
  `profile.attributes.nearVenues` (or a `location_venues` table) on create/first_run + a periodic refresh.
- **`events.ts`:** when `nearVenues` populated, add per-venue queries (`{keyword: venueName, dateRange:"month"}`),
  cost-gated (top tier / monthly only).

### Tests (mirror existing)
- `tests/unit/events/relevance.test.ts`: stadium/world-cup keywords → `major`; far+major → `metro_hook`.
- NEW `tests/unit/events/keywords.test.ts`: `keywordsForRun` rotation is deterministic + within budget.
- NEW fixture `tests/fixtures/dossiers/stadium-search.ts`: a World-Cup-at-AT&T-Stadium event (≈22mi, major)
  surfaces as `metro_hook`. (Pattern: `tests/fixtures/dossiers/arena-week.ts`.)
- Verify gate: tsc · test:unit · build, then the adversarial-review workflow (this is a fetch+cost change).

## Suggested order
Answer **D1** + **D2** → build **Slice A** (the core; unburies mega-events, bounded cost) → review + ship →
then **Slice B** (venue radar). Slice A alone closes most of the gap; B adds venue-indexed coverage.
