# Insight Engine — Phased Build Plan (P0–P10)

Authoritative build sequence from the 2026-06-19 deep review. Findings + the 0-100
calibration principle live in `insight-engine-deep-review-2026-06-19.md`; this is the
ordered, save-pointed execution plan. Each phase is a self-contained, gated, deployable unit
with a save point. No "Wednesday vs V2" line — it's a continuous ramp; stop at any save point.
Each phase ends with: `tsc` clean · unit tests · prod build · commit on spine-rewrite ·
(optional) deploy. Bryan may press straight through.

File:line and sketches grounded by an 11-agent parallel investigation (2026-06-19).

## Scoring model (underpins P2/P3/P8/P10) — DECIDED 2026-06-19
```
base = w_impact·impact + w_confidence·confidence + w_importance·importance   (each factor a WHOLE 0–100)
combined = base × categoryPrior            (prior is a MODEST multiplier, a bias not a gate)
```
- **Scale: whole numbers 0–100, NOT decimals.** (Bryan's call. Note: the 0-100-vs-decimal
  change does NOT itself change ranking — it's a uniform rescale; what lets a strong ops play
  beat a weak marketing play is combining impact+confidence into the base BEFORE the prior,
  plus a modest prior gap. We use 0–100 because it's legible/tunable and avoids float
  compression — not because the scale changes the math.)
- **Worked example that must hold:** ops confidence 92 / impact 50 / importance 50, weights
  0.40/0.35/0.25 → base ≈ 65 → ×0.85 = 55, beats marketing base 50 × 1.0 = 50. ✓
- **SEED (start here, calibrate across the few live restaurants):** weights impact 0.40 /
  confidence 0.35 / importance 0.25. Confidence map high/medium/directional → 100/65/30.
  Impact(leverage) high/medium/low → 100/60/25. Category priors: marketing 1.00, demand 1.00,
  positioning 0.95, reputation 0.92, **operations 0.85**. INSTRUMENT prior-flips (log when the
  prior changed rank order) so we tune from evidence.

## Taxonomy — DECIDED: Category declared on each skill (no translation layer)
Each `ProducerSkill` declares its own `category` (intrinsic, not a RecKind→Category map — Bryan
wants to avoid a fragile translation layer). Category enum: **Demand, Marketing, Positioning,
Reputation, Operations** (Social folds into Marketing for now — no skill owns it yet). Plays
inherit their producing skill's category. RecKind stays as the play SHAPE (prepare/capitalize/
…); Category is the operator-facing DOMAIN used by priors, drill-down, and rerank controls.

## Vision → positioning is its OWN phase (PV), after P5, skippable
Pulled out of P1 (P1 = hours gate only, no dependency). Cost finding: positioning CONSUMING
vision adds ≈zero cost — Gemini photo analysis already runs weekly, capped, diff-based (new
images only); no per-brief re-analysis. The only work is loading the persisted visual profile
into the dossier (or routing positioning to the existing photo.*/visual.* rule outputs). Build
placeholders/reasoning hooks in P1/P2; do the wiring in PV.

---

## P0 — QSR walk-in rule de-absolutize  ·  size: SMALL  ·  deps: none
**Goal:** kill the absolutist "QSR never gets walk-ins" rule; a QSR with a lobby gets its own
surge model. Unblocks Raising Cane's foot-traffic insights (AT&T Stadium). The standalone
quick win.
- `lib/insights/dossier/types.ts`: add `ServiceModel` union (drive-thru-only,
  drive-thru-with-dine-in, dine-in-primary, bar-dine-in, delivery-takeout-only); type the
  profile field.
- `lib/insights/dossier/build.ts` (~354-360): subdivide QSR by seating signal
  (fast_food + dine_in/seating → drive-thru-with-dine-in; else drive-thru-only). Same Places
  data, no new fetch. Conservative fallback to drive-thru-only.
- `lib/skills/prompt-kit.ts:31`: replace the `never` line with branching — drive-thru-only
  skips walk-in framing; drive-thru-with-dine-in gets lobby surge + drive-thru carryover;
  others standard.
- Test: extend `tests/integration/pretest-event-geo.live.test.ts` with the Cane's/AT&T case.
- **Demo:** live-build Cane's Arlington on a game weekend → expect a "prepare the lobby for
  post-game surge" + "capitalize on walk-in crowd" play instead of drive-thru-only framing.
- Risk: Places may omit `dine_in` for some seated spots → conservative fallback + (P8)
  operator override.

## P1 — Factual gates + cheap correctness wins  ·  size: SMALL  ·  deps: none (see vision note)
**Goal:** (a) hours gate — a FACTUAL near-absolute (legit per the 0-100 rule): never recommend
a daypart the restaurant is closed for. (b) vision → positioning.
- (a) `lib/insights/dossier/types.ts`: `HoursGate { operatesAtAll; daypartStatuses{lunch,dinner:
  open|closed|unknown}; ... }` on EntitySignals + profile. NEW `dossier/hours-gate.ts`
  (deterministic parser over `regularOpeningHours.weekdayDescriptions`, already fetched).
  `build.ts` populates it; `operations` skill `selectInput` receives it; `prompt-kit.ts` gets
  a `HOURS_GATE` rule.
