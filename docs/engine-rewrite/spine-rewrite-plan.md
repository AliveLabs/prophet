# Data-Spine Rewrite Plan (2026-06-09)

> **Supersedes** `ux-review-phase-plan.md` (the retrofit/cutover plan). That plan assumed the
> backend was sound and only the UX needed rework. The 2026-06-09 prod trust audit
> (`prod-trust-audit.md`) proved the backend data spine is the actual problem. This plan rebuilds
> that spine. The UX rework + insight engine are kept and re-validated on trustworthy data.

## The one hard constraint
**Never write to the production early-access leads data.** Those rows come from a *separate*
marketing-site project (root domain); this ticket app (subdomain) has no real users in prod.
Everything else — code, orchestration, provider data pulls, snapshot/insight writes, additive schema
changes — is in scope. Leads tables are read-never-write, everywhere, always.

## Diagnosis recap (why we're here)
The ingestion layer has **no concept of content freshness**. Every pipeline fetches whatever a
provider returns, stamps it `captured_at = today`, stores it as "latest," and diffs it against the
previous today-stamped row. Dormant/wrong social handles (e.g. an account dark since 2022) get
ingested and presented as current activity; "completed" means "the API returned," not "the data is
fresh and correct." The same capture-date-not-content-date flaw is in the new engine's freshness
gate. Most insights/snapshots in prod are already stale with no expiry. Full evidence:
`prod-trust-audit.md`.

## Keep / Rebuild / Re-validate
- **KEEP (sound):** provider clients (Data365, DataForSEO, Outscraper, Firecrawl, Google Places,
  Gemini, OpenWeather, Resend), DB schema (extend additively), auth, Stripe/billing/tiers.
- **REBUILD (rotten):** ingestion freshness discipline · orchestration (collapse 2 systems → 1) ·
  observability (honest run/job status) · discovery verification (kill dead/wrong-handle lock-in).
- **RE-VALIDATE (built on bad data):** the insight engine + editorial brief — fix the read-time
  freshness gate, then re-run the eval-judge gate on real fresh data and recalibrate.

---

## The Data-Integrity Contract (the heart of the rewrite)
Every signal must satisfy these, enforced at WRITE and READ:

1. **Content-derived as-of.** Each snapshot stores `content_as_of` (the real recency of the
   underlying content: newest post date / newest review date / event window / menu-change date /
   SEO data period) **separately** from `captured_at` (when we fetched). They are never conflated.
2. **Write-time liveness classification.** Each snapshot is classified `fresh | aging | dormant |
   empty | undated` from `content_as_of` against a per-signal threshold (e.g. social dormant when
   newest post > 90d). Dormant/empty/undated snapshots are stored but flagged — they do NOT seed
   "current activity" insights.
3. **Honest job/run outcomes.** Pipeline runs record `fresh | served_stale | dormant | no_data |
   failed` **with a reason** ("Data365 newest post 2022-01-07 → account dormant"), in a
   `pipeline_runs` table. "Completed" is retired as a success signal.
