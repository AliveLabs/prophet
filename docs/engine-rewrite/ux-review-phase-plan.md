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

> **RESUME (as of 2026-06-08):** Phases 1–8 ✓ DONE, committed + pushed on `ux-rework` (latest build `265c194` green).
> Decisions taken: slider = Settings+refresh; detail = expanded page; staging = reuse branch; tokens = unify to 6px.
> Hosted review surface (behind Vercel SSO): **`https://prophet-git-ux-rework-alive-labs.vercel.app`** (stable alias).
> **Phase 9 (production wiring — GATED) IN PROGRESS:** ✓ onboarding real data (`d4f95c1`) · ✓ Ask Ticket live
> engine (`54985f7`). Remaining: prod `daily_briefs` migration (the one true prod-touching step, fully gated);
> processing/notifications (really cutover/authed territory); evidence/provenance (largely already done in
> Phases 3–4); content-variety re-judge (needs prod data). **Prod still untouched.** Full handoff: vault
> `2026-06-08-ticket-phases-3-4`.

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

## Phase 4 — Evidence + Detail view (local)  ☑ DONE
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
- ☑ **Token extraction DONE (Bryan reviewed a rendered side-by-side, chose unify-to-6px; 2026-06-08).**
  Extracted the duplicated Newsprint palette + fonts into **`app/editorial-tokens.css`**, scoped to
  `.ticket-brief, .ticket-app, .ob` (NOT `:root` — avoids colliding with the dashboard shell's own
  `--card`/`--radius`). Each surface CSS now `@import`s it and dropped its own token block. Resolutions:
  onboarding `--radius-card` 8px → **6px** (unified); `--font-cond` fallback unified to the `'Arial Narrow'`
  chain (onboarding's bare-`sans-serif` was accidental drift); `--shadow-lift` kept brief-only (intentional).
  No visual change to brief/app; onboarding now matches the 6px system. Verified: `.ob` + `.ticket-app` resolve
  the shared tokens locally; Vercel build green (`265c194`) — all three `@import` paths compile.
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

## Phase 8 — Staging isolation (env)  ☑ DONE (Bryan, 2026-06-08)
Closed. Bryan will revisit casually while onboarding new accounts; any further feedback is net-new (not tracked here).
- **Approach (Bryan, 2026-06-08): reuse the existing `--with-data` Supabase branch as the Preview DB.**
- ☑ Set Vercel env vars `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
  scoped to **Preview + git-branch `ux-rework`** → the branch DB (`eguflqjnodumjbmdxrnj`). The original
  `Development/Preview/Production` vars (→ prod) are UNTOUCHED, so Production deploys still hit prod. Reversible:
  `vercel env rm <NAME> preview` removes the branch override.
- ☑ Committed Phases 1–7 (`8a193c4`) + pushed `ux-rework` → Vercel built a preview (`prophet-gro20cdg7`) using
  the branch-scoped env. Build succeeded.
- Preview is behind **Vercel Deployment Protection** (SSO/401) — good (no public data leak); means the agent
  can't verify headless. **Bryan eyeballs it** (logged into Vercel) at the STABLE branch alias
  **`https://prophet-git-ux-rework-alive-labs.vercel.app`** (auto-points at the latest ux-rework deploy)
  → `/preview/today`, `/preview/competitors` (+ `/{id}`), `/preview-onboarding`, `/preview/settings`.
  (For headless agent verification later: enable a Vercel "Protection Bypass for Automation" token.)
- **First preview attempt 404'd to marketing — FIXED.** Two-part cause: (1) routes were guarded on `NODE_ENV`
  (="production" on every Vercel build incl. previews) → switched to `VERCEL_ENV`. (2) Once they built, Next 16
  **cacheComponents** failed the prerender on uncached data outside `<Suspense>`. Fix chain (6 builds): `await
  connection()` on each data page; layout restructured to sync-layout + `<Suspense fallback>` + async
  `PreviewShell` (mirrors `(dashboard)/layout.tsx`); skeleton fallback made fully static (was rendering the real
  `PreviewNav`, which calls `usePathname()` — illegal in the static shell). Build green @ `4b2a056`.
- This is now the REVIEW surface — reviews no longer depend on Bryan's local DNS (Vercel resolves Supabase fine).
Done when: hosted preview hits the non-prod branch DB ☑ (wired) + builds ☑; Bryan confirms it renders real branch data.

## Phase 9 — Production wiring + live integrations (prod; reviewed in pieces)  ◐ in progress  **Gated**
Each sub-item is its own reviewable change:
- ☐ Apply the additive `daily_briefs` migration to prod (or staging) + precompute on real data.
- ☑ **Real competitor discovery + Places autocomplete in onboarding (2026-06-08).** Onboarding "find your
  restaurant" = real Places autocomplete; picking a place prefills the confirm step from the live listing
  (name/address/cuisine/price/website) + discovers real nearby competitors (filtered to drop fast-food/juice/
  delivery; same-cuisine ranked first; honest "why"). Server routes `app/api/preview/places/{search,select}`
  (key stays private, prod-guarded via VERCEL_ENV). New `lib/places/fetchNearbyCompetitors` + `lib/places/format`
  (+ 3 tests). Built/verified against staging; prod untouched. Commit `d4f95c1`, build green, live on the preview.
  NOTE at cutover: the `/api/preview/places/*` routes are prod-guarded — the real authed onboarding will need
  un-guarded equivalents (or relocate these). Known minor edge: a generically-typed "restaurant" (e.g. a vending
  machine) can slip the type filter.
- ☐ Real **processing/status** + notifications (email/browser) replacing the placeholder onboarding end-state.
  (Note: needs a persisted authed account, so it's really cutover/authed territory — not a clean fit for the
  no-auth preview.)
- ☑ **Ask Ticket — live answer engine (2026-06-08).** Bounded NL question answered using ONLY the location's
  own data (domain-locked, grounded). `lib/ask/answer.ts` (prompt + validate + answerQuestion, injectable
  transport, cost-bounded) + `lib/ask/gather.ts` (context from persisted insights/competitors/brief) +
  `app/api/preview/ask` (POST, prod-guarded) + `app/preview/ask` AskBox client UI (input + chips + answer with
  confidence + humanized sources). Verified live on staging: "who's undercutting me" → real grounded answer
  ("Gyu-kaku, $11.08 vs your $21.18, 48% lower, promos on FB/IG") with sources; "capital of France" → declined
  (grounded=false). Sources de-jargoned via the Phase-4 formatter. 5 unit tests. Commit `54985f7`, build green.
  The *pinned standing question* (re-runs each morning) is still a coming capability — only the one-off ask is live.
- Real **evidence + provenance** ("how we know") and **What We Checked** counts/failures from social/
  photos/SEO data; richer detail-view evidence on real data.
- Re-judge recommendation **content variety** on production data (esp. marketing-focused outputs).
Done when: the new experience runs end-to-end on real data, reviewed piece by piece.

## Phase 10 — Cutover (reworked experience becomes the live app)  ☐  **Gated**
Plan as of 2026-06-08. Legend: **[AGENT]** = I do it on the branch, no prod touch, verified on the preview.
**[BRYAN]** = needs your hands (Vercel/Supabase dashboard, prod, or the go/no-go) — risk flagged. The goal is
to make each [BRYAN] step a tiny, well-scripted action so there's no room for a critical mistake.

### Going in
- The reworked **brief** is already in the authed home (`app/(dashboard)/home`, wired to the logged-in user's
  real location). The REST of the rework (4-item shell/nav + account flyout, Competitors, Ask, Settings,
  onboarding) lives in the no-auth, prod-guarded `app/preview/*` + `app/preview-onboarding/*`, pointed at the
  Wagyu STAGING location via the admin client. Cutover = make that the real authed app.
- `main` is untouched; prod Supabase lacks the `daily_briefs` migration; prod holds real early-access leads.

### Stage A — Code prep on `ux-rework` (no prod touch; verified on the preview)  [AGENT]
A1. Swap the authed `(dashboard)` shell to the reworked 4-item nav + account flyout (old 11-item shell out).
A2. Move Competitors / Ask / Settings into authed routes, rewired from Wagyu-hardcoded + admin client to the
    LOGGED-IN user's real org/location via the user-scoped client + `requireUser` (RLS-safe).
A3. Replace old onboarding with the reworked flow; wire real account/location creation + un-guard the Places
    & Ask routes for authed use (or authed equivalents); kick off the first-brief precompute on finish.
A4. Reduce nav 11 → ~4; old modules become drill-downs/retired.
A5. Retire/relocate the `app/preview/*` + `app/preview-onboarding/*` scaffolding (keep guarded until B+C pass).
A6. Verify the whole AUTHED experience on the preview (staging DB, real login); tsc + tests green.
A7. Open a PR `ux-rework → main` (the full diff, for final review).
   → This is the bulk of the work; I can do ALL of A1–A7 autonomously once you greenlight the approach.

### Stage B — Prod data prep (gated)  [BRYAN] — I prep, you execute
B1. **Apply the additive `daily_briefs` migration to PROD Supabase.** RISK: prod DDL — but additive (old site
    ignores it) so low-risk + reversible. I give you the exact file + click-by-click (Supabase → SQL editor →
    paste `supabase/migrations/20260604120000_daily_briefs.sql` → run). I can't do this headless (no prod creds).
B2. **Precompute first briefs for real prod locations.** I can script/run it if you give me temporary prod
    access (PAT/service-role); otherwise you trigger the cron route. Without it, real users see the honest
    enriching/first-run state until the scheduled run.

### Stage C — The switch (gated, your go/no-go)  [BRYAN]
C1. Final review of the PR + the authed experience on the last preview.
C2. **Merge `ux-rework` → main → triggers the PRODUCTION deploy.** RISK: the live flip. Mitigation: Vercel keeps
    the prior prod deploy = one-click instant rollback.
C3. Verify production `/home`, onboarding, 4-item nav, Ask, Competitors on `app.getticket.ai`.
C4. Remove the branch-scoped `ux-rework` Preview env vars (cleanup; harmless if left). [AGENT or BRYAN]

### Rollback
Vercel → previous production deployment = instant code revert. The migration is additive (safe to leave even
on a rollback — nothing on the old code reads `daily_briefs`).

### One-line split
- **I do (no prod):** all of Stage A — port the reworked experience into the authed app, verified on the
  preview — + open the PR; + can script B2/C4 if given access.
- **You do (prod, careful):** B1 (apply migration, exact steps provided), C2 (merge = go-live), C1/C3 (review +
  verify on the live domain).
Done when: production runs the reworked experience end-to-end, reviewed + verified live.

---
Pointers: BLUEPRINT.md §22 (rework architecture + env constraint) · docs/engine-rewrite/build-status.md
(engine ledger) · vault session logs 2026-06-0{4,5,6}-ticket-* · Notion "Brief UI Review Chris & Bryan".
