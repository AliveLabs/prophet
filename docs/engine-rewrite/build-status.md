# Engine rewrite — build status (2026-06-04, autonomous session)

Honest ledger of what is REAL and TESTED vs. what is gated on the live environment (keys, the Supabase
branch, spend). No placeholders in the product code; the only "fakes" are test mocks/fixtures, which is
normal engineering. **93 unit tests pass (75 pre-existing + 18 new); the new files are type-clean.**

## Real and tested now (no live calls, fully deterministic)

| Piece | File(s) | What it is |
|---|---|---|
| **Provider abstraction** | `lib/ai/provider.ts` | `generateStructured(req, {transport, validate, fallback})`; tiers: reasoning→Claude (Messages REST, model id from env), cheap→Gemini (reuses existing wrapper). Transport is injectable (mock in tests; Gateway can drop in later). |
| **Dossier contract** | `lib/insights/dossier/types.ts` | The single context object every skill reads: tier caps, profile (voice + operator capability), per-entity signals wired to the real provider types, demand calendar, all 76 rule outputs. `buildRefIndex` = the grounding/anti-fabrication backbone. |
| **Skill system** | `lib/skills/{skill-types,prompt-kit,run,registry}.ts` | Producer-skill contract; shared prompt scaffolding (no-exec + grounding + dual-voice + schema + closed allowed-refs); `runProducerSkill` (validate→fallback, stamps id, GROUND-FILTERS ungrounded plays, failure-isolated); parallel fan-out. |
| **Real skills (2)** | `lib/skills/local-demand/*`, `lib/skills/positioning/*` | Local-Demand (events+weather → prepare+capitalize) and Positioning/Pricing (value entry point, no price war), each with a real domain playbook + grounded, number-free deterministic fallback. |
| **Synthesis (Chief-of-Staff)** | `lib/skills/synthesis.ts` | Selects/orders to 1-3 plays (subtractive, forward-demand-first, no diversity quota), writes headline+deck; deterministic fallback ranking; never edits recipes (grounding preserved). |
| **Dual-voice pass** | `lib/skills/voice.ts` | Deterministic scrub guarantees brand compliance (no em dashes, de-jargoned narrative; restaurant voice for customer copy). Always safe to ship; model tone-enhancement can layer on later. |
| **Eval harness** | `lib/eval/{checks,voice-rules,judge}.ts` | Deterministic CI checks (enums, recipe completeness, no-executable-fields, evidenceRefs-resolve, numbers-trace/anti-fabrication, voice lint) + LLM-as-judge scaffold + the gate (`passesGate`). |
| **Golden set** | `tests/fixtures/dossiers/{arena-week,patio-weather,quiet-week}.ts` | Three real manufactured dossiers. Cross-scenario test proves the engine yields grounded/eval-clean/voice-clean briefs (arena, patio) and an honest quiet brief (quiet). |

**Proven behaviors:** grounded output only (fabricated refs are dropped; numbers must trace to evidence);
full-fallback resilience (every model call can fail and the brief is still real + grounded); honest quiet
week; brand-voice compliance guaranteed.

## Gated on the live environment (NOT done headless — needs keys / Supabase branch / spend)

- **Dossier BUILDER** (`lib/insights/dossier/build.ts`, not yet written): assemble a real dossier from the
  Supabase branch (reusing the query patterns in `lib/jobs/pipelines/insights.ts`). Code can be written next;
  running it needs the branch.
- **Wire the funded data:** Outscraper on our own location (own foot traffic), review-sentiment pass, menu-tag
  extraction. Real adapters; live verification needs keys.
- **Live Claude:** set `ANTHROPIC_API_KEY` (+ optional `ANTHROPIC_MODEL`); then the reasoning tier runs for real.
- **Quality gate:** run the LLM-as-judge over the golden set vs the legacy baseline; flip `SKILLS_ENABLED`
  only when it clears the bar. Needs live model calls (cost).
- **More skills** (Marketing, Reputation, Operations, Value/ROI): the registry + harness are ready; each needs
  a real playbook (ideally Bryan/Chris domain review) + a fixture to ground its fallback.
- **Async precompute** (Phase 0) + **v5 UI converged into the app** wired to real brief output.

