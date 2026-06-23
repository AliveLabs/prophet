# Ticket — Session Handoff (start here)

**Updated 2026-06-22.** Quick orientation for the next session. Full worklist: `docs/PRIMARY-WORKLIST.md`.

## Prod state
- **`origin/main` = `2565d69`** — app.getticket.ai healthy (verified via the watchdog/health endpoint).
- **Deploy flow:** commit on `spine-rewrite` → `git push origin spine-rewrite` → `git push origin spine-rewrite:main` (clean FF) → Vercel auto-deploys `main`. Verify with `vercel ls`.
- **Verify gate (every change):** `npx tsc --noEmit` + `npm run test:unit` (344 tests) + `npx next build`. All green before commit. Each phase also gets a folded adversarial review (Workflow) before deploy — it's caught a real bug every time.

## ⚠️ Standing gotchas (read before touching data/infra)
- **`GetTicket/.env.local` points at the DEAD Supabase project** (`eguflqjnodumjbmdxrnj`). Live prod = **`triodvdspdsuudooyura`**. Do NOT trust local DB queries as prod — verify via `GET /api/health/pipeline` (it reads the right DB server-side; auth token is in Vercel env + the GitHub secret). Fix pending: `vercel env pull .env.local --environment=production`.
- **DDL is Bryan's** — hand him exact SQL for the Supabase editor; don't run migrations or ad-hoc service-role prod writes.
- Memories to read first: `[[ticket-insight-engine-deep-review]]`, `[[ticket-pipeline-stall-and-watchdog]]`, `[[ticket-events-keyword-monoculture]]`, `[[ticket-admin-panel-and-demo-data]]`, `[[bryan-finished-tools-not-good-enough]]`.

## Shipped recently (all in prod)
Engine: **P0–P6.5** + **P7a** (dismissal cooldown, active) + **P7b** (persist+resurface, ⚠️ migration pending). Admin: **Phases 0–5** (Bryan). Ops: **pipeline watchdog** (external GitHub-Actions heartbeat, fully armed + alert delivery verified; daily 13:00 UTC; Slack + email to bryan+chris; reusable `test_alert` drill).

## 🔴 Pending on Bryan (unblocks / activates shipped work)
1. **Run the P7b migration** — `supabase/migrations/20260622210000_evergreen_plays.sql` (Supabase SQL editor). Resurfacing is a no-op until then.
2. **Fix `.env.local`** (the env pull above).
3. **Knowledge review** — `docs/engine-rewrite/skill-knowledge-review.md` (Bryan + Chris).

## ➡️ Next candidates (pick per priority)
1. ⚠️ **Events keyword-monoculture** — the events pipeline only ever queries the generic `"events"` keyword, so Google Events buries stadium mega-events and depth-10 truncation drops them: **World Cup matches one block from Raising Cane's were never fetched.** Upstream-fetch bug, high business impact. **Build-ready plan: `docs/engine-rewrite/events-keyword-fix-plan.md`** (root cause confirmed in-code + file:line change surface + slices). 🔴 **Two decisions pending Bryan first (D1 cost/keyword budget, D2 venue-radar source)** — answer those, then Slice A (keyword expansion) is a fast, bounded build. **Strongest next candidate.**
2. **Engine P8** — per-operator category rerank controls (settings sliders; `locations.settings.categoryPriors`, no migration). Plan: `docs/engine-rewrite/insight-engine-phased-plan.md`.
3. **Admin Phase 6** — security hardening (roles/caps, audit, soft-delete, impersonation, rate-limits). Spec: `docs/admin-rebuild/phase-6-handoff.md`. Security-critical; Bryan's track.
Then engine P9 (dynamic trends feed — needs Bryan's curated sources) / P10 (cross-org aggregate).
