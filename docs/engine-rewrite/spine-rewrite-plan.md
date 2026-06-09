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
**Status: 3a DONE (`cc3c16c`, live-verified). 3b (chunking) + edge-fn retirement remain.**
- ☑ **3a — durable queue + worker.** `signal_jobs` queue + `claim_signal_jobs` (FOR UPDATE SKIP
  LOCKED); daily cron ENQUEUES per-(location,pipeline) jobs (social explicit; insights delayed 15m);
  `/api/cron/worker` (every 5m) drains one pipeline/job with backoff retries + honest `pipeline_runs`
  outcomes (freshness-aware for social). Applied to branch + live-verified (weather→fresh→done).
- ☐ **3b — per-entity chunking** via the `signal_jobs.cursor` for the still-heavy pipelines (content
  scrape ~9min, social collect, photos vision) so no single JOB can exceed 300s either. (3a fixed the
  aggregate timeout; these per-pipeline ones remain.) The visual-analysis step is currently skipped in
  the scheduled path (`SKIP_STEPS`) as an interim guard.
- ☐ **Confirm + retire** the orphaned Supabase edge functions (verify deploy/schedule first).

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
- Apply the same additive migrations to **prod** Supabase (leads tables untouched). Optionally
  backfill `content_as_of` on existing prod rows. Your explicit per-migration sign-off; I provide
  exact SQL and can apply it if granted access, else hand you click-by-click.

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