## Suggested next steps when you're back
1. Confirm `ANTHROPIC_API_KEY` is available → I wire live Claude + run the judge over the golden set.
2. Greenlight the dossier builder against the Supabase branch → first real dossier from live data.
3. Domain-review the two skill playbooks + tell me the next skills to author for real.
4. The cost sensitivity model (offered earlier) if you want the headroom numbers as a dial.

---

## UPDATE — LIVE end-to-end VERIFIED (2026-06-04, Claude key in place)

The full engine ran against the **real Supabase branch + real Claude** and produced a grounded,
eval-clean, voice-clean brief for Wagyu House Atlanta — referencing actual events from the data
(Tequila Fest, Canada Fest, a Cinco de Mayo bar crawl) with recipe-level plays (a wagyu lunch/taco
special incl. customer-voice caption + creative direction, a late-night window play with Google
Business hours updates, prepare/staffing plays).

- 4 producer skills now real: **local-demand, positioning, marketing, reputation** (reputation idles
  until review signals are present in the dossier).
- Live run via `npx vitest run --config vitest.integration.config.ts` (read-only Supabase + Claude).
- Model id `claude-sonnet-4-5` confirmed working.

**Two real bugs caught by running live** (deterministic fallback had masked them):
1. `extractJson` only handled objects, not Claude's JSON **arrays** (+ markdown fences) -> producer
   skills silently fell back. Fixed (array + fence aware).
2. The numbers-trace anti-fabrication check was over-scoped — it flagged **suggested** offer prices
   (a recommended special) as fabrications. Re-scoped to stated factual quantities (`leverage.reach`);
   prose grounding is the LLM-judge's job. Fixed.

Also fixed: bumped Claude `max_tokens` 4096 -> 8192 and added input-token discipline to local-demand
(truncation was causing its fallback).

**Status: the real engine is proven end-to-end on live data + live Claude, eval-gated.** Remaining for
the tester build: wire the funded data (own foot traffic, review sentiment -> activates reputation +
enriches; menu tags), the eval-judge gate vs baseline, async precompute, and the v5 UI converged onto
real brief output. 98 unit tests green; new files type-clean. Nothing committed to git.

---

## UPDATE — EVAL-JUDGE GATE built + live-verified (2026-06-04)