- (b) positioning skill `selectInput` + `knowledge.ts`: consume the visual signal so premium
  cues ("20+ craft whiskeys", plating, ambiance) become positioning proof points.
- **⚠️ Vision dependency (Claude found this):** `buildDossier` does NOT populate
  `d.location.visual` (EntityVisualProfile) today — vision lives only as `photo.*`/`visual.*`
  rule outputs. So P1(b) is EITHER: route positioning to read those existing rule outputs
  (cheaper, no new compute) OR load the persisted visual profile into the dossier. Confirm the
  visual profile is persisted/loadable before assuming a stub. Hours gate (a) has no such
  dependency — ship it regardless.
- Test: closed 11am–5pm + 1pm demand → no lunch play; dinner-only → no lunch recs.

## P2 — Scoring core: continuous combined score + category prior  ·  size: SMALL–MED  ·  deps: taxonomy decision
**Goal:** replace `synthesis.ts:41-47` KIND_RANK×10+CONF_RANK ladder (impact unused!) with the
continuous combined score above; one global pool. *The heart of the redesign.*
- NEW `lib/skills/scoring-config.ts`: continuous normalizations (confidence high/med/directional
  → 100/65/30; leverage high/med/low → 100/60/25), factor weights, the Category enum +
  per-category priors, `computeCombinedScore()`. ALL tunable constants in this one file.
- `synthesis.ts`: remove CONF_RANK/KIND_RANK/old `score()`; rank by `computeCombinedScore`;
  stable sort. `leverage` (impact) now actually drives rank (was loaded and ignored).
- NEW `scoring-config.test.ts`: best/worst case, the strong-ops-beats-weak-marketing property,
  tie-breaking. No UI change this phase → cleanly unit-testable. Instrument prior-flips.

## P3 — Global ranked display + category drill-down  ·  size: MEDIUM  ·  deps: P2
**Goal:** brief shows top-N by combined score regardless of category; drill-down by category /
"more like this" / show-all (mirror the existing `insight-feed.tsx` collapse/expand pattern).
- `app/(dashboard)/home/brief-view.tsx`: group by Category, top-N first, collapsible rest.
- `lib/skills/types.ts`: optional `combinedScore` stamp + optional `playsByCategory`.
- `brief.css`: zone-group / expand styles.
- Risk: with ~10+ plays, global rank + grouping can feel redundant — settle the hierarchy
  (ranked spine on top, categories as drill-down, not parallel lists).

## P4 — Price corroboration + positioning-over-price  ·  size: SMALL–MED  ·  deps: none
**Goal:** a price play must be corroborated (competitor cheaper AND reviews mention
price/expensive) or it reframes to positioning / a ranked-lower loss-leader. Kills the
Wagyu-$12.99 miss; guards mom-and-pop vs chain.
- `lib/content/insights.ts`: `canCorroboratePrice()` + `corroboratePriceInsights()` pure helpers.
  AS BUILT (single type, not the originally-planned dual type): the row stays
  `menu.price_positioning_shift`; the verdict rides on `evidence.corroboration`
  (`strong`|`weak`|`unknown`) — one type avoids two coexisting in the retention window. Framing
  is derived from the verdict + evidence so it is idempotent. (for P2/P10 to weight).
- Corroboration runs at WRITE time in `lib/jobs/pipelines/insights.ts` (content_insights step,
  sentiment computed in load_location_data) so every surface (brief, /insights Feed, /social)
  reads corrected rows; `build.ts` also runs it at READ time as an idempotent safety net. (Reviews
  live in the dossier/pipeline, NOT in `generateContentInsights`, which the jobs pipeline calls.)
- positioning `knowledge.ts` v2: "HANDLING PRICE MISMATCHES" — recommend positioning when
  corroboration is weak/unknown; `reviewThemes` added to the skill's selectInput.

## P5 — Cross-domain convergence pass + model depth  ·  size: MEDIUM  ·  deps: P2 (for ranking the new plays)
**Goal:** the marquee "smarter than the owner" fix — find multi-source patterns no single
domain skill can (heat wave + heavy menu + "slow when busy" reviews → push fast-turn items).
- NEW `lib/skills/convergence/skill.ts` + `knowledge.ts`: a producer skill that sees the WHOLE
  dossier (no domain filter), must cite ≥3 domains per play, anti-duplication of domain skills.
- NEW `lib/skills/domain-map.ts`: `ADJACENT_DOMAINS` + `selectAdjacentSignals()` so existing
  skills can also overlap adjacent domains (the cheaper half of convergence).
- `provider.ts`: `TIER_MODELS` + extended-thinking budget; run the convergence + synthesis pass
  on Opus + thinking, keep producers on Sonnet. `run.ts`/`pipeline.ts`: tier override + ordering.
- Risk: extended-thinking cost (~+20%/brief, measure per location); start `ADJACENT_DOMAINS`
  narrow to avoid low-signal "patterns." Open Q: small scoring boost for convergence plays?
  (decide in P2 tuning, default no.)

