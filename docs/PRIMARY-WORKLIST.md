# Ticket — Primary Worklist (combined)

**Updated 2026-06-23.** Single source of truth across the two tracks (independent subsystems, run in
parallel — A = admin/onboarding tool, B = customer-facing insight engine). `main` = `25bf2cd`.
Detailed specs: admin → `docs/admin-rebuild/`; engine → `docs/engine-rewrite/insight-engine-phased-plan.md`.
Repo handoff: `docs/SESSION-HANDOFF.md`. (This file is the at-a-glance list; the handoff has the narrative.)

---

## 🔴 Needs Bryan (unblocks / an agent can't do)
- [ ] **Demo dry-run before the 6/24 demo** — the create+onboard-a-demo flow is shipped + reviewed but NOT
  live-clicked. Walk it end-to-end on prod today so any runtime issue surfaces now, not in front of a prospect.
  (Process in `SESSION-HANDOFF.md` / chat.)
- [ ] **Tag Bush's + Cane's `org_kind='demo'`** via the Set-Kind UI on org-detail (both still `real`). Your
  data call — Cane's has the delete+recreate-as-demo-at-end-of-work plan.
- [ ] **Review/remove `anand@alivemethod.com` super_admin** (6a migration backfilled it; standing skepticism).
- [ ] **Delete the dead Supabase branch DB** `eguflqjnodumjbmdxrnj` in dashboard → Branches (may have
  auto-removed with the git branch).
- [ ] **Knowledge review v2** — `docs/engine-rewrite/skill-knowledge-review.md`: food-pairing@v1 + guerrilla@v1
  prose (you + Chris) → bump `@v2` → redeploy.
- [ ] **P9 curated sources** — the dynamic-expertise-feed content (blocks engine P9).
- [ ] `.env.local` is stale (points at retired `eguflqjnodumjbmdxrnj`; live prod `triodvdspdsuudooyura`). The
  migration runner sidesteps it; `vercel env pull` to refresh other local tooling.

> Note: the agent now applies prod migrations itself via `scripts/db/sql.mts`, so P10's migration is no longer
> a Bryan blocker — **P9 is blocked on sources, not the migration.**

---

## Track A — TicketAdmin panel + onboarding  (SHIPPED)
- [x] **Phases 0–6 COMPLETE** — P0–5 + Phase 6 Security Hardening (6a roles · 6b audit · 6c soft-delete ·
  6d impersonation · 6e rate-limit + atomic cascade). All live.
- [x] **UX rework (2026-06-23)** — A0 provisioning keystone (`createLocationForOrgAction`) · A1 complete-a-demo
  (wizard `mode="setup"` + state-aware `DemoSetupBanner` on org-detail) · B1 org-level "View as customer" ·
  A3 onboarding routing fix (orgless→/onboarding) · A2 two-path add-location (upgrade vs separately-billed
  account under one login) · B3 waitlist CSV export. All on prod (`main 25bf2cd`).
- [x] Phase-0 orphaned-social sweep — audited CLEAN on prod (0 orphans).
- [ ] **B2 — broadcast email panel: HELD** (Bryan, 2026-06-23). `broadcastEmail` stays unwired until the email
  infra has an unsubscribe path + stops bypassing the `CLIENT_EMAILS_ENABLED` pause.
- [ ] **B4 — triage 8 unrendered components** (`competitors/{intel-brief,rating-trend,signal-breakdown,
  signal-timeline}`, `home/{activity-feed,competitor-watch,intelligence-brief,metric-cards}`): render or delete
  — **review WITH Bryan** (his prior work).
- [ ] **B5 — `app/preview/*` prototype**: keep as sales demo or retire — **review WITH Bryan**.
- [ ] **ConfirmDialog/TypedConfirmDialog extraction** — cosmetic DRY across confirm dialogs. Lowest value.

## Track B — Insight engine  (the big remaining body)
- [x] **P0–P8 + P6.5 SHIPPED** — cross-source convergence, expert roster, play-fusion, evergreen (P7a/P7b
  migrations run + verified), P8 per-operator category rerank, Events Impact Engine + location-density sampling.
- [ ] **PV — vision → positioning** wiring (≈free, no migration, already scoped). **Unblocked quick win — next.**
- [ ] **P5 — `ADJACENT_DOMAINS` adjacency** (touches every producer).
- [ ] **P9 — dynamic expertise feed** (weekly curated RAG + cron + `knowledge_feeds` migration). Blocked on
  Bryan's curated sources.
- [ ] **P10 — cross-org aggregate feedback weighting** (`play_type_feedback_aggregate` migration). Largest; last.
- [ ] **Events follow-ons** — density-refresh crons, L4 anomaly detection, P4 paid-events source.

---

## Negligible / cleanup
- Dead code: unused `revalidateSocialCache` export; ops-only `/api/health/stripe-mode` route.
- ~8 **PRE-EXISTING** eslint errors in unrelated files (`lib/ai/provider`, `lib/jobs/*`, `scripts/*`,
  `components/billing/trial-banner`) — not from recent work; existing debt. (Gate is tsc + tests + build,
  not eslint-clean.)

## Recommended next
- **Engine track** is the substantive remaining work; **PV** is the unblocked quick win, then P5 → P9 (gated on
  sources) → P10; events follow-ons are additive.
- Verify gate each change: `npx tsc --noEmit` + `npm run test:unit` (407) + `npx next build` + adversarial
  review → commit on `spine-rewrite` → FF `main` → Vercel.
