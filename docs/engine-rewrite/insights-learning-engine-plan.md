# Insights Learning Engine — Expert-Grounded, Continuously-Learning Plan (P11+)

Authoritative build plan that FUSES three inputs:
- **(A) Expert panel** — 4 grounded domain specs (grassroots, social counter-strategy, events
  detection/validation, evidence+calibration+writing) + a synthesized skill/data/sequencing plan.
- **(B) Learning-loop architecture** — the per-skill learnings store (3 new tables), 3 ingestion
  pipelines, 3 behavior-update channels, cadence, and anti-degradation guardrails.
- **(C) Codebase reality** — grounded against `lib/skills/*`, `lib/events/*`, `lib/social/*`,
  `lib/ask/*`, `lib/insights/dossier/*`, the feedback/scoring system, and the existing
  `insight-engine-phased-plan.md` (P0–P10).

These phases slot in **AFTER** the shipped PV + P5/P6/P7/P8 work. They are numbered **P11+** to
extend the existing plan. Each phase is self-contained, gated, and executable end-to-end by a fresh
agent or an overnight run **without further planning**.

> STATUS: PLAN ONLY (2026-06-24). Nothing here is built. Supersedes the planned-but-unbuilt **P9
> `knowledge_feeds`** and **P10 `play_type_feedback_aggregate`** — this design SUBSUMES both into one
> coherent learning system (see §2). Confirm with Bryan before diverging from those named tables.

---

## 1. North star

An **expert-grounded recommendation engine that gets sharper, more current, and lands better every
week** — the wow factor. Two halves:

1. **Expert depth (now):** every play is the work of a named domain expert (kitchen, social
   strategist, grassroots growth, local-demand analyst, decision-scientist presenter), grounded in
   real artifacts (a named partner, a verified event, a verbatim review quote), never a generic
   blurb any owner could write. "Smarter than the owner" on day one.
2. **Learning (compounds):** three signal streams — **external trends**, **click feedback**,
   **operator questions** — distill into a durable, versioned, per-skill knowledge layer that feeds
   back into the prompts and scoring. The system is **fully functional with zero learnings** (the
   curated static `knowledge` prose is the floor); learning is **pure upside**, gated so it can
   never make a brief worse or relax grounding.

The two halves are independent tracks that reinforce: the **Learning-Loop Spine** (§2) is the
foundation; the **per-skill upgrades** (§3) are the expert depth that the spine then makes
self-improving.

---

## 2. The Learning-Loop Spine (foundational — build first)

The spine is the durable infrastructure every skill plugs into. It is **additive and fail-soft**:
all new tables follow the established loose-typed-client + fail-soft-read pattern
(`lib/skills/preferences.ts`, `lib/ask/history.ts`, `lib/insights/evergreen.ts` all read
not-yet-in-generated-types tables and return empty/no-op rather than throw). **A learning-system
outage must never break a morning brief.**

### 2.1 Data model — three new tables (loose-typed pre-migration)

**Table 1 — `skill_knowledge`** (the heart: durable, versioned, distilled per-skill knowledge).
Today each `ProducerSkill` carries STATIC `knowledge` prose + a hardcoded `knowledgeVersion`
(`lib/skills/skill-types.ts`), injected verbatim into `systemCached` by `prompt-kit.ts`
(`buildSkillPrompt`, the `DOMAIN PLAYBOOK:` block). This table makes that prose the **BASE layer**
and adds DYNAMIC distilled learnings on top.

