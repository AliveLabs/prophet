# Insight Engine — Deep Strategy & Architecture Review (2026-06-19)

Source: full transcript of the Bryan + Chris "Ticket Insights Engine — Deep Strategy &
Architecture Review" (read in full, not Notion's bullet summary). Claims verified against
the codebase by a 7-probe parallel investigation (file:line evidence below). This doc is
the action plan; Wednesday demo is the forcing function.

## The one correction to the mental model
It is NOT purely one-to-one, but Bryan's instinct is right where it counts. The engine is
two-tier:
- **Rule layer (per-source silos):** 76 deterministic rules. social.ts → social only,
  seo.ts → seo only, content.ts → menu only. The ONLY generation-time cross-source is
  events+SEO (`lib/jobs/pipelines/insights.ts:213-237`) and a few `cross-signal.ts` rules
  (social+seo, event+visual, menu+visual).
- **Skill layer (5 producers):** local-demand, marketing, positioning, reputation,
  operations. Each receives the FULL dossier — BUT each skill's `selectInput()` FILTERS the
  dossier down to its own domain (positioning sees menu/seo; local-demand sees
  events/weather/traffic; reputation sees reviews). So no skill sees weather × menu ×
  reviews together.
- **Synthesis ("Chief of Staff", `lib/skills/synthesis.ts`):** ranks/selects/orders up to
  7 plays. It does NOT fuse signals — it picks among what the domain-siloed skills already
  produced.

**Net:** there is no component whose job is to find convergence ACROSS domains. That is the
gap that makes insights feel skin-deep. Fix is surgical (a cross-domain layer + depth), not
a rebuild.

## Confirmed findings (file:line)
1. **QSR walk-in hard rule — CONFIRMED, active bug.** `lib/skills/prompt-kit.ts:31`:
   "for a drive-thru / quick-service restaurant, never frame demand as walk-ins…"
   serviceModel auto-detected `lib/insights/dossier/build.ts:354-360`. Prompt-level absolute
   ("never") — exactly the over-indexed-feedback failure mode. Suppresses ALL foot-traffic
   plays for Raising Cane's (live AT&T Stadium example).
2. **Model/depth — CONFIRMED headroom.** Everything runs `claude-sonnet-4-5`
   (`lib/ai/provider.ts:35`), temps 0.3–0.6, **no extended thinking, no premium tier**,
   prompt caching on. `cost-levers.md` calls token budget/depth a reversible dial that is
   currently OFF. Upgrading the synthesis/convergence pass to opus + thinking is a small
   provider.ts change, not structural.
3. **Skills are extensible — CONFIRMED.** `ProducerSkill` contract + `registry.ts:11-17`;
   adding food-pairing / guerrilla experts = add to the array (auto-wired). Each skill has a
   static `knowledge` markdown playbook (`knowledge.ts`). An orchestrator that caps each
   expert to 2-3 high-conviction plays and reranks by owner-fit inserts at
   `pipeline.ts:37` between synthesize() and voicePass().
4. **Prioritization/evergreen — PARTIAL.** `WEEKLY_MAX=7` exists, but renders flat (no
   category grouping, no "insights like this →" drill-down on the brief), and **no evergreen
   bucket** — plays regenerate fresh daily, dismissed plays just hide for the day
   (`synthesis.ts`, `brief-view.tsx`, `play_actions`). Non-top candidates are discarded, not
   bucketed.
5. **Weighting/learning — CONFIRMED Bryan's claim.** All 76 rules fire equally; confidence/
   severity assigned per-rule then multiplied POST-HOC in `scoring.ts:computeRelevanceScore`
   — not weighted by importance up front. Feedback (`recalibrateTolerance`) is PER-LOCATION
   only; **no cross-org "many liked this type → weight it higher" mechanism.** Price insight
   (`content/insights.ts:83-122`) fires on a LONE signal (competitor avg cheaper) — **no
   corroboration** (reviews mentioning price), even though cross-signal corroboration exists
   for other types.
6. **Inputs — PARTIAL.** Hours + busy_times are COLLECTED into the dossier but only used for
   coverage flags, NOT gated into synthesis → engine COULD recommend lunch to a dinner-only
   spot. Vision analysis is COMPLETE but consumed only by marketing/social + weather/patio —
   **positioning skill ignores visual**, so "you carry 20+ premium whiskeys → promote it"
   can't happen. No external knowledge feed exists; skill `knowledge` is static markdown.
7. **How impact & confidence are determined — the root of the ranking problem.** Both are
   COARSE, MODEL/RULE-ASSERTED LABELS, not measured quantities. Confidence = `high|medium|
   directional` (skills) / `high|medium|low` (rules), set by the LLM/rule author, NOT
   calibrated to evidence strength or corroboration. Impact = `leverage.label high|medium|low`
   + `basisInternal` prose (LLM-authored), or `severity info|warning|critical` in rules.
   Legacy feed (`scoring.ts`): relevance = SEVERITY_BASE(90/60/30) × CONF_MULT(1.0/0.8/0.5) ×
   learnedWeight → a 0-100 number, but only 9 discrete pre-weight buckets.
   **Brief ranking (`synthesis.ts:41-47`): `score = KIND_RANK×10 + CONF_RANK`. Impact
   (leverage.label) is NOT in the score at all; a hard KIND ladder
   (prepare/capitalize 5 > ops 4 > reputation 3 > positioning 2) dominates — so a
   low-confidence "capitalize" (51) always beats a high-confidence "positioning" (23).** This
   IS the category-precedence absolute Bryan is rejecting, already in the code. The LLM
   synthesis pass can reorder, but the fallback/spine math is a category gate, and impact is
   unused. B3 replaces this.