4. **Read-time enforcement.** The dossier/brief consumes signals by **`content_as_of`**, not
   `captured_at`. Stale/dormant signals render as explicit honest states ("No recent social
   activity") — never as current.
5. **Discovery verification.** Handle/competitor discovery verifies liveness before `verified=true`;
   dormant/mismatched handles are flagged and re-checkable (drop the permanent self-skip); the loose
   fuzzy `data365_search` (≥0.3 similarity) is tightened or removed.
6. **Observable gating.** When a customer gets no data, the reason is recorded and surfacable (trial
   expired / no approved competitors / all accounts dormant / provider down) — not silent.

---

## Phases
Each phase: built on a git branch, type-checked + unit-tested, exercised against the **Supabase
branch** (`eguflqjnodumjbmdxrnj`, a `--with-data` clone — safe, no real leads), committed. The only
approval gates are the two prod-DB migration steps (additive, leads-safe).

### Phase 0 — Confirm operational unknowns + lock environment  *(mostly read-only)*
- Confirm whether the prod daily cron (`/api/cron/daily`) actually fires + `CRON_SECRET` is set, via
  a read-only `refresh_jobs` timeline + Vercel cron logs. *(needs prod read — see Permissions.)*
- Confirm whether the legacy Supabase edge functions are deployed/scheduled (→ retire if orphaned).
- Lock the working environment: git branch `spine-rewrite` off `ux-rework`; DB = the Supabase branch.

### Phase 1 — Contract foundation: schema + write-time freshness
- **Migration (additive):** `content_as_of timestamptz` + `freshness text` on `social_snapshots`,
  `snapshots`, `location_snapshots`; new `pipeline_runs` table. Applied to the **branch** by me.
- Per-provider `content_as_of` extractors (social newest-post, review dates, event window, menu
  change, SEO period).
- Write-time liveness classifier + thresholds (configurable per signal).

### Phase 2 — Discovery verification
- Verify handle liveness during discovery; require recency before `verified=true`; flag dormant;
  enable re-discovery; tighten/remove fuzzy name-search; re-verify the existing bad handles.

### Phase 3 — Reliable orchestration + observability
**Status: 3a + 3b DONE. Edge-fn retirement still open.**
- ☑ **3a — durable queue + worker.** `signal_jobs` queue + `claim_signal_jobs` (FOR UPDATE SKIP
  LOCKED); daily cron ENQUEUES per-(location,pipeline) jobs (social explicit; insights delayed 15m);
  `/api/cron/worker` (every 5m) drains one pipeline/job with backoff retries + honest `pipeline_runs`
  outcomes (freshness-aware for social). Applied to branch + live-verified (weather→fresh→done).
- ☑ **3b — heavy pipelines bounded under 300s.** content: competitor menus now scraped CONCURRENTLY
  in bounded batches (was sequential per-competitor — the ~9min driver). photos: per-run download/
  analyze cap (24) that chunks across weekly runs via hash-dedup (logged). social-collect already
  concurrent; its slow Gemini-Vision step stays out of the scheduled path (`SKIP_STEPS`). Full
  per-(entity) cursor chunking via `signal_jobs.cursor` remains available if a single entity ever
  exceeds budget, but is not needed at current scale.
- ☐ **Confirm + retire** the orphaned Supabase edge functions (verify deploy/schedule first — Supabase
  dashboard). Low-risk cleanup; the live path is the Next cron + queue.

Corrected scope after reading the execution path (social already runs in `refresh_all`; the real
defect is timeout + fire-and-forget, not a missing pipeline):
- **Fix the 300s timeout:** `refresh_all` runs all 8 sub-pipelines sequentially in one 300s function
  and is killed mid-run for real locations. Decompose into per-pipeline async jobs (a durable queue
  / Vercel Workflow, or per-pipeline fan-out invocations) so no single invocation must finish all of
  it; social's long Data365 polls stop starving the rest.
- **Reliable invocation:** the cron's fire-and-forget `fetch` (SSE never consumed) has no delivery
  guarantee — replace with a tracked enqueue.
- **Honest `pipeline_runs`:** record real per-pipeline outcomes + reasons (incl. freshness summary);
  fix the cosmetic `pipelines` log that misrepresents what ran.
- **Confirm + retire** the orphaned edge functions (verify deploy/schedule first — Supabase dashboard).

### Phase 4 — Engine read-time fix + re-validation
- Fix `buildDossier` freshness gate to use `content_as_of`, not `date_key`. Render dormant/stale
  signals as honest states in the brief. Re-run the eval-judge gate on fresh data; recalibrate.

### Phase 5 — Real-data backfill + end-to-end verification
- Re-pull fresh data for test orgs (writes snapshots/insights — allowed). Verify a real brief shows
  only fresh signals + honest "no recent X" states. Trace one org (Wagyu House) browser-to-data.

### Phase 6 — Prod alignment  *(GATED: the only true approval step)*
Runbook (do NOT run without Bryan's explicit go; never touch leads tables):
1. **Apply two additive migrations to prod** (`triodvdspdsuudooyura`):
   `20260609160000_signal_freshness_contract.sql` + `20260609180000_signal_jobs_queue.sql`. Both are
   additive (new columns/tables/fn) — old code ignores them. Agent CAN apply via
   `CONFIRM_PROD=yes node scripts/audit/db-exec.mjs --ref triodvdspdsuudooyura --file <sql>` (the PAT
   reaches prod; the guard requires the explicit `CONFIRM_PROD=yes`) — or Bryan via dashboard SQL editor.
2. **Confirm `CRON_SECRET` is set in prod env** (the daily + new worker crons auth on it). It was
   Production-only in the audit; verify it still exists.
3. **Merge `spine-rewrite` → main** = the prod deploy (Vercel keeps prior deploy for 1-click rollback).
   This ships the read-fix, discovery fix, and the queue/worker. The `*/5` worker cron starts draining.
4. **Verify**: `/api/cron/daily` enqueues; `pipeline_runs` shows honest outcomes; `/home` brief excludes
   dormant social. Backfill `content_as_of`/`freshness` on existing prod rows is OPTIONAL (the dossier
   self-computes social recency from raw_data, so the read-fix already holds un-backfilled).
Rollback: revert the Vercel deploy; the additive migrations are safe to leave.

---

## Phase 7 — Unified pull orchestration + billing + UX-merge consistency  ☑ (core; UI button-wiring at cutover)
Goal (Bryan, 2026-06-09): one coherent data-pull layer that supports first-run + daily + ad-hoc
(by business, by network) sequencing, optimizes Data365 billing, stays modular (no timeouts/huge
payloads), and is consistent with how the UX merge + cutover will drive everything.

**Four sequencing modes — all on the SAME durable queue (`lib/jobs/queue.ts`):**
- **first-run** — `enqueueFirstRun`: every pipeline once, `force` (ignore cadence), insights delayed.
  Used by onboarding finish (`completeOnboardingAction`) + `triggerInitialLocationData` (new/added
  location). Replaced the old per-competitor + content/weather fire-and-forget paths.
- **daily** — `/api/cron/daily` enqueues per-(location,pipeline); worker drains (Phase 3a).
- **ad-hoc by business** — `refreshLocationAction(locationId)` → `enqueueAdhocLocation`.
- **ad-hoc by network** — `refreshSocialNetworkAction(locationId, platforms)` → `enqueueAdhocPlatform`
  (social, platform-filtered).

**Data365 billing optimization** (`lib/jobs/cadence.ts`): Data365 has no batch endpoint, so the lever
is not pulling needlessly. `shouldPull` skips a profile still within its mode's cadence window and
re-checks dormant/empty accounts only on a long (14-day) cadence; first-run/forced pull everything.
Social collect loads each profile's last `captured_at`/`content_as_of` and gates per profile, and
supports a platform filter. (Follow-up: extend cadence-gating to content/SEO to dedup the first-run +
warm-up overlap — currently only social is gated; content may pull twice for a brand-new location.)

**Modularity**: every mode produces bounded per-pipeline jobs (Phase 3a/3b) → no timeouts/huge payloads.

**Consistency for the UX merge / cutover** (what's done vs what wires at Stage A of cutover):
- ✅ All server-side entry points now use the queue (onboarding, add-location, cron, ad-hoc actions).
- ✅ Engine/evals/skills/insights unchanged in contract — they consume the dossier, which now enforces
  read-time freshness; the eval gate still applies. The brief coverage panel surfaces per-signal
  fresh/stale honesty.
- ☐ **At cutover (Stage A authed port):** wire the reworked UI's refresh controls to
  `refreshLocationAction` / `refreshSocialNetworkAction`; surface `pipeline_runs` / `signal_jobs`
  status in the "what we checked / data health" module (replaces the old optimistic SSE progress that
  lied); onboarding's honest "processing" state already matches the queue's first-run timing.
- ☐ The legacy SSE `/api/jobs/[type]` manual-refresh path still runs pipelines inline (bounded per
  pipeline). Keep for now or route through the queue during the UX merge; not a correctness risk.

---

## Permissions / autonomy model
**I proceed without asking** on: all code edits, commits, pushes; type-checks/tests/builds; running
the app; provider data pulls; snapshot/insight DB writes on the branch; writing + applying additive
migrations **to the branch**.

**I prompt once for sign-off** on: applying any migration to **prod** (Phase 6).

**Never**: writing to prod early-access leads tables.

**Two credentials unblock full hands-free execution** (without them I fall back to prompting you to
run a command):
1. A **Bash allow rule** `Bash(vercel env pull:*)` in settings — lets me read prod env for the
   read-only audits/migrations (the auto-mode classifier hard-blocks prod-secret reads otherwise,
   and I cannot self-grant it).
2. A **Supabase access token (PAT) or the branch Postgres connection string** — lets me apply DDL
   (migrations) and run pipelines headlessly on the branch. (The prior PAT expired ~today.)

## Rollback
All work is on a branch off `main`; `main`/prod code is untouched until a deliberate merge. The prod
migrations are additive (old code ignores the new columns/table), so they're safe to leave even on a
code rollback. Vercel keeps the prior deploy for one-click revert.

---

## ════ CUTOVER & EVALUATION PLAN (updated 2026-06-09 — post spine-rewrite + Phase 7) ════
Supersedes the scattered Phase 6 / Stage-A notes above. Goal: get Bryan back to EVALUATING the
reworked experience on real branch data, then a safe, gated prod cutover.

### A. Branch state
All spine-rewrite + Phase 7 work is on **`spine-rewrite`** (branched off `ux-rework`; ~24 commits;
163 unit tests green; tsc clean; live-verified). `ux-rework` and `main` are untouched. The reworked
UI + new engine run against the branch Supabase DB (`eguflqjnodumjbmdxrnj`, migrations applied).

### B. To EVALUATE again — pick one (Bryan's call)
- **Option 1 (recommended): merge `spine-rewrite` → `ux-rework`.** ux-rework already carries the
  branch-scoped Preview env (Phase 8) + the stable alias `prophet-git-ux-rework-alive-labs.vercel.app`,
  so the existing hosted review surface (behind Vercel SSO) picks up all the new work immediately, and
  cutover stays `ux-rework → main`. One integration branch again.
- **Option 2:** scope the branch-Supabase Preview env to `spine-rewrite` (mirror Phase 8) for its own
  preview — more moving parts.
- **Local now:** `localhost:3000/dev-brief` renders the persisted branch brief (no login).

### C. PROD cutover — apply/set (GATED; Bryan go/no-go; NEVER leads tables)
1. **THREE additive migrations** (already on the branch; corrected — daily_briefs was missing from the
   earlier runbook): `20260604120000_daily_briefs.sql` (daily_briefs + brief_feedback tables +
   locations.voice_tone/brand_tolerance — the brief UI + Settings REQUIRE these, so it must land before
   the code deploy) + `20260609160000_signal_freshness_contract.sql` + `20260609180000_signal_jobs_queue.sql`.
   Apply via `CONFIRM_PROD=yes node scripts/audit/db-exec.mjs --ref triodvdspdsuudooyura --file <each>`
   (or dashboard SQL editor). Additive → old code ignores them. ORDER: migrations BEFORE merge-to-main.
2. **`CRON_SECRET` set in prod env** — both the daily cron and the new `/api/cron/worker` (every 5m) auth on it.
3. **Worker cron** is already in `vercel.json` — ships with the merge.
4. (Optional) backfill `content_as_of`/`freshness` on existing prod rows (`scripts/audit/backfill-social-freshness.mjs`
   + the SQL for as-of-capture signals). Not required — the dossier self-computes social recency.

### D. Stage A — authed port (the remaining BUILD before go-live)  [AGENT, branch-only, gated to start]
The reworked experience lives in no-auth `app/preview/*`; port into the authed `(dashboard)`:
- 4-item nav + account flyout; Competitors / Ask / Settings authed (user-scoped client + `requireUser`).
- **Wire the reworked refresh controls → `refreshLocationAction` / `refreshSocialNetworkAction`** (queue-based; by business + by network).
- **Replace the old optimistic SSE progress with real `pipeline_runs` / `signal_jobs` status** in the
  "what we checked / data-health" module — this is the fix for "the UI told you something different than reality".
- Onboarding finish already calls `enqueueFirstRun` (done).

### E. Cutover sequence (gated)
Apply 2 migrations to prod → set `CRON_SECRET` → merge `ux-rework → main` (= prod deploy; 1-click
rollback) → verify `/home` brief + onboarding + worker draining + refresh buttons → optional backfill.

### F. Verified before cutover
Spine rewrite (Phases 1–5) + Phase 7 (pull modes, Data365 billing cadence, rebuilt cost model,
persona/insight freshness gating) — all live-verified on the branch: dossier excludes dormant social;
**social "activity" insights gated so dormant competitors no longer read as recently active**; queue
drains with honest `pipeline_runs` outcomes; full Wagyu brief builds grounded + freshness-honest.

---

## Event geo-relevance (2026-06-09 overnight — SHIPPED through main)
Bryan's directive: "local" was metro-wide (Bush's Forney brief: all 10 events 10–40mi away).
PRETEST first (Bryan's method — run the scenario against existing skills before building): proved the
model does NOT self-gate on a distance field → gates are STRUCTURAL, not advisory.
- **L1** `lib/events/geo.ts`: geocode every venue (Places searchText; classic Geocoding API DENIED on
  our key) + haversine `distanceMiles` on every NormalizedEvent.
- **L2** `lib/events/relevance.ts`: role = distance × magnitude — `local_foot` ≤0.5mi (walk-in claims
  allowed) / `local_traffic` ≤3mi (traffic/prep) / `metro_hook` far+MAJOR (marketing TIE-IN only, low
  impact: "Mavs win = free side") / `out_of_area` + `ungeocoded` invisible (anti-fabrication).
- **L3** pipeline annotates at fetch + generates insights from LOCAL events only; dossier splits
  `demandCalendar.events` (local) vs `metroHooks` (marketing skill only); `attributes.serviceModel`
  from Places types (drive-thru QSR never gets walk-in framing); shared `EVENT_GEOGRAPHY` prompt rule.
- **L5** eval `checkEventGeoSanity`: far-event demand claims / high-leverage hooks = deterministic FAIL.
- **Proof:** Variant C live — "Run a Mavs Win = Free Side promo" [capitalize/LOW] + zero false demand
  (vs pre-build "Staff up for playoff traffic" [prepare/high/high]).
- **HELD (Layer 4, discuss with Bryan):** busy-times backtest → per-restaurant event ELASTICITY
  (which event classes measurably move THIS restaurant's traffic; negative results are product too).
- Also: worker zombie-reclaim (16 stuck 'running' jobs found in prod; >20m running → requeued).

---

## ════ COMPLETE-PICTURE BUILD PLAN (2026-06-10 — Bryan: "build every open item, now") ════
Goal: nothing on any page says "coming soon" — Bryan evaluates the WHOLE experience on prod.
Order = data-visibility first (what insights are made of), then interaction, then comms.

### Batch 1 — Evidence & proof (the "why" layer; makes evaluation possible)
- ☐ **Vision proof-grid on detail pages**: the rival's actual posts/photos + engagement numbers +
  Gemini "why this worked" — joined from social_snapshots (post images persisted to Storage) +
  competitor_photos into /home/[rank] + /competitors/[id]. (The data exists; it's a read+render.)
- ☐ **Re-enable social visual analysis in the scheduled path** (currently SKIP_STEPS): make it a
  per-run capped step (like photos, 24/run) so it stays under 300s instead of being skipped.
- ☐ **"What we checked" reads pipeline_runs** (true run outcomes + reasons + timestamps) instead of
  dossier-derived guesses; per-source "last tried / what happened" drill.

### Batch 2 — Ask Ticket completion
- ☐ **Saved history**: `ask_history` table (additive migration) — every Q/A persisted per location,
  rendered on /ask ("Recent asks" is currently an empty shell).
- ☐ **Pinned standing question**: pick a question → morning cron re-runs it after the brief
  precompute → answer lands on /ask (+ on the brief rail). Infra: column on locations + a step in
  the 08:00 build-brief cron.

### Batch 3 — Management actions that save
- ☐ **Add-a-competitor with real discovery** (Competitors page): Places autocomplete (reuse the
  Phase-9 preview routes, authed) → insert + approve + enqueue first-pull for that competitor.
- ☐ **Add-a-location** (account flyout): reuse existing locations/new action, editorial chrome.
- ☐ **Port the reworked onboarding UI** (preview-onboarding → authed /onboarding): structured
  inputs, add/remove competitors with "why", honest staged processing — wired to the real actions
  (account/location creation already queue-wired).

### Batch 4 — Communications
- ☐ **Communications prefs persist** (locations.settings or a prefs table).
- ☐ **Weekly digest email** (Resend; highlights → drives to the brief; respects the pref).
- ☐ **Browser notification on new brief** (web push or in-app toast on first visit; start in-app).

### Batch 5 — Momentum (the acted-on loop)
- ☐ **Save / Snooze / Dismiss on recommendations** (action store table) + "cleared this week"
  momentum strip; per-play feedback already persists (brief_feedback).
- ☐ **Severity → slider auto-recalibration** (recordPlayFeedback already wired; carry reviewer
  severity onto plays).

### Held / discuss
- **Layer 4 event elasticity** (busy-times backtest) — design discussion with Bryan.
- Old 11 module pages: retire vs drill-down conversion — decide after evaluation.