## P6 — Expert roster: food-pairing + guerrilla/grassroots  ·  size: MEDIUM  ·  deps: P2 (pool), P5 (convergence pattern, optional)
**Goal:** add two producer skills feeding the SAME global pool (no per-expert display cap).
- NEW `lib/skills/food-pairing/{skill,knowledge}.ts`: kitchen expert (daypart × weather ×
  seasonality × prep-speed × margin). Region/season-agnostic prose; the dossier grounds it.
- NEW `lib/skills/guerrilla-marketing/{skill,knowledge}.ts`: zero-budget hyper-local tactics
  (WOM seeding, signage, community partnerships, foot-traffic interception).
- `registry.ts`: add both. **Knowledge is CURATED, not invented** — sourced from vetted material
  (Bryan/Chris), repo principles, and real operator knowledge; never from a single forum.
- Can split into P6a (food-pairing) / P6b (guerrilla) if a window is tight.

## P7 — Evergreen insight bucket  ·  size: SMALL–MED  ·  deps: none (better after P3)
**Goal:** persist good advice; stop regenerating daily; don't re-show right after dismissal;
resurface on relevance match.
- NEW migration `evergreen_plays` (+ `evergreen_dismissals` for cooldown) with RLS.
- NEW `lib/insights/evergreen.ts` (load/save/markDismissed/getEvergreen w/ recency + relevance).
- `synthesis.ts`: dedup by `playKey`, skip recently-dismissed (cooldown ~14d), resurface on
  relevance tags. `momentum.ts` + `brief-actions.ts`: log dismissals.
- Risk: `playKey` must be stable across regenerations (skillId + title hash; version by
  knowledgeVersion). Start relevance tags narrow to avoid flooding.

## P8 — Per-operator category rerank controls  ·  size: MEDIUM  ·  deps: P2, taxonomy
**Goal:** Bryan's "most customizable" version — operators boost/reorder the categories they care
about, overriding the global priors per-location.
- NEW `lib/skills/category-priors.ts`: `CategoryPriors`, `DEFAULT_CATEGORY_PRIORS`, constraints
  (0.5–1.5), reset.
- `locations.settings.categoryPriors` (JSONB, no migration); `build.ts` loads → profile →
  `synthesis` applies as a per-location override of P2's global priors.
- NEW `app/(dashboard)/settings/category-priors-controls.tsx` (sliders, reset, save) +
  `actions.ts` server action (validate, merge) + settings page wiring.
- Risk: test BOTH model-selection and deterministic-fallback paths; UX — multipliers may be less
  intuitive than drag-to-reorder (polish later).

## P9 — Dynamic expertise feed (trends)  ·  size: MEDIUM  ·  deps: Bryan's curated sources
**Goal:** answer "can a skill learn" — make expert `knowledge` DYNAMIC via a weekly curated feed
(RAG-style refresh, not weight learning).
- NEW migration `knowledge_feeds` (skill_id, vertical, version, content, sourced_from, active
  window, status).
- NEW `lib/skills/knowledge-feeds.ts` (in-memory 1h TTL cache, graceful null).
- `prompt-kit.ts`: inject the current week's trend snippet into `systemCached` BEFORE RULES
  (inside cache prefix); tag plays with `effectiveKnowledgeVersion`.
- NEW cron `app/api/cron/ingest-knowledge-feeds` (Sun 21:00 UTC): fetch `CURATED_SOURCES`
  (Bryan maintains), Claude-summarize each to ~500-char actionable snippets, upsert.
- Guardrails: trends INFORM, never OVERRIDE operator reality (prompt rule + playbook line).

## P10 — Cross-org aggregate feedback weighting  ·  size: LARGE  ·  deps: P2
**Goal:** "many restaurants liked this TYPE → weight it higher everywhere," a second multiplier in
P2, without losing per-location personalization.
- NEW migration `play_type_feedback_aggregate` (org_id, play_type_key, verdict, count,
  confidence_score).
- NEW `lib/skills/aggregate-feedback.ts`: Bayesian smoothing, small-N guard
  (confidence < 0.5 → zero weight), modest multiplier range (0.7–1.3).
- `preferences.ts`: `recordPlayFeedback` also writes the aggregate; `computePlayTypeKey()`.
- `build.ts`/`types.ts`/`synthesis.ts`: carry + apply the weights.
- Risk: popularity collapse (everyone converges) → modest range + per-location tolerance stays
  dominant. Open Q: async daily recompute (cached, 24h lag) vs on-demand. Recommend async.

---

## Dependency graph / suggested order
P0 → P1 → **P2 (taxonomy decision first)** → P3 → P4 → **P5 (marquee)** → P6 → P7 → P8 → P9 → P10.
- Hard deps: P3, P8, P10 need P2. P5's new plays rank correctly only with P2.
- P0, P1(hours), P4, P7 are independent and can move earlier if a window favors them.
- Demo-movers (richest payoff if pressing toward a demo): P0, P1, P2, P3, P4, P5.