## Action items (mine), prioritized

### Wednesday-critical (makes it visibly "smarter than the owner", kills embarrassing misses)
- **A1. Kill the QSR absolutist rule.** Rewrite `prompt-kit.ts:31` so a QSR with a lobby
  gets its OWN surge model (post-event lobby flood + drive-thru wrap→stall), and only
  drive-thru-ONLY locations skip walk-in framing. Differentiate serviceModel in
  `build.ts:354-360` (drive-thru-only vs drive-thru+dine-in). One-line-ish, unblocks Cane's.
- **A2. Add a cross-domain "convergence" pass.** New strategist skill (or widen synthesis)
  that sees the WHOLE dossier and is tasked ONLY with multi-source patterns
  (weather×menu×reviews → push fast-turn items; busy-shift×staffing-reviews, etc.). This is
  the marquee fix for skin-deep insights.
- **A3. Run A2 + synthesis on opus + extended thinking** (`provider.ts` tier override).
  Depth where convergence happens; keep producers on sonnet. Directly answers "are we too
  cheap." Depth WITHOUT A2 won't help — siloed skills can't fuse what they can't see.
- **A4. Price → corroboration + positioning.** Require corroborating evidence before a price
  play (competitor cheaper AND reviews mention price); otherwise reframe to positioning
  (quality/sourcing/atmosphere) or a loss-leader suggestion ranked lower. Kills the Wagyu
  $12.99 embarrassment. (`content/insights.ts` + positioning skill knowledge.)
- **A5. Hours gate.** Structural `hoursGate` on the dossier; never recommend a daypart the
  restaurant isn't open for. (`build.ts` + skill prompt guard.)
- **A6. Vision → positioning.** Add `visual` to the positioning skill's `selectInput()` so
  premium cues (bar selection, plating, ambiance) feed positioning/messaging plays.

### Fast-follow (right after Wednesday)
- **B1. ONE global ranked pool, then drill-down (NOT per-category quotas).** Score every
  candidate on the SAME continuous scale (importance × effectiveness × confidence ×
  learned weight, with corroboration), show the top N by score **regardless of category**,
  then offer drill-downs (by category / "more like this" / show-all). Bryan 2026-06-19:
  capping each expert/category to 2-3 would bury a genuine #2-overall below the line while a
  weaker insight from another category makes the cut — wrong model. Category is an OUTPUT of
  rank, never a gate or quota. (Producer-side: an expert may still emit only a few
  high-conviction candidates so one expert doesn't flood 40 — but that is production breadth,
  NOT a display quota.)
- **B1b. Evergreen bucket.** `evergreen_plays` store so good advice persists/resurfaces and
  isn't regenerated daily or re-shown right after dismissal.
- **B2. Expert roster.** Add food-pairing + guerrilla/grassroots-marketing experts (possibly
  split marketing traditional vs guerrilla). They feed the SAME global pool (B1); no
  per-expert display cap.
- **B3. Continuous, evidence-weighted scoring (the core redesign).** Replace the coarse
  3-bucket confidence/impact + hard kind-ladder (see finding 7) with a continuous 0-100
  weighting grounded in real factors; weight factors by importance UP FRONT, not equal-then-
  score-after. Operational plays are NOT floored/capped — they rank on merit and lead in a
  week where they genuinely out-score everything. Negativity-bias guard (mom-and-pop vs
  chain price comparisons; forum/complaint signals are loudest-negative, weight accordingly).

### V2 (Bryan flagged as V2)
- **C1. Dynamic expertise feed** (answers "can a skill learn"): scheduled job ingests vetted
  restaurant-marketing sources into a `knowledge_feeds` store (per-vertical); `buildSkillPrompt`
  injects the current feed into the expert's `knowledge` before the cached prefix. Same shape
  as today's static knowledge, refreshed daily/weekly. Bryan curating sources via Perplexity.
- **C2. Cross-org aggregate feedback.** Global insight-type weighting fed by aggregate
  thumbs-up/down, applied as a second multiplier in `scoreInsights`; guard small-N noise +
  popularity-collapse; keep per-location personalization dominant.

## Operating principle: the 0-100 scale (Bryan, 2026-06-19) — applies to BOTH how Claude
## encodes feedback AND how the engine scores insights
Default everything subjective to a POSITION on a 0-100 scale, not a 0/1 switch. "Must never"
= 0, "absolutely always" = 100; "should / shouldn't" lands somewhere in the middle and
becomes a WEIGHT, not a gate. When unsure where a directive falls, lead with a numeric guess
and ask Bryan to calibrate ("I'd weight operational ~25/100 baseline — right?").
- **Absolutes are legitimate ONLY when a real rule or fact/evidence forces them.** Factual
  example that IS a near-absolute: "don't recommend a daypart the restaurant is closed for"
  (hours are factual). Subjective example that is NOT: "operational shouldn't lead" — that's
  a ~20-30 weight, not a floor/ceiling. The QSR "never walk-ins" rule was the failure: a
  subjective theme baked as a 0.
- Push the unavoidable 0/1 absolutes DOWN to the smallest grounded primitives (e.g. "a review
  mentions price: yes/no"); let the COMPOSITION of those primitives be continuous/weighted.
  Code deals in absolutes; a weighted collection of them is reasoning.
- This is also the engine redesign principle (B3): confidence/impact should be continuous and
  evidence-grounded, and ranking should be one weighted pool — category is an output, never a
  gate.
