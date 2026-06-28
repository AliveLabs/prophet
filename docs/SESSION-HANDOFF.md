# Ticket — Session Handoff (start here)

> ## ▶ START HERE — 2026-06-28 · CODE-HEALTH AUDIT COMPLETE (only deferred visibility loops + cosmetic casts remain, both optional)
>
> **▶ The 3 open Bryan-decisions are RESOLVED (2026-06-28):**
> 1. **SEC-Low L1/L2 — DONE:** the temp `/api/health/stripe-mode` diagnostic route was DELETED (Stripe work closed). Closes L1; L2 (its query-string token) is moot. (`app/api/health/pipeline` watchdog kept.)
> 2. **Stale branches — DONE:** the 6 (`dev`, `feature-anand`, `feature-henry`, `feature/api-sandbox`, `feature/vatic-brand-refresh`, `feature/verticalization`) deleted from origin.
> 3. **Test webhook secret — NO ACTION NEEDED:** it's a Stripe CLI `stripe listen` TEST-mode secret, minted fresh per local session — not a stored credential. The old exposed one is ephemeral/dead. Nothing to rotate; future webhook testing just runs `stripe listen` again.
>
> **What's left — both OPTIONAL:** ENG-M6 is mostly DONE (shared tested `mapWithConcurrency` helper + insights competitor-read/analysis parallelization + traffic batch-insert, HEAD `8ef8b3d`); only the `visibility.ts` DataForSEO SERP/rank loops are DEFERRED (concurrency risks 429 throttling at fleet scale + live-only/untested — reliability > latency). Plus cosmetic redundant `as unknown as <Store>` casts in cron/actions/preview (compile fine; pure tidy-up). The audit's §2/§8 priority list is otherwise fully cleared.
>
> **Master reference:** `~/vault/inbox/prophet-code-health-audit-2026-06-26.md` (a 4-pass A−/B audit;
> its **§2 priority list** + **§8 next-session plan** are the SSOT for what's left). Work the OPEN items
> below — that's the agreed next focus. The design concepts (A–D) are ALSO still pending Bryan's pick;
> tracked at the bottom of this block so they don't get lost.
>
> ### ✅ Shipped THIS session (2026-06-27 session 2, on `main`, CI green) — don't redo:
> - **Type regen (ENG-M4 prereq)** `e13001d` — `types/database.types.ts` regenerated from prod (spine tables now typed).
> - **TEST-2** `ba63208` — Stripe webhook dispatcher + helpers + org-access resolution tests (the 2 highest-blast-radius untested paths). 801 unit tests now.
> - **SEC-H1** `02dd457` — `proxy.ts` re-validates the impersonation ACTOR's admin status each request (teardown on demotion); dedicated `IMPERSONATION_SIGNING_SECRET` (backward-compatible — falls back to the service-role key).
> - **SEC-M2 + SEC-H2/H3 rate-limiting** `707e71d` — new `lib/http/rate-limit.ts` (Upstash, FAIL-OPEN) on waitlist (IP+email) / quick-tip / places; waitlist `listUsers(1000)` scan → targeted `profiles` lookup.
> - **ENG-H3** `df60927` — a scheduled brief defers until its location's data jobs settle (90-min cap), not the wall clock; `first_run` brief exempt.
> - **SEC-M4 + ENG-Low L2** `2b5d944` — `normalizeRole` unknown→`admin` (not super_admin god-mode) + alert; harm verdicts matched by position, not model-returned index.
>
> ### ✅ Already shipped from the audit (2026-06-26→27, all on `main`, CI green) — don't redo:
> - **SEC-C1** committed-secret file removed (`b0b6dcd`) + truncated key-fragments scrubbed from a doc
>   (`170e2fc`) + 3 stale branches that carried the blob deleted + **GitHub Secret Scanning + Push
>   Protection enabled**. (Main-history rewrite DECLINED — test-mode secret in an already-public repo, low ROI.)
> - **SEC-C2** trial-reminders fail-open cron auth → fail-closed (`9bbf8e5`).
> - **SEC-M1** VERIFIED not a leak (job routes use the RLS user client + org-scoped builders) + added a
>   defense-in-depth guard to `ambient-feed`.
> - **SEC-H2/H3** the 3 unauth API-key endpoints (quick-tip, places autocomplete/details) now require a
>   session + input cap + server-action direct-lib fix (`c7ec507`).
> - **ENG-H1/H2** shared `lib/http/fetch-with-retry.ts` (timeout + retry, 9 tests) routed through all 8
>   provider clients (`bed651d`).
> - **TEST-1** stood up CI (`.github/workflows/ci.yml`: typecheck + unit tests on push/PR) + `typecheck` script.
> - **ENG-Low L1** voice.ts infinite-loop landmine fixed · **L3** generateStructured logs the floor degrade ·
>   **ENG-M1** highest-signal swallowed read-errors now logged (dossier competitor read + insights SEO reads).
> - Two confirmed bugs from the review: **events `dowOf()`** UTC→venue-local day-of-week + **org
>   cascade-delete vs worker race** guard (`6629143`, +13 tests). README rewritten.
>
> ### ✅ Shipped in the 2026-06-27 session-3 cleanup pass (on `main`) — don't redo:
> SEC-M3 applied to prod (`1c0b677`) · Upstash provisioned + connected + deployed → rate-limiting LIVE (`e30bc01`) · `IMPERSONATION_SIGNING_SECRET` set in Vercel prod · **ENG-M4 cast sweep** done across the core engine read paths — lib/insights (`d0656a7`) + lib/skills & ask-history (`68120b4`) now use the typed client (Store types aliased to `SupabaseClient<Database>`, casts dropped) · **ENG-M5** dead `.gte` fallbacks in feedback-rollup removed · **SEC-Low L3** price/industry-mismatch alert (`077a1fc`) · **ENG-M2** extracted `buildCandidatePool` + `applyGrassrootsFloor` from synthesize (`ea57146`). 802 unit tests; tsc + build + CI green.
>
> ### 🔴 OPEN — what's actually left:
> - **ENG-M6 (mostly DONE 2026-06-28, reliability-first):** shipped the reliability-positive parts — shared tested `mapWithConcurrency` (`lib/jobs/concurrency.ts`) + insights competitor reads/analysis (bounded-3) + traffic batch-insert (atomic per competitor). DEFERRED: `visibility.ts` DataForSEO SERP/rank loops (concurrency risks 429 throttling at fleet scale + live-only/untested). NOTE: the parallelized pipelines are LIVE-ONLY — verify via a real cron run, not CI.
> - **Leftover redundant casts (low value, cosmetic):** the cron routes (build-brief/ask-mining/rollup-feedback/ingest) + app actions (brief-actions/ask/knowledge-review) + preview-data still pass `... as unknown as <Store>`. Now that the lib Store types ARE the real client, these compile fine (redundant, not broken). feedback-distill-run's `DistillStore` + the cron `IngestStore`/`AskMiningStore` were left narrow.
> - **Done 2026-06-28:** SEC-Low L1/L2 (temp `/api/health/stripe-mode` route DELETED — L2 moot) · the 6 stale remote branches deleted from origin · test webhook secret = no action (Stripe CLI ephemeral `stripe listen` secret, regenerated per session — not a stored credential).
>
> <details><summary>Original 2026-06-26 ordered list (historical — most now shipped)</summary>
> 1. **TEST-2** — unit-test `app/api/stripe/webhook` + `lib/auth/org-access` (the two highest-blast-radius
>    paths with ZERO coverage; the webhook is the single most dangerous untested code). CI now exists to catch regressions.
> 2. **ENG-M4** (highest-value cleanup) — regenerate `types/database.types.ts` now the spine tables are live
>    in prod, then delete the ~16 `as unknown as <Store>` loose-client casts + their dead fallbacks
>    (`feedback-rollup.ts`, `evergreen.ts`, `daily-brief.ts`, `insight-pool.ts`, `ask/history.ts`, etc.).
>    ⚠️ NEEDS prod DB access to regenerate types (classifier-gated — get Bryan's OK / he runs `supabase gen types`).
> 3. **SEC-H1** — re-assert `isPlatformAdmin` on each impersonation use (a demoted admin keeps a live
>    session until exp); move impersonation-cookie signing off `SUPABASE_SERVICE_ROLE_KEY` to a dedicated
>    `IMPERSONATION_SIGNING_SECRET`. (`lib/auth/impersonation-cookie.ts`, `proxy.ts`.)
> 4. **SEC-M2** — `/api/waitlist`: add rate limiting (per IP + per email), replace the
>    `supabase.auth.admin.listUsers({perPage:1000})` scan with a targeted lookup, keep responses uniform
>    (removes the email-existence oracle). (Needs a KV store — Upstash via Vercel marketplace.)
> 5. **SEC-M3** — `REVOKE SELECT … FROM anon, authenticated` on the `marketing.*` Stream-2 tables (a
>    latent `GRANT` footgun) + a test asserting no permissive `authenticated` policy on `marketing.*`.
> 6. **ENG-H3** — gate `build-brief` (08:00) on "all today's data jobs for this location are `done`"
>    rather than wall-clock; reuses `pipeline_runs`. Borderline at ~14 locations today, bites as the fleet grows.
> 7. **Rate-limit the now-auth-gated endpoints** (SEC-H2/H3 follow-up) + restrict the Google key by
>    referrer/IP in GCP — both need infra/console (KV + GCP).
> 8. **Lower:** SEC-M4 (normalizeRole fail-open→read_only + NOT-NULL backfill) · SEC-Low L1–L3 (remove the
>    temp stripe-mode diag route; query-string token→header; pricing-mismatch alert) · ENG-M2 (extract
>    `synthesize()`'s pool-build + grassroots-floor into pure fns) · ENG-M3/M5/M6 (typed snapshot writers;
>    bounded-concurrency on the serial SEO/insights/feedback loops) · ENG-Low L2/L4 · remaining low-signal
>    ENG-M1 logs · delete the 6 other stale branches (`dev`, `feature-*`) · optional rotate the test webhook secret.
> </details>
>
> ### 🎨 DESIGN CONCEPTS — still pending Bryan's pick (DON'T lose track):
> Four round-2 light concepts, all live + in `docs/design-concepts/round2/` (`README.md` describes each):
> **A** The Pass `debeba1e` · **B** Widget Board `2594e887` · **C** Visual-Forward `b8ec6e0d` ·
> **D** The Locale (the wild swing — location-as-canvas + soft panels + mobile) `d8e83a64`. Decision =
> pick a direction (or fusion) → reel in → apply to the real app + close the UX gaps
> (`docs/ux-gaps-tracker.md`, esp. social-handle/competitor management). Standing wild-concept constraints:
> stay light; extend (not limited to) the Ticket palette; background as a prominent canvas element; max
> negative space; concepts must SCALE across location types; always include mobile. Memory:
> `[[ticket-design-gap-rootcause]]`. **NOTE: design = concepts only, NOT applied to the app yet.**
>
> ### Ops facts the next session needs:
> Deploy = push to `main` → Vercel auto-deploys (Bryan authorized direct main pushes). **CI now runs
> typecheck + unit tests on every push/PR.** Verify gate before deploy: `npx tsc --noEmit` + `npm run
> test:unit` (746 tests) + `npx next build`. PROD READS are classifier-gated in unsupervised mode (need
> Bryan's per-target OK); cron triggers via `scripts/db/cron.mts`, prod SQL via `scripts/db/sql.mts`.
> Latest `main` ≈ `8ef8b3d` (2026-06-28; 807 unit tests; CI green). SEC-M3 applied; Upstash live; ENG-M4/M5/M2 + SEC-Low L1/L2/L3 + SEC-M4 shipped; 6 stale branches deleted; ENG-M6 mostly done. Only the deferred `visibility.ts` loops + cosmetic casts remain.

---

**Updated 2026-06-26.** At-a-glance worklist: `docs/PRIMARY-WORKLIST.md` (the current SSOT — read it first).
Freshest narrative: the latest `~/vault/logs/sessions/2026-06-2x-ticket-*` logs. Memories to read first:
`[[ticket-insight-engine-deep-review]]`, `[[bryan-finished-tools-not-good-enough]]`,
`[[bryan-experts-first-requirements]]`, `[[ticket-grassroots-redemption-handoff]]`.

**Current state: the build is essentially COMPLETE and live on prod.** Track A (admin/onboarding) and
Track B (insight engine) both shipped — including the full P0–P10 sequence, PV + P5 adjacency, the P11–P17
Learning-Loop Spine (skill_knowledge / skill_feedback_rollup / skill_source_registry live, ingest verified),
§4.6 grassroots redemption, food-pairing fundamentals-only, and the 2026-06-26 hardening sprint
(budget-aware worker, venue effective-capacity probe sort, grassroots confidence calibration, doc refresh).
What remains is Bryan's decisions/curation + a small additive engineering tail — see `PRIMARY-WORKLIST.md`.
The sections below are the HISTORICAL Phase-6 / UX-rework record (kept for provenance).

## Prod state
- **`origin/main` = `6d857b0`** — `spine-rewrite` == `main` (synced). app.getticket.ai healthy.
- **Shipped this session (all on prod, Vercel green):** completable demos (A1 — wizard `mode="setup"` + `DemoSetupBanner` = Set up/Resume/Open demo), provisioning keystone (A0 `createLocationForOrgAction`), org-level "View as customer" (B1), orgless→`/onboarding` routing (A3); **A2** two-path add-location (decision screen: upgrade tier on one bill, OR `/onboarding?new=1` = separately-billed org under one login); **B3** waitlist CSV export button. Reviews: security SHIP; correctness H1/M2 (batch 1) + M1/L1/L2 (A2) fixed. ⚠️ A2 NOT live-verified (auth+Stripe local gap) — recommend a prod click-through of add-location-when-full + the `?new=1` flow.
- **HELD / needs Bryan:** **B2** broadcast-email panel = HELD (no unsubscribe infra + `broadcastEmail` bypasses the CLIENT_EMAILS_ENABLED pause — don't wire until that's resolved). **B4** triage 8 unrendered components + **B5** `app/preview/*` prototype = review details with Bryan before keep/delete. Session log: `2026-06-23-ticket-ux-rework-demos-multilocation`.
- **Deploy flow:** commit on `spine-rewrite` → `git push origin spine-rewrite` → `git push origin spine-rewrite:main` (FF) → Vercel auto-deploys. Bryan authorized the agent to push to main directly.
- **Migrations:** the agent now applies + verifies them itself via `scripts/db/sql.mts` (Supabase Management API + `SUPABASE_ACCESS_TOKEN` in `.env.local`, gated by a `.claude/settings.local.json` allow-rule). Refuses DROP/TRUNCATE without `--allow-destructive`. NOTE: in-place UPDATEs to specific prod customer orgs are still classifier-gated (need Bryan's explicit consent per-change).
- **Verify gate (every change):** `npx tsc --noEmit` + `npm run test:unit` (407 tests) + `npx next build` + an adversarial-review Workflow before deploy (caught a real bug in 6c AND serious holes in 6d — earns its keep every time).

## ✅ SHIPPED THIS SESSION (Admin Phase 6 COMPLETE — all 6a–6e live)
- **6a roles/capabilities** (`70ee014`) — `lib/auth/capabilities.ts` (3-tier matrix, normalizeRole fails-OPEN→super_admin), `withAdminAction` wrapper on all ~20 admin actions, role-mgmt UI, `proxy.ts`.
- **6b audit hardening** (`6d4645e`) — `admin_activity_log` append-only (REVOKE UPDATE/DELETE) + reason/actor_type; `logCriticalAction` = "no log⇒no action" on 5 destructive actions; Stripe-webhook system-actor logging; denied-attempt logging.
- **6c org soft-delete** (`c4e7bf5`,`8925086`,`8c9aa84`) — `deleted_at`; `purgeOrg`/`restoreOrg`; excluded from ~10 list/count/cron/export sites; deleted-banner + Deleted(N) list section; **customer-side access gate** (a soft-deleted org is inaccessible to its own members).
- **6d impersonation** (`918d2e8`) — server-side session (no portable link), signed/30-min flag cookie, CENTRAL read-only + time-box teardown in `proxy.ts`, refuses impersonating an admin + impersonation-aware admin gate (no escalation), logCriticalAction-gated, banner+Exit. **TWO review rounds** (round 1 found real holes → full redesign; round 2 SHIP).
- **6e** — per-admin destructive rate-limit (`2c2cde9`, 15/5min via audit-log intent count) + atomic SECURITY DEFINER `cascade_delete_organization` fn (`b11e85f`, all delete paths route through it).
- **Carry-overs:** clearTestData TOCTOU (`bec3065`), deleteUser tidy-write checks (`8c9aa84`). Phase-0 orphaned-social audit = **CLEAN** (0 orphans, verified on prod).
- **Infra:** `scripts/db/sql.mts` migration runner (`ed74993`); retired dead `ux-rework` Supabase branch + git branch + obsolete audit scripts (`6fb916f`).
- **Migrations applied to prod:** `..._platform_admin_roles` (Bryan ran), `..._audit_hardening`, `..._org_soft_delete`, `..._atomic_cascade_delete` (agent ran + verified).

## ➡️ REMAINING — NEXT SESSION (nothing deferred; just not yet built)
**Admin (tiny):**
- ConfirmDialog/TypedConfirmDialog extraction — cosmetic DRY across org-detail/user-detail/clear-test/waitlist confirms. Lowest value; do last.

**Engine track (LARGE — customer-facing insight pipeline; the big remaining body):**
- **PV — vision→positioning** (started, not built): `lib/skills/positioning/skill.ts` `selectInput()` ignores the dossier's `visual` (Gemini Vision `EntityVisualProfile`, `lib/insights/dossier/types.ts:146`). Wire `visual` into selectInput + the positioning prompt/knowledge so positioning plays use what the place looks like. NEXT: locate the `EntityVisualProfile` interface def + where `visual` is populated in the dossier builder, then wire + bump `positioning@v3`.
- **P5 — ADJACENT_DOMAINS adjacency:** new `lib/skills/domain-map.ts` (`ADJACENT_DOMAINS` + `selectAdjacentSignals()`); touches every producer.
- **P10 — cross-org aggregate feedback weighting:** `play_type_feedback_aggregate` migration + a second "many liked this TYPE → weight higher" multiplier with guardrails. LARGE.
- **P9 — dynamic expertise feed:** `knowledge_feeds` migration + weekly fetch/RAG + cron. Build infra; **NEEDS Bryan's curated sources** to populate.
- **Events follow-ons:** density-sampling refresh crons, L4 anomaly detection, P4 paid-events source.
- Engine plan: `docs/engine-rewrite/insight-engine-phased-plan.md` (STATUS banner stale — says NEXT=P8; reality: P0–P8 shipped, P5-adjacency/PV/P9/P10 remain).

## 🔴 NEEDS BRYAN (genuine inputs / decisions, not agent-doable)
- **Tag Bush's + Cane's `org_kind='demo'`** — his data call (classifier-gated). Both currently `'real'` on prod. ⚠️ Cane's is `trialing` + has the special "delete+recreate as demo at end-of-work" plan, so confirm intent. Via the shipped Set-Kind UI, or tell the agent "tag them" to run it.
- **P9 curated sources** (the dynamic-feed content).
- **Knowledge-review v2** (food-pairing/guerrilla prose — Chris's domain pass; `docs/engine-rewrite/skill-knowledge-review.md`).
- ⚠️ **`anand@alivemethod.com`** admin backfilled to **super_admin** (6a migration default) — review/remove via the admin Settings UI (standing Anand-skepticism).
- **Delete the dead Supabase branch DB** `eguflqjnodumjbmdxrnj` in dashboard → Branches (may have auto-removed when the git branch was deleted).
- `.env.local` is stale (dead-branch URL/keys) — `vercel env pull` to refresh other local tooling (won't restore the account-level `SUPABASE_ACCESS_TOKEN`).
