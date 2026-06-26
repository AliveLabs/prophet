# Overnight 2026-06-26 — Backlog for Bryan + Claude (review together)

Things scoped but intentionally NOT auto-shipped tonight (need calibration, a product call, or are bigger
than one safe overnight change). Grouped by workstream. Shipped items are in the session log / PRIMARY-WORKLIST.

## #3 Ranking — shipped L1/L2/L4; these need your call
- **L3 — category-prior rebalance** (`lib/skills/scoring-config.ts:119-143`). Today demand=1.0, convergence=1.0,
  positioning=0.95, reputation=0.92, operations=0.85. **RECOMMENDATION: HOLD / don't change yet.** Evidence: across
  all 37 briefs, convergence (competitive) is already the #1 rank-1 category (8 rank-1) AHEAD of demand (5). With
  L1 removing the "demand leads" prompt bias + L4 making events-high-confidence harder, the structural bias is
  addressed without touching priors — lowering demand now would likely OVERCORRECT. Revisit only if post-deploy
  briefs still over-weight weather/events. The 0-100 weight stays yours.
- **L6 — wire `importance` to novelty** (`scoring-config.ts:97-104`, neutral 50 today). The most principled fix
  for "I keep seeing the same weather/events": penalize a play whose evidence ref appeared in recent briefs,
  reward fresh ones. Fail-soft (defaults to 50 when no history). Medium build (adds a brief-history lookup).
  HIGH value — recommend building next. Held only because it's bigger than a one-line safe change.
- **L5 — auto-suppress recurring event-type plays after N days** (`synthesis.ts` new gate). High risk (a Fri
  match ≠ a Sun match); needs a per-event stableKey cooldown policy. Product call.

## #9 Design — concept VIEWS to review together (not shipped to prod)
3 concept mockups (full write-up: `docs/design-concepts/README.md`; live links below). Review, pick a
direction (or a fusion), THEN we apply it to the real components. Do not ship a restyle until you've chosen.
- MILD "The Front Page": https://claude.ai/code/artifact/03ce04f5-41b5-452d-90fe-a95ee0839e3c
- MEDIUM "The Score Spine": https://claude.ai/code/artifact/2cbffb6d-372f-4d07-98d9-3cac0f84022f
- WILD "The Overnight Edition": https://claude.ai/code/artifact/b06827d4-ee4d-4d21-a3aa-475d43f0bd1b
(also committed as standalone HTML in `docs/design-concepts/`.)

## #8 Image analysis — verified GOOD; brief at `docs/image-analysis-brief-2026-06-26.md`. Fixes not shipped:
- **Fix 1 (HIGH leverage):** the 12 deterministic visual-insight RULES (`lib/social/visual-insights.ts`) read
  only aggregate scores → generic titles. Make them cite the specific content the Gemini tagger already
  produces (subcategories, lighting patterns, the unused ownerOrStaffPresent/steamOrMotion). Kills the generic smell.
- **Fix 3:** raise the 10-post/profile vision cap + harden the Supabase-Storage gate (coverage ~50% of media
  posts today). Cost/latency lever — your call.
- **Fix 4:** real menu-board OCR comparison (Places photos already OCR `menu_board`).
- Model stays `gemini-2.5-flash` (correct; the rich output proves it). No change.

## #6 Menu & Websites — RECOMMENDATION (no build needed; your call to confirm)
**Keep the pipelines, keep them OUT of the nav (already are). Build nothing.** Findings: "Menu" +
"Websites" were Anand's `/content` (Firecrawl menu scrape + compare) and `/visibility` (DataForSEO SEO)
analyst dashboards. Both routes + pipelines still exist and RUN in the daily cron. Critically, **the menu
data is load-bearing for the brief engine** — food-pairing + positioning experts consume `menu.*` rule
outputs and the raw MenuSnapshot from the dossier; SEO signals feed positioning. So: keep the pipelines
(cutting them breaks briefs), but they correctly stay drill-down/evidence sources, NOT nav modules
(matches the "every signal source becomes evidence, not a nav item" mandate). `/content` + `/visibility`
remain reachable by direct URL for debugging. **My recommendation: confirm this — no work needed.**

## #4/#5 Weather/Events — shipped nav + insights; these are deferred (design-dependent polish)
- **Events week-CALENDAR grid** — you asked for "a calendar for the week or some other view." The events
  page already has a date-grouped feed ("some other view") + now the event-only insights. A true 7-col
  week-grid `WeekCalendar` component is a rendering enhancement (data + grouping already exist). Deferred
  because the visual system is about to change with the chosen design concept — build it in the new skin.
- **Weather "what it means for THIS restaurant" panel** — deterministic, profile-aware (patio + heat-wave
  + walk-in logic over the existing 7-day forecast). Deferred for the same design-dependent reason.
- **Nav gating REMOVED 2026-06-26** (Bryan): Weather + Events are now live for ALL customers, just placed
  LOWER in the nav (Today / Competitors / Ask / Weather / Events) since they're situational. No per-profile
  gate. (`hasPatio`/`nearVenues` population is moot for nav now; could still sharpen in-page relevance copy.)

## #7 BLUEPRINT.md — banner + §9.3 nav corrected; full section rewrite deferred
Updated the top banner to current reality + fixed the most-wrong inline statement (§9.3 "11 nav links").
A full section-by-section rewrite is deferred (2400+ lines, and the architecture is still moving with the
design rework). The agent's precise patch list if/when we do it: §1 "what it does" (brief-first), §1 "Ask
not shipped" (it is), §9.4 /home (now BriefView), §15 jobs (durable queue), §20.4 crons (now ~9), §4 file
tree (+lib/skills, lib/eval, lib/ask, lib/insights/dossier, lib/jobs queue/worker), §7 new tables.
