# UX Rework — Phased Plan (from the Chris & Bryan Brief UI Review, 2026-06-08)

Source: Notion "Brief UI Review Chris & Bryan" (2026-06-08). This is the working punch-list,
ordered into session-sized phases. **Local-first, production-gated.** Each phase is a clean
break point so work can hand off across sessions without losing context to compaction.

Conventions:
- **Touches prod?** No = safe to do locally on the `ux-rework` branch / Supabase branch. Gated =
  requires Bryan's explicit sign-off (prod holds real early-access leads — see BLUEPRINT §22.7).
- **Decision** = needs a Bryan call before/within the phase; do the rest, hold the decision.
- Status legend: ☐ not started · ◐ in progress · ☑ done.

Terminology decided in the review (use everywhere): page = **Brief**; cards = **Recommendations**
(not "What to do" / "DO NN"); **Insights** = the supporting intelligence that drive recommendations.

> **RESUME (as of 2026-06-08):** Phases 1–7 ✓ (core) — **the entire local-first rework is done** (uncommitted on `ux-rework`).
> Decisions taken: slider = **Settings + explicit refresh**; detail view = **expanded page**.
> Pending a stable-DNS window (the WAP gremlin): (a) eyeball the Phase 6 competitor list/detail happy-path;
> (b) run the Phase 7 live precompute to confirm the model follows the new phone-first/multi-channel prompt.
> Carried review item: **token extraction** parked with feedback + side-by-side TODO (Phase 4 notes).
> **NEXT = the PRODUCTION/STAGING BOUNDARY (Phase 8, gated — needs Bryan's decision + action).** Do NOT cross
> without explicit sign-off (prod holds real early-access leads). Full handoff: vault `2026-06-08-ticket-phases-3-4`.

---

## Phase 1 — Foundations (local, no decisions)  ◐
Goal: get the vocabulary and design tokens right before touching surfaces, so later phases inherit them.
- ☑ Rename throughout: "What to do" → **Recommendations**; "DO 01" → clean rank "01" (card) /
  "Recommendation 01" (detail kicker). Verified no residual user-facing strings; tsc green. (2026-06-08)
- ☐ Extract the duplicated editorial design tokens (brief.css / preview.css / onboarding.css) into ONE
  shared source. DEFERRED — fold into Phase 2 or 4 (which touch CSS anyway) to avoid a standalone 4-file
  refactor at a session boundary. Internal hygiene, not blocking.
Done when: consistent naming everywhere ☑; single token source (deferred); routes render; tsc + tests green.

## Phase 2 — Recommendation card cleanup (local)  ☑ (visual confirm pending a stable-DNS window)
- ☑ Removed the "Each carries its reason…" zone subcopy + the drill hints ("how to run it" / "what it's
  grounded in"). Cards/drills carry no how-to-read instructions now.
- ☑ Consolidated the label row: rank is just "01"; kind-tag + **Confidence** + **Impact** + topic all live
  on ONE meta row (was split across rank-row + meta).
- ☑ Confidence now uses the SAME explicit label:value system as Impact (`.metric` = "Confidence High" /
  "Impact High"); removed the old pip `ConfChip`.
- ☑ Feedback control: up/down (↑↓, read as reordering) → 👍/👎 like/dislike with "Helpful?" + aria labels;
  fixed em-dashes in the confirmation text ("Noted, more like this").
- ☑ "Play" dependency markers: dashed-checkbox look → a plain rust step-dot (no false "interactive/complete"
  affordance, since we can't verify completion).
- Verified: tsc clean, 117 unit tests green, no residual "DO"/zone-sub strings. Screenshot blocked by the
  local DNS intermittency; eyeball at /preview/today when DNS is stable.
- Token extraction (from Phase 1) STILL deferred → fold into Phase 4 (evidence/detail, heavy CSS).

## Phase 3 — Brief rail + tuning (local)  ☑  (visual confirm done in a stable-DNS window)
- ☑ **On Watch** removed from the brief rail (management already lives on the Competitors page / Settings).
  Dropped the orphaned `.reach`/`.rail-card--quiet` CSS and the now-unused `locationName` rail usage.
- ☑ **What We Checked** → promoted from a recessed "quiet" panel to a real **credibility module**: header
  fresh-count ("7 of 7 fresh"), honest per-source states (Fresh / Aging `as of …` / Not reached), and an
  expandable **"How we read this"** explainer. Source-by-source provenance is the prod-wired piece (Phase 9);
  the honest states are real now.
- ☑ **Slider reframe + relocation:** moved off the brief rail into **Settings** (new `app/preview/brief-tuning.tsx`
  client component). Reframed as **Narrower ↔ Broader thresholds** (not more/fewer cards), seeded from
  onboarding, with a separate **"Show everything"** escape hatch.
- ☑ **DECISION (Bryan, 2026-06-08): Settings + explicit refresh.** Changing the control never silently rewrites
  today's brief — an explicit **"Update my recommendations"** button (dirty-gated) applies to the next brief.
  Working shell; persistence (`setBrandTolerance`) + recompute wire up with the authed Settings page (Phase 6/9).
- Verified: tsc clean, 117 unit tests green, browser-confirmed rail (On Watch + slider gone; credibility module
  present) and the Settings tuning interaction (drag → dirty/enable; show-everything → disable slider + swap copy).
Done when: rail reflects the cuts ☑; slider reframed + relocated per Bryan's call ☑.

## Phase 4 — Evidence + Detail view (local)  ☑ (core)  ·  token extraction deferred
- ☑ **Evidence de-jargon.** Root cause: evidence refs come in TWO formats — dotted
  (`events.new_high_signal_event:event`) and screaming-snake-with-field (`SEO_COMPETITOR_GROWTH_TREND:PCT_CHANGE`)
  — and the old per-file `humanizeRef`/`distinctDomains` only handled the dotted form, so raw keys leaked onto
  the card's topic chip + evidence drill. Built ONE shared formatter `lib/skills/evidence-format.ts`
  (`domainLabel`, `humanizeRef`, `humanizeLabel`, `distinctDomains`, `dedupeRefs`; acronym-aware: SEO/POS/…),
  used by BOTH the card and the detail page so they can't drift. Also humanized snake `step.channel`/`platforms`
  ("GOOGLE_BUSINESS_PROFILE" → "Google Business Profile"). 6 unit tests lock it in. Browser-verified: 0 raw keys
  on the brief or any detail page.
- ☑ **DECISION (Bryan, 2026-06-08): expanded PAGE.** Rebuilt `app/preview/today/[rank]/page.tsx`: replaced the
  inline-style soup with a consistent class system (`.pv-step*`, `.pv-ev*`, `.pv-detail__lede`, `.pv-pills` in
  preview.css — fixes the font-inconsistency + Play-list formatting complaints), full-width lede, proper
  Confidence/Impact casing, **what / how / why-we-know scaffold** (recommendation → step-by-step → grounded
  signals), and honest placeholders for the tutorials + platform-specific how-to that prod-wire later.
- ◐ **Token extraction — PARKED as a review item (Bryan, 2026-06-08; not now).** Finding: the 3 editorial
  surfaces are NOT one token system. Onboarding's scope is `.ob` (not `.ticket-onboarding`) and diverges:
  `--radius-card:8px` (vs `6px` on brief/app) and a different `--font-cond` fallback; brief also has a unique
  `--shadow-lift`. A naive "one shared source" would regress onboarding's card radius.
  - **My read (feedback for Bryan):** (1) `--shadow-lift` brief-only = correct, it's a real semantic token only
    the lead card uses — keep. (2) The `--font-cond` fallback drift (onboarding drops the `'Arial Narrow'`
    fallback) is almost certainly *accidental*, not a design choice — safe to unify. (3) The `8px` vs `6px`
    radius is the only judgment call: plausibly intentional (softer/friendlier cards on the first-touch
    onboarding) — but if so it should be an *explicit* per-surface override token (e.g. keep one shared scale
    + `.ob{ --radius-card:8px }`), not silent divergence. Recommendation: extract ONE shared token source with
    onboarding's two intentional overrides declared locally; net effect is DRY with zero visual change.
  - **TODO when we pick this up:** build a **side-by-side** (onboarding card at 6px vs 8px, same content) so
    Bryan can eyeball the radius difference and decide before we unify. Not blocking; do it with Bryan present.
Done when: evidence reads plain ☑; expanded detail page built + richer ☑; (token extraction: Bryan's call).

## Phase 5 — Onboarding polish (local)  ☑
- ☑ **Structured inputs:** price = **dropdown** ($ / $$ / $$$ / $$$$ with labels); hours = **per-day
  open/close editor** (`HoursEditor` — 7 rows, `type=time` open/close + per-day "Closed" toggle; Mon defaults
  closed) — both replace the old free-text inputs.
- ☑ **Inverted progress colors:** completed = solid ink, the ACTIVE step = rust accent (`.ob-progress i.done`
  / `.current` swapped).
- ☑ **Competitor step = add/remove** (dropped the active/inactive checkbox toggle): each discovered competitor
  is a removable row with a **"Why"** line (same cuisine / overlapping menu / shared search terms / same
  occasion / premium positioning), plus a **"+ Add a competitor"** affordance. Keep-≥1 guard intact
  ("Track these N" reflects the live count).
- ☑ **Priorities = multi-select** ("pick any that apply", ✓ per selection) + a 4th category ("Run service
  smoother" → ops) so it maps across the engine's rec kinds; copy notes you can **change these anytime in
  Settings**.
- ☑ Replaced **"first brief lands tomorrow morning"** with an honest staged processing state: "Competitors
  found — **Ready now**" / "Reading local demand — **A few minutes**" / "Analyzing reviews + competitor
  activity — **Within the hour**", plus **email / browser notification** opt-ins. Scaffolded honestly (real
  timing + alerts wire up in the production phase).
- Verified: tsc clean, 123 unit tests green, full flow browser-walked (price/hours, remove→count updates,
  two goals selected at once, no "tomorrow morning"). No decision gate — built per plan.
Done when: onboarding uses structured inputs ☑ + an honest processing state ☑; no "tomorrow morning" ☑.

## Phase 6 — Competitors + Settings/Profile (local)  ☑ (core)  ·  1 eyeball pending stable DNS
- ☑ **Per-competitor detail** route `app/preview/competitors/[id]/page.tsx` + loader `loadCompetitorDetail`
  (real restaurant + its recent signals tagged to that competitor; reuses the shared `humanizeRef` + `.pv-ev*`
  styles). Replaces the old "competitive summary" label soup with the actual restaurant + what we've seen move.
- ☑ **Competitor management lives on the Competitors page** (`competitor-list.tsx` client): real loaded
  competitors link to their detail (View →), each row is removable, "+ Add a competitor" affordance, keep-≥1
  count. Mirrors the onboarding add/remove pattern. Settings no longer duplicates the manager — it links here.
- ☑ **Settings editable** (`settings-controls.tsx`): voice → **select** (5 tones); **Communications** section
  MERGES the old Notifications + marketing email into one place (weekly digest / browser / product-updates
  toggles); brief boldness = the Phase-3 tuning control. Plan/cadence stay display (billing/plan-gated).
- ☑ **Standing-question wording fixed** (Ask page): reframed from "Your standing question re-runs every
  morning" (implied active/configurable) to a **coming capability shown as an example** — matches the
  already-disabled input + honest notes.
- ◐ **Multi-location profile pattern:** the account flyout already has the switcher + add-location + per-location
  Settings + sign-out + an honest "not wired" note — adequate shell; real switching/add is prod-gated wiring.
- Verified: tsc clean, 123 unit tests green; Settings fully browser-verified (voice select, merged comms
  toggles, competitor pointer). **Competitor list/detail HAPPY-PATH (real names → View → detail) pending a
  stable-DNS window** — local `*.supabase.co` was SERVFAIL-ing during the check, so the page correctly showed
  the graceful empty state ("Watching 0"); the load pattern is unchanged + tsc-clean, eyeball when DNS is up.
Done when: settings are editable shells ☑; competitor management on the Competitors page ☑ (+ per-competitor
detail ☑). Pending: eyeball the competitor happy-path in a good DNS window.

## Phase 7 — Recommendation content + voice (engine; mostly local)  ☑ (core)  ·  live precompute pending DNS
- ☑ **Phone-first creative, system-wide.** Added a shared `CREATIVE_AND_CHANNEL` rule to `prompt-kit.ts` (the
  scaffolding every skill composes): creative direction must describe a photo/short video the owner can take on
  THEIR phone, plain words, NO assumed equipment, NO photography jargon ("golden hour", "side light", "tight
  crop", "no text overlay", "plating"); any more-produced shot is explicitly OPTIONAL.
- ☑ **Multi-channel guidance** in the same rule + the marketing playbook: tailor by live platform name
  (Instagram/TikTok = short vertical video/Reel; feed = one strong photo; Google Business = photo + update),
  "one capture feeds several", never just "post it".
- ☑ **Customer copy ties to the onboarding brand voice** — strengthened `voiceLine` to say the copy field is
  the restaurant's OWN onboarding-captured voice (tone + sample), explicitly "do not write in Ticket's voice".
- ☑ De-jargoned the hardcoded fallback `creativeDirection` strings in marketing/positioning/local-demand +
  the marketing/local-demand knowledge examples (golden hour / the sear / warm side light / no text overlay → phone-first).
- ☑ Verified deterministically: 5 new unit tests (`recommendation-content.test.ts`) assert no skill's fallback
  creative uses photography jargon (it's phone-first) and the shared prompt carries the phone-first / optional /
  multi-channel / onboarding-voice rules. tsc clean, **128 unit tests green**.
- ◐ **Live precompute PENDING a stable-DNS window** — `*.supabase.co` is SERVFAIL-ing on the local WAP resolver
  right now, so the live `precompute-brief.live.test.ts` (engine + Claude on branch data) can't run to confirm
  the MODEL follows the new prompt. Run it when DNS is up: `npx vitest run --config vitest.integration.config.ts
  tests/integration/precompute-brief.live.test.ts`. Content *variety* re-judged in the prod phase (as planned).
Done when: skill prompts/knowledge updated ☑; verified via a precompute (deterministic ☑; live pending DNS);
variety re-judged in the prod phase.

---
## ════ PRODUCTION / STAGING BOUNDARY — everything below requires Bryan review + sign-off ════
The review's recurring theme: get onto production data; many "wire-up" items depend on it, and Bryan/Chris
need to review each. Do NOT cross this line without explicit go-ahead.

## Phase 8 — Staging isolation (env)  ☐  **Decision + Bryan action**
- Stand up a proper non-prod environment so reviews don't depend on local DNS and never touch the customer
  DB: Supabase branching integration wired to Vercel previews, OR a dedicated staging Supabase project.
- **Confirm the approach with Bryan first.**
Done when: a hosted preview hits a non-prod DB; the local-DNS dependency is gone.

## Phase 9 — Production wiring + live integrations (prod; reviewed in pieces)  ☐  **Gated**
Each sub-item is its own reviewable change:
- Apply the additive `daily_briefs` migration to prod (or staging) + precompute on real data.
- Real competitor **discovery** + Places **autocomplete** in onboarding.
- Real **processing/status** + notifications (email/browser) replacing the placeholder onboarding end-state.
- **Ask** / standing-question live answer engine.
- Real **evidence + provenance** ("how we know") and **What We Checked** counts/failures from social/
  photos/SEO data; richer detail-view evidence on real data.
- Re-judge recommendation **content variety** on production data (esp. marketing-focused outputs).
Done when: the new experience runs end-to-end on real data, reviewed piece by piece.

## Phase 10 — Cutover  ☐  **Gated**
- Merge `ux-rework` → main; new `/home` replaces the analyst home; nav reduced to the 3 + account flyout;
  retire/relocate the `app/preview/*` + `app/preview-onboarding/*` scaffolding. Final review.

---
Pointers: BLUEPRINT.md §22 (rework architecture + env constraint) · docs/engine-rewrite/build-status.md
(engine ledger) · vault session logs 2026-06-0{4,5,6}-ticket-* · Notion "Brief UI Review Chris & Bryan".
