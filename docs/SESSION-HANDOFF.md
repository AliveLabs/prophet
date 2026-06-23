# Ticket — Session Handoff (start here)

**Updated 2026-06-23 (end of a long admin-Phase-6 session).** Full worklist: `docs/PRIMARY-WORKLIST.md`.
Memories to read first: `[[ticket-admin-panel-and-demo-data]]`, `[[bryan-finished-tools-not-good-enough]]`,
`[[ticket-insight-engine-deep-review]]`.

## Prod state
- **`origin/main` = `8c9aa84`** — `spine-rewrite` == `main` (synced). app.getticket.ai healthy.
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