Columns: `id`, `skill_id` (registry id, e.g. `food-pairing`), `scope` (`global|org|location`),
`scope_id` (null for global; org_id/location_id otherwise), `learning_kind`
(`external_trend|feedback_pattern|question_demand|editorial`), `title`, `snippet` (the ~300-500 char
ACTIONABLE prose injected into the prompt — never raw source text), `provenance` (jsonb:
`{streams, sources:[{url|feed_id|sample_ids}], distilled_by:'model'|'human', distilled_at}`),
`confidence` (0-100, the project's calibration scale), `support_n` (sample size: # feedback rows / #
asks / # corroborating sources), `status` (`candidate|shadow|active|retired`), `knowledge_version`
(semver-ish, e.g. `food-pairing@v1.3+f7`), `active_window` (`effective_from`/`effective_to` for
time-boxed trend snippets — mirrors the P9 active-window column), `created_at`, `updated_at`.
RLS: global rows readable by all; org/location rows scoped by membership (mirror `evergreen_*` RLS).
Unique-ish on `(skill_id, scope, scope_id, learning_kind, title)`.

> SUBSUMES the planned **P9 `knowledge_feeds`** (skill_id, vertical, version, content, sourced_from,
> active window, status) — those map 1:1 onto `external_trend` rows here. Build this, not a separate
> `knowledge_feeds`.

**Table 2 — `skill_feedback_rollup`** (distilled feedback signal per skill — NOT raw events; those
stay in `brief_feedback`). One row per `(skill_id, scope, scope_id, play_type_key)`. `play_type_key`
= a stable, low-cardinality descriptor derived from a play (`skillId + kind + lead-evidence-domain +
severity-band`) — the P10 `computePlayTypeKey()`. Columns: `good_count`, `bad_count`,
severity-weighted sums, `bayes_score` (smoothed liked-rate w/ small-N guard), `multiplier` (clamped
0.7–1.3, the P10 range), `support_n`, `last_recompute`.

> SUBSUMES the planned **P10 `play_type_feedback_aggregate`**, but keyed by SKILL so it feeds the
> skill's own learning loop, not just one global multiplier. Per-location `locations.brand_tolerance`
> (recalibrated by `recalibrateTolerance` in `preferences.ts`) stays UNCHANGED and DOMINANT; this
> rollup is a second, gentler multiplier.

**Table 3 — `skill_source_registry`** (vetted external sources — promotes
`docs/engine-rewrite/p9-curated-sources.md` from a markdown seed into a managed table). Columns:
`id`, `skill_ids` (a source can feed multiple, e.g. NRA What's Hot → food-pairing + marketing),
`domain/vertical`, `url/feed`, `fetch_strategy` (`rss|scrape|scrape-browser-headers|data-api`),
`auth_kind` (`none|free-token|paid`), `trust_tier` (1/2/3 from the curated doc), `enabled`,
`last_fetch`, `last_status`, `failure_count`. Seeds directly from the curated-doc priority-1 set.

**Relationship to existing (all UNCHANGED):**
- `brief_feedback` (raw thumbs) → rolls up into `skill_feedback_rollup`.
- `ask_history` (`lib/ask/history.ts`, grounded/confidence fields) → mined into `skill_knowledge`
  `question_demand` rows.
- `CATEGORY_PRIORS` / `category-priors.ts` (P8 operator + global priors) stay the ranking bias; the
  rollup multiplier is applied ALONGSIDE them, never replacing `brand_tolerance` or per-location priors.
- `evergreen_plays` / `evergreen_dismissals` remain the per-location memory of specific plays.

### 2.2 Three ingestion pipelines (each: ingest → distill → VALIDATE → write `candidate` → promote)

**Nothing reaches a prompt until `active`.** Each produces `skill_knowledge` candidate rows that
must pass a per-stream validation gate.

**PIPELINE 1 — EXTERNAL (extends P9).** New cron `app/api/cron/ingest-knowledge-feeds` (Sun 21:00
UTC). Per enabled `skill_source_registry` row: fetch with its `fetch_strategy` (tolerate per-source
failure — one dead source never breaks the run), then Claude-summarize each item to a ~500-char
ACTIONABLE snippet tied to the skill's domain.
Guardrails: **(a)** source must be in the registry with `trust_tier` set + enabled — **no open-web
ingestion, ever** (kills "learned from one forum", the P6 anti-pattern). **(b)** adversarial distill
prompt: *"extract only durable, generalizable operator tactics; reject single-brand promos,
unverifiable claims, unattributable prices/stats, region-locked guidance"* + return self-assessed
confidence + source attribution; low-confidence/unattributable → dropped, not stored. **(c)**
corroboration: a trend asserted by ≥2 distinct tier-1 sources gets higher seed confidence; a lone
tier-3 source caps at `shadow` until corroborated. **(d)** recency: stamp `active_window`; trend
snippets expire so stale trends self-retire. **(e)** trends INFORM, never OVERRIDE (hard prompt rule
+ playbook line).

**PIPELINE 2 — CLICK FEEDBACK.** Reuses existing `brief_feedback` writes
(`preferences.ts:recordPlayFeedback`). Nightly: roll raw thumbs into `skill_feedback_rollup` by
`play_type_key` with Bayesian smoothing + small-N guard (confidence < 0.5 → zero weight → no
multiplier). Weekly: distill strong, stable patterns into `feedback_pattern` rows ("across N
locations, drive-thru-window photo-capture plays are disliked 3:1 → bias creative toward lobby/expo
shots").
Guardrails: **(a)** minimum `support_n` before any pattern distills (protects against one operator
rage-clicking). **(b)** severity-aware (the existing `applyHarmReview` 0-3 stamp rides on feedback;
only patterns consistent across severity bands distill). **(c)** confounder guard: a global-scope
pattern requires it to hold across MULTIPLE orgs; else stays org/location-scoped. **(d)** multiplier
clamped 0.7–1.3; per-location `brand_tolerance` stays dominant (popularity-collapse guard).

**PIPELINE 3 — ASK-TICKET QUESTIONS.** Reads existing `ask_history`. Nightly: route each new
question to the skill(s) whose domain it touches (reuse `domain-map.ts` `ADJACENT_DOMAINS` + a
lightweight classifier on matched evidence/category). Weekly: cluster recurring questions into
`question_demand` rows — **(a)** COVERAGE GAP ("operators repeatedly ask X and the skill never
addresses it" → candidate addition flagged for human review); **(b)** FRAMING ("follow-ups reveal
the skill's plays omit Y" → tighten the playbook).
Guardrails: **(a)** only GROUNDED, repeated questions count (`ask_history` stores grounded +
confidence; ungrounded one-offs are noise). **(b)** relevance threshold — a question must classify
to the skill above a bar or it's dropped (no billing question polluting food-pairing). **(c)**
`question_demand` rows are the MOST conservative — default `candidate`, require **human
(Bryan/Chris) promotion** (a question reveals demand, not a vetted answer — the P6 curated-knowledge
principle).

### 2.3 Three behavior-update channels (versioned + safe)

1. **KNOWLEDGE / PROMPT** (`external_trend`, `question_demand` FRAMING). New
   `lib/skills/knowledge-feeds.ts` loader (in-memory 1h TTL cache, graceful null — the P9 pattern).
   At prompt-build, fetch the skill's ACTIVE `skill_knowledge` snippets for `(skill, org, location)`
   and compose a delimited **"CURRENT TRENDS & LEARNED PRIORS (informational; never override the
   operator's own reality or the evidence)"** block, injected INSIDE the cache prefix in
   `prompt-kit.ts` AFTER the static `DOMAIN PLAYBOOK` and BEFORE `RULES:` — static playbook stays the
   spine; learnings are additive. **Cache discipline:** global-scope active snippets change ≤1×/week
   → stay in the byte-identical `systemCached` (cache key includes `effectiveKnowledgeVersion`);
   org/location snippets go AFTER the cache breakpoint in `system` so per-location learnings don't
   bust the shared 13-location morning cache. Plays stamped with `effectiveKnowledgeVersion` (base +
   short hash of active snippet set, e.g. `food-pairing@v1+f7a3`) — rides the existing
   `knowledgeVersion` field on `EnrichedRecommendation`.
2. **SCORING** (`feedback_pattern`). Apply the `skill_feedback_rollup` multiplier (0.7–1.3) in
   `synthesis.ts` as a NEW factor ALONGSIDE the category prior: `combined = base × categoryPrior ×
   playTypeMultiplier`. Add the multiplier as one new tunable constant block in `scoring-config.ts`
   (keeping the "every tunable in one file" invariant). Per-location `brand_tolerance` + operator
   category-priors stay dominant.
3. **VERSIONING + SAFETY** (all three). Staged promotion: `candidate → shadow → active → retired`.
   **SHADOW MODE** is the key safety net — a shadow snippet/multiplier is COMPUTED and LOGGED (did it
   reorder the pool? would it have changed the brief?) using the existing prior-flip instrumentation
   pattern in `synthesis.ts` (the `priorFlipped` log), but does NOT affect the served brief.
   Promotion gating: external trends auto-promote when corroborated + above confidence; feedback
   patterns auto-promote above `support_n`; `question_demand` rows require human promotion (admin UI
   in TicketAdmin). **RETIRE/ROLLBACK is instant + deploy-free** — set `status='retired'` or
   `active_window.effective_to` and the row drops from the next prompt build / score (it's data, not
   code). The static base `knowledge` in `lib/skills/<id>/knowledge.ts` is NEVER overwritten — it's
   the floor when the table is empty. **GROUNDING IS SACRED:** no learning can relax the
   GROUNDING/anti-fabrication rules in `prompt-kit.ts` or the closed `allowedEvidenceRefs` set —
   learnings add priors/priorities, never a license to invent.

### 2.4 Cadence (matched to signal velocity + the existing Vercel cron surface)

- **REAL-TIME (no cron):** click feedback CAPTURE (`brief_feedback` insert + `recalibrateTolerance`
  inline on thumb) and ask CAPTURE (`saveAsk` inline) — UNCHANGED. Capture is instant; DISTILLATION
  is batched, so a single click/question never rewrites a skill.
- **NIGHTLY (rollups + routing — cheap, deterministic, no LLM):** `skill_feedback_rollup` recompute
  (Bayesian, ~24h lag); `ask_history` → skill routing/classification.
- **WEEKLY (LLM distillation — batched for cost):** external feed ingest (Sun 21:00 UTC); feedback
  pattern distill; question-demand distill. Weekly cadence keeps the global `systemCached` prefix
  stable for a full week (cache-friendly: global learnings change ≤1×/week → the 13-location morning
  batch keeps hitting the prefix cache).
- **PROMOTION:** auto-promotions run at the end of the weekly distill; human promotions
  (question_demand, any global-scope change) happen async in TicketAdmin. Shadow-mode observation
  runs on every brief build (free — extra logging in synthesis).

### 2.5 Per-skill learning hook (opt-in)

Add an optional `SkillLearningHook` to `ProducerSkill` (`skill-types.ts`) declaring, per skill: which
streams it consumes (`external|click|ask`), its `play_type_key` lead-domain mapping, and which
`learning_kind`s it accepts into its prompt. Skills opt in incrementally; absence = today's behavior.
The hook lands in **P11** (L0); skills wire their hook as they're built/upgraded in §3.

---

## 3. Per-skill build/upgrade + learning hooks

Each skill mirrors the established producer shape (`ProducerSkill`, `buildPrompt` via `prompt-kit`,
`parse`/`coerceEnrichedPlays`, deterministic grounded `fallback`), registered in
`lib/skills/registry.ts`. New operator-facing categories wire the 3 tsc-enforced touchpoints
(`types.ts` Category enum, `scoring-config.ts` `CATEGORY_PRIORS`, `category-priors.ts`).

### 3.1 `social-counter` — NEW (Restaurant Social Strategist) · category Marketing (or own, neutral 1.0)
- **Path:** `lib/skills/social-counter/{skill,knowledge}.ts`; register in `registry.ts`.
- **Status:** NEW. Biggest product gap — the engine reads competitors on Places/reviews but has NO
  social counter-strategy; `social.*` signals only feed the generic `marketing` skill.
- **Spec:** INPUTS already in the dossier: `location.social/visual` + `competitors[].social/visual`
  (`SocialSnapshotData.recentPosts` w/ per-post like/comment/share/view + `visualAnalysis` tags;
  `SocialAggregateMetrics` w/ `engagementRate`, cadence, `postingWindowDays`). METHOD: (a) rank
  competitor posts by ENGAGEMENT RATE (eng÷followers; ÷reach where available) NOT raw likes; (b) take
  top-decile winners; (c) read the EXISTING structured `visualAnalysis` tags
  (`contentCategory|foodPresentation|visualQuality|atmosphereSignals|promotionalContent`) as the
  post-anatomy teardown — **the vision tagger is ALREADY structured** (the expert's "vibrant colors
  broken" claim is STALE; `lib/social/visual-analysis.ts` returns discrete tags); (d) cluster winners
  into the competitor's winning pattern; (e) diagnose weakness (format/cadence gaps, over-polished,
  no human/owner content); (f) emit 1-3 counter-plays scored on (targeted engagement-rate) ×
  (phone-producibility) × (channel discovery weight, Reels/TikTok > static) × (operator fit). Play
  shape: `{competitorEvidence:[{postUrl,format,engagementRate,whyItWorked}], counterMove:{type:
  'attack-weakness'|'appropriate-mechanic'|'own-whitespace', format, hookOrCaption, shotList[],
  suggestedPostTime, trendingSoundOptional}, rationale, score}`. GUARDRAILS: require ≥1 cited
  competitor post or suppress; counter, don't clone; degrade to "own the neglected channel" whitespace
  when competitor social is thin; honor evergreen dismissal/resurface + category rerank.
- **Learning hooks:** EXTERNAL — social/short-form benchmark sources (Rival IQ / Socialinsider /
  DashSocial F&B benchmarks) → `external_trend` snippets ("carousels lead F&B at ~0.55%; posts with
  people ~44% better"); validation = trust-tier + corroboration. CLICK — `play_type_key` lead-domain
  `social`; rollup learns which counter-move types operators act on. ASK — questions about social/
  posting/competitors route here → coverage gaps.

### 3.2 `grassroots-growth` — UPGRADE (existing P6 guerrilla skill) · category Grassroots
- **Path:** `lib/skills/guerrilla-marketing/{skill,knowledge}.ts` (the deployed P6 skill). **Do NOT
  build a second skill.** Depends on the new partner-entity catalog (§4.1).
- **Status:** UPGRADE — from a generic-advice emitter ("partner with local businesses", "make one
  zero-budget move") into an entity-grounded play generator.
- **Spec:** (A) READ a new dossier section `partnerEntities` (§4.1) tagged by type
  (school/PTA, youth-sports, church/booster, gym, office/coworking, hospital, hotel, dealership,
  theater, brewery, farmers-market) with distance + audience-size proxy, plus the existing
  `demandCalendar.events` (Events Impact Engine output) for dated windows. (B) EMIT archetypes, each
  REQUIRING a concrete anchor or it does NOT fire: `spirit_night` (named school/PTA + 2-4hr weeknight
  window + 15-20% donation + projected donations/incremental sales scaled by check-avg & org size from
  the $800-1,500/40-60-families benchmark + attribution method); `catering_lunch_driver` (named
  office/hospital cluster + a weekday-lunch softness signal from `busyTimes`; decision-maker role +
  standing-order/sampler offer + mention/code attribution); `reciprocal_partner` (named complementary
  neighbor + cross-promo + press hook); `event_activation` (dated event from feed + QR-capture + lead
  time + redemption code); `earned_media_stunt` (lowest-scored, gated on operator social capacity).
  (C) SCORING: borrowed-distribution leverage × proximity/fit × effort-feasibility × measurability;
  **SUPPRESS any play that can't name an entity or dated window** (the core upgrade); penalize generic
  chamber/flyer. (D) EVIDENCE: cite why-this-entity (distance/overlap/daypart signal) + expected
  economics + attribution mechanism. Keep the number-free deterministic fallback; new archetypes only
  fire when the catalog is populated.
- **Learning hooks:** EXTERNAL — LSM / fundraiser-econ sources → `external_trend` ("spirit-night
  return ~32% within 60d" as a prior, never a fabricated figure). CLICK — `play_type_key` lead-domain
  `grassroots` by archetype; rollup learns which archetypes land per scope. ASK — partnership/event
  questions route here. (Future: redemption results loop, §4.6, closes a per-location cohort learning.)

### 3.3 `local-demand` (events validation gate) — UPGRADE
- **Path:** NEW `lib/events/validate.ts`; edits to `lib/events/relevance.ts` (density-scaled
  thresholds), `lib/events/density.ts` (replace competitor-count proxy), `lib/events/impact.ts`
  (baseline-confidence gate), `lib/jobs/pipelines/events.ts`; consumed by
  `lib/skills/local-demand/skill.ts`. Needs a fixtures dataPull + likely a fixtures-table migration.
- **Status:** UPGRADE. Existing: `venue-catalog.ts` matches events to a stable `place_id` and upgrades
  magnitude; `relevance.ts` assigns role by fixed 0.5/3.0mi; `impact.ts` runs the correct 3-way-OR
  materiality test vs the location's own popular-times curve.
- **Spec:** **R1 VALIDATE-then-rank** — add `validate.ts` gate before an event drives demand
  reasoning: resolve to stable venue identity via `venue-catalog.matchEventToCatalog` (carry
  `venue_confidence` = `matched_place_id|geocoded_only|unresolved`; `unresolved` may NEVER claim local
  impact); for SCHEDULED-LEAGUE events cross-check the listing against an authoritative fixture table
  (seed FIFA WC2026 104-match table from `openfootball/worldcup.json`, §4.2), drop/downgrade to
  `metro_hook` on venue OR date mismatch; dedupe by `(venue_id, local_date, normalized_title)`;
  surface only validated fields `{canonical venue, venue_id, authoritative local_start, fixture_ref}`
  and template skill copy strictly from these (**kill free-text title interpolation** — the World Cup
  mis-location/mis-dating bug). **R2 DENSITY-SCALED radius** — make `relevance.ts` thresholds a
  function of true density (dense_urban 0.3/1mi, suburban 0.5/3, rural 0.75/5) from real population/
  road context, not `density.ts`'s saturating 0.5mi competitor count (caps at the Places 20). **R3
  tighten `impact.ts`** — gate the relative door on baseline-curve presence (flag lower confidence
  instead of silently falling back to absolute-only); use the authoritative kickoff time for
  `daypartOverlap`; output must read as incremental ÷ own-baseline so the same event inverts sign
  (lift a 150/day indie, suppress for Cane's).
- **Learning hooks:** the Events Impact Engine already has its own correctness loop; for the learning
  spine, EXTERNAL local-demand sources (NOAA climate, BLS) feed `external_trend` priors; CLICK
  lead-domain `demand`. (Fixture/venue validation is a correctness gate, not a learned prior.)

### 3.4 `presenter` — NEW meta-skill + calibration upgrades (decision-science / data storytelling)
- **Path:** NEW `lib/skills/presenter.ts` wired into `lib/skills/pipeline.ts` BETWEEN `synthesize()`
  and `voicePass()`; a WRITE step in `lib/skills/synthesis.ts`; `evidence-format.ts` demoted to
  fallback-label-only; new `evidence[]` field on `EnrichedRecommendation` in `types.ts`; gates in
  `lib/eval/checks.ts`; constants in `scoring-config.ts`.
- **Status:** NEW pass + UPGRADE of synthesis/scoring/checks. Pure quality — no new data. Highest
  leverage across ALL producers (makes everything already shipping read as "smarter than the owner").
- **Spec — A. PRESENTATION PASS (`presenter.ts`, after synthesize, before voice):** (1) `toRelative(busyTimes)`
  reducer → "12% slower than your Friday peak, so you can cut one closer"; strip internal numerics
  (`combinedScore`/`leverage.basisInternal`). (2) `resolveEvidence(play, dossier)` keyed off
  `insight_type` → returns the REAL artifact (verbatim `ReviewSentiment.themes[].examples[]` quote —
  **already captured in `lib/insights/reviews/sentiment.ts`, persisted in `evidence.examples`, never
  reaching the card** / event name+date+venue / competitor menu line) into a new optional
  `EnrichedRecommendation.evidence:{quote?,source,sourceUrl?,asOf?,relativeStat?}[]`; quote must
  byte-match the stored example (no paraphrase) + pass `buildRefIndex` grounding. (3) Drop any
  `relativeStat` with no paired action.
  **B. SYNTHESIS WRITE step (`synthesis.ts`):** today synthesis is SELECT+ORDER only ("Do NOT edit the
  plays"), so fused multi-signal plays read as stapled fragments. Add a bounded WRITE that runs ONLY on
  fused/multi-ref plays (single-signal plays keep producer copy untouched, preserving grounding):
  names the through-line, leads with the strongest signal, narrows to one signal if they don't
  connect; deterministic keep-best fallback.
  **C. CALIBRATION (`scoring-config.ts` + `checks.ts`):** add a RecKind-agnostic `stance`
  (`fix|capture|maintain`) on each play. For `stance='maintain'`, gate `impact:'high'` on ≥1 failure
  signal (negative trend / complaint theme / competitor-encroachment ref) via a new
  `FAILURE_REF_PATTERNS` list + `MAINTAIN_IMPACT_CAP`; absent that, cap at `IMPACT_SCORE.low` (so "keep
  replying to reviews" can't outrank a real problem); where present, score by **risk-of-stopping**.
  Counts become RATES: count-based evidence carries `rate={numerator,denominator,pct}` ("3 of your
  last 20 reviews (15%)"). `checks.ts` gains 3 deterministic gates: (1) no customer-facing raw internal
  score; (2) every count accompanied by its denominator from the same rule's evidence; (3) a
  `stance='maintain'` `impact:'high'` play must carry a failure-signal ref. Confidence stays the
  high/medium/directional enum, never a raw score.
  All new model passes degrade to grounded keep-best fallback (matching `synthesis.ts`/`voice.ts`).
- **Learning hooks:** ASK FRAMING `question_demand` rows can tune presenter phrasing
  (`editorial`-kind snippets), human-promoted only.

---

## 4. Data pulls to add

| # | What | Source + reuse | Why | Migration? |
|---|---|---|---|---|
| 4.1 | **Partner-entity catalog** — nearby NON-competitor entities (schools/PTA, youth-sports, churches/boosters, gyms, offices/coworking, hospitals, hotels, dealerships, theaters, breweries, bakeries, farmers-markets) w/ distance + coarse audience-size proxy (enrollment band, headcount/SQFT proxy, venue capacity). | **REUSE** `lib/events/venue-catalog.ts` geocode-cache + `searchNearby` (already sweeps schools/universities/parks). Add a sibling partner-type taxonomy; persist a `partner_catalog` table (mirror `location_density`/`venue_catalog` cache + quarterly refresh). New `dossier.partnerEntities` section. | Gating dependency for grassroots' `spirit_night`/`catering_lunch_driver`/`reciprocal_partner` archetypes — the single biggest unlock for grassroots being "smarter than the owner". | **YES** (`partner_catalog` table) — Bryan runs via `scripts/db/sql.mts`. |
| 4.2 | **Authoritative scheduled-event fixtures** keyed by (competition, venue, local date, kickoff) — seed FIFA WC2026 104-match table (16 host venues, local kickoffs); generalize later to NFL/NBA/MLB/NHL/MLS/NCAA. | Public-domain `openfootball/worldcup.json` (or `worldcupapi.com`); cross-ref to `venue_catalog.place_id` via existing `KNOWN_ALIASES` rebrand map (AT&T → Dallas Stadium). | R1 of the events gate: the WC mis-location happened because the engine trusts the scrape + geocodes the title. | **YES** (`fixtures` table). |
| 4.3 | **Per-competitor social sub-dossier** — last 30-90d posts/handle (IG/TikTok/FB) w/ per-post timestamp, format, caption, like/comment/save/share/view, media URL + follower count for rate normalization. | **ALREADY PULLED** — Data365 via `lib/jobs/pipelines/social.ts`, normalized into `SocialSnapshotData` (`recentPosts` + `aggregateMetrics`). No new vendor; the gap is a CONSUMING producer (§3.1). | social-counter needs per-post engagement to rank by rate + run the teardown. | No. |
| 4.4 | **Minor social vision tag additions** — people-present (bool), owner/staff-present, steam/motion, video trending-sound flag + first-frame. | **EXTEND** the existing Gemini tagger `lib/social/visual-analysis.ts` (already structured — NOT "vibrant colors"). Additive fields to `SocialPostAnalysis` + the prompt. | Closes the post-anatomy teardown's last cluster dimensions (posts w/ people ~44% better). | No. |
| 4.5 | **True local population/road density** — Census tract/block-group density, or a drive-time isochrone's reachable population. | US Census API (free key) for tract density, OR a routing/isochrone provider for drive-time polygons. Replaces the saturating competitor-count proxy in `density.ts`. | R2 of the events gate. | Needs a **KEY decision** (Census free vs paid isochrone) — §7. |
| 4.6 | **Grassroots attribution/redemption loop** — unique promo codes / QR+UTM / order links / "mention X" redemptions tied back to each play. | Engine generates code per play; redemption capture is a NEW write-back surface (operator marks executed + result, or order-link integration). | Closes the grassroots per-location cohort learning (validates the ~32%-return benchmark). | **YES** (new table) + a new operator-facing **UI** — sequence LAST. |

---

## 5. Feature / presentation changes (kill internal scores → relational + "so what")

All enforced by the §3.4 presenter pass + `checks.ts` gates:
- **Evidence = the REAL artifact, not a category chip.** Render `EnrichedRecommendation.evidence[]`
  (verbatim review quote / event name+date+venue / competitor menu line + as-of + sourceUrl) inline on
  the brief card + detail page. Demote `evidence-format.ts` (`humanizeRef`/`distinctDomains`) to a
  fallback label. Verbatim quotes are already captured (`ReviewSentiment.themes[].examples[]`) — pure
  plumbing.
- **Numbers become RELATIONAL with their "so what"** — "12% slower than your Friday peak, so you can
  cut one closer", never the raw busy-times index or `combinedScore`. Every surfaced `relativeStat`
  must pair with an operational consequence or the presenter drops it.
- **Counts become RATES with a denominator** — "3 of your last 20 reviews (15%) cite slow service",
  not "2 reviews". Enforced by a `checks.ts` gate.
- **Maintain plays get impact = risk-of-stopping, gated on evidence-of-failure** — "keep replying to
  reviews" caps at low impact unless a failure signal (negative trend / complaint / competitor
  encroachment) is present, so it can't outrank a real problem.
- **Fused multi-signal plays get ONE coherent sentence** (the synthesis WRITE step); single-signal
  plays keep their grounded producer copy untouched.
- **Grassroots plays surface as partner-named playbooks** — named anchor + why-it + exact ask/offer +
  who distributes it + projected economics + copy-paste outreach script to the decision-maker +
  built-in attribution code + lead time. Suppress any lacking a named entity or dated window.
- **Social-counter plays surface with cited competitor-post evidence** + a counterMove (attack-
  weakness | appropriate-mechanic | own-whitespace) w/ a phone-shootable shot list, caption hook,
  suggested post time, optional trending sound.
- **Events copy templated strictly from validated fields** `{canonical venue, venue_id, authoritative
  local start, fixture_ref}`; free-text event-title interpolation removed.

---

## 6. SEQUENCING — turnkey phases (highest-confidence / most directionally-correct first)

After the shipped PV + P5/P6/P7/P8. Each phase: WHAT to build · FILES/AREAS · MIGRATION? (agent runs
via `scripts/db/sql.mts` — **but verify the prod target is `triodvdspdsuudooyura`, NOT the stale
`eguflqjnodumjbmdxrnj`; the agent shell CANNOT run prod migrations — Bryan runs those**) · GATE.

> Two tracks interleave: **expert depth** (correctness/quality, no new infra — go first) and the
> **learning spine** (infra — lands once thumbs UI is live, the critical-path dependency below).

### Phase P11 — `presenter` pass + calibration gates  ·  EXPERT-DEPTH  ·  highest confidence
- **Build:** §3.4 in full — `presenter.ts`, the synthesis WRITE step, `evidence[]` on
  `EnrichedRecommendation`, the 3 `checks.ts` gates, `stance`/maintain scoring + `rate`.
- **Files:** `lib/skills/presenter.ts` (new), `lib/skills/pipeline.ts`, `lib/skills/synthesis.ts`,
  `lib/skills/scoring-config.ts`, `lib/skills/types.ts`, `lib/skills/evidence-format.ts`,
  `lib/eval/checks.ts`; card/detail render in `app/(dashboard)/home/*`.
- **Migration:** NO.
- **Gate:** `tsc` clean · unit tests (relative-framing, evidence byte-match grounding, the 3 gates,
  maintain-cap) · `next build` · a real brief renders verbatim review quotes inline + relational
  phrasing + no raw internal score; model failure degrades to grounded keep-best.

### Phase P12 — `social-counter` producer + vision schema additions  ·  EXPERT-DEPTH  ·  high confidence, data present
- **Build:** §3.1 producer (mirror the guerrilla/food-pairing shape) + register + wire its category;
  in parallel the §4.4 additive vision tags.
- **Files:** `lib/skills/social-counter/{skill,knowledge}.ts`, `lib/skills/registry.ts`,
  `lib/skills/types.ts` (Category), `lib/skills/scoring-config.ts` (CATEGORY_PRIORS),
  `lib/skills/category-priors.ts`; `lib/social/visual-analysis.ts` + `lib/social/types.ts`.
- **Migration:** NO.
- **Gate:** `tsc` · unit tests (rank-by-engagement-rate not likes; ≥1-cited-post-or-suppress;
  thin-social → whitespace play; honesty/zero-play) · `next build` · a live brief for a location with
  a tracked competitor surfaces a counter-play citing a real competitor post.

### Phase P13 — Events validation gate (R1/R3) + WC2026 fixtures  ·  EXPERT-DEPTH  ·  fixes a live bug
- **Build:** §3.3 R1 (`validate.ts` stable-venue resolution + dedupe + WC2026 fixture cross-check) +
  R3 (baseline-confidence gate, authoritative kickoff). Seed the `openfootball` fixture table. Template
  skill copy from validated fields only. Defer R2 density-source swap (key decision → P17).
- **Files:** `lib/events/validate.ts` (new), `lib/events/impact.ts`, `lib/jobs/pipelines/events.ts`,
  `lib/skills/local-demand/skill.ts`; fixtures loader/seed.
- **Migration:** **YES** (`fixtures` table) — Bryan runs. Build behind a graceful no-op so the gate
  degrades to today's behavior until the table exists.
- **Gate:** `tsc` · unit tests (venue/date mismatch → drop/downgrade to metro_hook; unresolved → never
  local; dedupe; copy templated only from validated fields) · `next build` · a WC2026 match surfaces
  ONLY for the location whose catalog venue == the fixture venue, on the fixture's local date.

### Phase P14 — Learning Spine L0: `skill_knowledge` + `skill_source_registry` + knowledge loader + EXTERNAL pipeline  ·  SPINE
- **Build:** §2.1 tables 1 + 3; §2.5 `SkillLearningHook` on `ProducerSkill`; `lib/skills/knowledge-feeds.ts`
  loader (1h TTL, graceful null); `prompt-kit.ts` "CURRENT TRENDS & LEARNED PRIORS" injection
  (cache-disciplined); plays stamped with `effectiveKnowledgeVersion`; Pipeline 1 cron
  `app/api/cron/ingest-knowledge-feeds` (Sun 21:00 UTC) w/ per-source fetch_strategy + adversarial
  distill + corroboration/trust-tier validation; seed `skill_source_registry` from the curated-doc
  priority-1 free/RSS set. **This IS P9, generalized for all 3 streams.**
- **Files:** `lib/skills/knowledge-feeds.ts` (new), `lib/skills/prompt-kit.ts`,
  `lib/skills/skill-types.ts`, `lib/skills/run.ts` (version stamp),
  `app/api/cron/ingest-knowledge-feeds/route.ts` (new), `vercel.json` (cron), `scripts/db/sql.mts`
  (migration SQL + seed).
- **Migration:** **YES** (`skill_knowledge`, `skill_source_registry`) — Bryan runs against
  `triodvdspdsuudooyura`. Loader returns null gracefully until then (floor = today).
- **Gate:** `tsc` · unit tests (loader null-safe when table empty; cache key includes version; trends
  block injected AFTER playbook BEFORE rules; grounding rules untouched) · cron dry-run distills ≥1
  `active` external_trend from a seeded tier-1 source; an empty table leaves the brief byte-identical
  to today.

### Phase P15 — Learning Spine L1: `skill_feedback_rollup` + synthesis multiplier  ·  SPINE  ·  ⚠️ gated on thumbs UI
- **Build:** §2.1 table 2; Pipeline 2 nightly rollup (Bayesian + small-N guard) + weekly
  feedback_pattern distill; §2.3 channel 2 multiplier (0.7–1.3) as a third clamped factor in
  `scoring-config.ts`, applied in `synthesis.ts` alongside the category prior. **This IS P10, keyed by
  skill.**
- **Files:** `lib/skills/preferences.ts` (rollup write + `computePlayTypeKey()`),
  `lib/skills/scoring-config.ts` (multiplier constant block), `lib/skills/synthesis.ts` (apply),
  nightly/weekly cron jobs.
- **Migration:** **YES** (`skill_feedback_rollup`) — Bryan runs. Multiplier defaults 1.0 below
  support_n.
- **⚠️ CRITICAL-PATH DEPENDENCY:** `brief_feedback` WRITES exist in `preferences.ts` but the **THUMBS
  UI is still pending wiring** ("the UI wires the thumbs later"). The click-feedback stream is **dark**
  until thumbs ship. The rollup/distill/multiplier infra can be BUILT ahead (and shadow-tested), but
  **won't compound until thumbs are live.** Flag to Bryan — wire thumbs UI to activate this stream.
- **Gate:** `tsc` · unit tests (small-N → zero weight → multiplier 1.0; clamp 0.7–1.3; `brand_tolerance`
  stays dominant; global pattern requires multi-org support) · with seeded feedback, a strong stable
  pattern produces a clamped multiplier that nudges (never inverts) rank.

### Phase P16 — Grassroots upgrade + partner-entity catalog  ·  EXPERT-DEPTH  ·  needs the catalog dataPull
- **Build:** §4.1 `partner_catalog` (reuse `venue-catalog` Places infra + a partner-type taxonomy) →
  `dossier.partnerEntities`; then §3.2 entity-grounded archetypes in the existing guerrilla skill.
- **Files:** `lib/events/venue-catalog.ts` (extend taxonomy) or a sibling `lib/local/partner-catalog.ts`,
  `lib/insights/dossier/{types,build}.ts` (partnerEntities section),
  `lib/skills/guerrilla-marketing/{skill,knowledge}.ts`; `scripts/db/sql.mts` (catalog table).
- **Migration:** **YES** (`partner_catalog`) — Bryan runs. New archetypes only fire when populated;
  number-free fallback otherwise.
- **Gate:** `tsc` · unit tests (each archetype fires ONLY with a named anchor or dated window;
  suppression of entity-less plays; benchmark economics scaled by check-avg, never fabricated) ·
  `next build` · a live build for a location with a populated catalog surfaces a `spirit_night` naming
  a real nearby school + a copy-paste outreach script.

### Phase P17 — Learning Spine L2/L3 + last-mile data infra  ·  SPINE + last  ·  needs human-promotion UI + key/UI decisions
- **Build:** L2 — Pipeline 3 (`ask_history` → skill routing nightly + `question_demand` weekly
  distill) + the TicketAdmin promotion UI (candidate→active, human-gated). L3 — shadow-mode
  before/after instrumentation in `synthesis.ts` (reuse the `priorFlipped` log pattern) +
  auto-promotion at end of weekly distill. Plus deferred data infra: events R2 true-density source
  (§4.5, after the Census/isochrone key decision) and the grassroots attribution/redemption write-back
  loop (§4.6).
- **Files:** `lib/ask/history.ts` (routing read), distill cron, `app/(admin)/.../knowledge-review`
  (TicketAdmin UI), `lib/skills/synthesis.ts` (shadow logging), `lib/events/density.ts` (R2),
  redemption table + operator UI.
- **Migration:** **YES** (question_demand rides `skill_knowledge`; redemption table is new) — Bryan runs.
- **Gate:** `tsc` · unit tests (question_demand defaults `candidate`, never auto-promotes; shadow rows
  logged but never affect served brief; auto-promotion only on corroboration/support_n) · a
  question_demand row appears in TicketAdmin for human promotion; a shadow multiplier logs a would-be
  reorder without changing the brief.

**Dependency notes:** P11–P13 are pure-quality / correctness and can run in any order tonight. P14
(spine L0) is independent of the thumbs UI and safe to build (floor = today). P15 is BUILDABLE ahead
but DARK until thumbs UI ships. P16 gates on the partner_catalog. P17 is last (new UI + key decisions).

---

## 7. NEEDS-BRYAN flags

- **Migrations (agent shell CANNOT run against prod):** `fixtures` (P13), `skill_knowledge` +
  `skill_source_registry` (P14), `skill_feedback_rollup` (P15), `partner_catalog` (P16),
  redemption table (P17). Each built behind a graceful no-op so the feature degrades to the floor
  until the migration runs. **Verify the target is `triodvdspdsuudooyura`, NOT the stale
  `eguflqjnodumjbmdxrnj`.**
- **Thumbs UI is the critical-path dependency for the click-feedback stream (P15).** The
  `brief_feedback` writes + `recalibrateTolerance` exist, but the thumbs UI is unwired — the stream is
  dark until it ships. Build P15 infra ahead; wire thumbs UI to activate it.
- **True local density source (events R2, §4.5):** decision — free **US Census API key** (tract
  density, recommended for v1) vs a **paid isochrone provider** (drive-time polygons). Deferred to P17
  so it doesn't block the P13 correctness fix. Guess: Census free for v1.
- **PredictHQ (paid events source):** the curated doc's single best local-demand events driver, but
  the Events Impact Engine + WC2026 fixtures already cover events. Guess: **defer to v2.** NOAA CDO
  (free token) is the cheap add if a weather/climate prior is wanted.
- **Open calibration decisions (lead-with-a-guess, weights to tune not binary calls):** feedback
  multiplier range — guess **0.7–1.3** (matches P10); global-scope promotion — guess **require human
  review for the first N weeks, then relax**; `question_demand` auto-promotion — guess **NEVER auto**
  (curated-knowledge principle, P6); importance factor in scoring — guess **stay neutral** until an
  evidence signal exists.
- **STALE-SPEC CORRECTION (no action needed, recorded so a fresh agent doesn't chase it):** the social
  expert's claim that the vision pass "fails / returns vibrant colors" is NOT true — `visual-analysis.ts`
  already returns a structured discrete-tag schema. The social gap is the missing PRODUCER (P12), not
  broken vision; treat vision work as minor additive fields (§4.4).