The gate is the "is this $300-worthy?" instrument. Built: `lib/eval/baseline.ts` (legacy brief from the
dossier's existing recommendations, to beat), `lib/eval/gate.ts` (`runEvalGate` + `dossierSummary`),
live judge wiring in `lib/eval/judge.ts` (`defaultJudgeGenerate` via Claude, tolerant parse) +
`claudeRaw`/`extractJson` exported from the provider. Unit-tested with a mock judge (3 tests); live-run
over the competitive-week fixture.

**LIVE scorecard (new engine vs legacy baseline, judged by Claude):**
- New engine overall **4.25** (specificity 5, non-obvious 4, actionable 5, grounding 3)
- Legacy baseline overall **1.75** (specificity 1, non-obvious 2, actionable 1, grounding 3)
- Gate: **FAIL** — 1 tone-deaf play flagged (maxToneDeaf=0): "Launch a Wagyu Lunch Plate to neutralize
  Bachi Box's price advantage."

**Read:** the rewrite is dramatically better than today's output (measured, +2.5), AND the gate is strict
enough to block a brief with a tone-deaf play or weak grounding from reaching a tester. Exactly the
flywheel we wanted: the gate now tells us what to fix.

**Next quality work the gate surfaced:** (1) calibrate "tone-deaf" with Bryan/Chris (is a value lunch
plate actually off-brand for a premium steakhouse? founders' call — calibrates the judge); (2) tighten
grounding faithfulness (3/5 -> the skills over-claim; tighten prompts or filter low-grounding plays);
(3) consider a cheap "no-harm reviewer" pass that drops tone-deaf plays pre-synthesis (premortem R-prod-4).
103 unit tests green; new files type-clean. Nothing committed to git.

---

## UPDATE — Graduated brand-fit review + GATE PASSES (2026-06-04)

Implemented Bryan's graduated tone-deaf model: a brand-fit reviewer (`lib/skills/safety-review.ts`) scores
each candidate play 0-3 for tone-deaf/off-brand severity; the engine acts on a gradient — **3 severe = drop,
2 moderate = force confidence to directional, 1 mild = nudge down a step, 0 = keep**. Wired into the real
engine entry point `lib/skills/pipeline.ts` `runBrief` (producers -> brand-fit review -> synthesis -> voice).
Also tightened the Positioning skill (`lib/skills/positioning/*`): a premium/upscale place answers an
undercut with QUALITY, never a cheap value plate (Bryan confirmed the wagyu-lunch-plate play was off-brand).

**LIVE gate re-run (competitive-week, via runBrief): new engine 4.50 (spec 5 / non-obvious 4 / actionable 5
/ grounding 4) vs legacy 1.75 -> GATE PASS** (0 tone-deaf, +2.75 margin). Grounding rose 3->4 from the
tighter prompts; the off-brand play no longer generated, so nothing needed dropping this run (reviewer is the
backstop for when it does). 104 unit tests green (added safety-review + runBrief tests); type-clean.

**Note:** the LLM judge is non-deterministic run-to-run; the gate + graduated reviewer handle the variance
(a borderline play gets downgraded, not shipped). Next: wire the funded data (own foot traffic, review
sentiment -> activates reputation, menu tags), then async precompute + v5 UI on real brief output.

---

## UPDATE — FULL ROSTER + FUNDED DATA + PERSISTENCE (2026-06-04)

Built the rest of the buildable engine, up to the v5 UI connection:
- **5 producer skills:** local-demand, positioning, marketing, reputation, **operations** (new; staffing/
  hours/throughput from traffic). Local-Demand narrowed to events+weather so it no longer overlaps Operations.
- **Funded data wired into `buildDossier`:** own reviews -> sentiment pass (`lib/insights/reviews/sentiment.ts`)
  -> citable `review.theme` insights (activates Reputation); own foot traffic via Outscraper-on-own-place.
- **Value/ROI helper** (`lib/skills/value/estimate.ts`): qualitative leverage aggregate for the brief (no $).
- **Persistence:** migration `supabase/migrations/20260604120000_daily_briefs.sql` (daily_briefs table, org-
  scoped RLS mirroring insights, + locations.voice_tone) + `lib/insights/daily-brief.ts` (saveBrief/getBrief)
  + precompute route `app/api/cron/build-brief/route.ts` (dossier -> runBrief -> saveBrief, Bearer CRON_SECRET).

**LIVE consolidated run (real Wagyu dossier):** funded data = 5 review themes / own busy-times / 5 review
insights; all 5 skills fired (reputation 6, operations 6 now active); brand-fit review DROPPED an off-brand
play ("Cinco de Mayo wagyu special"); brief grounded + eval-clean + voice-clean. 107 unit tests green; type-clean.

**Gated on a Bryan action / deploy / the UI step (NOT done headless):**
- Apply the `daily_briefs` migration to the branch (DDL needs the CLI/PAT or the SQL editor — I can't apply
  it headless), then regenerate `database.types.ts`. After that the precompute route + UI read run live.
- Async scheduling (Vercel Workflow or the Fluid-Compute cron) needs a deploy to truly run on a schedule.
- Menu-tag extraction (extend the existing Firecrawl+Gemini content pipeline) — not yet done.
- **v5 UI converged onto real brief output — the intended together-step.**

**Calibration note for Bryan/Chris:** the brand-fit reviewer dropped a "Cinco de Mayo wagyu special" as
off-brand for a premium steakhouse (same family as the lunch-plate call). Worth confirming the line — a
tasteful holiday tie-in may be fine; the taste panel calibrates this.

---

## UPDATE — Brand-tolerance CONTROL SYSTEM (2026-06-04)

Per Bryan: don't calibrate one skill for everyone — give each customer a slider and a feedback loop.
- `RestaurantProfile.brandTolerance` (0-100). The brand-fit reviewer scores severity objectively;
  `applyHarmReview(plays, verdicts, tolerance)` sets the action: tame (<=33) drops moderate+severe,
  balanced (default 50) drops severe only, adventurous (>=67) drops nothing and shows wild ideas at low
  confidence. Default 50 preserves prior behavior.
- `lib/skills/preferences.ts`: `recordPlayFeedback` (good/bad per play) + `recalibrateTolerance` (liking
  wild plays raises the slider, disliking lowers it; tame feedback barely moves it) + `playKey`.
- Migration adds `locations.brand_tolerance` + `brief_feedback` table (org-scoped RLS).
- Wired into `runBrief` (reads `dossier.profile.brandTolerance`). 114 unit tests green; type-clean.

The band thresholds + step size are first-pass; calibrating them is taste-panel work. The control
*mechanism* is built.
