# Ticket — Primary Worklist (combined)

**Updated 2026-06-22.** Single source of truth across the two active tracks. They are **independent**
(different subsystems), so they run in **parallel** — Track A is the admin/ops tool, Track B is the
customer-facing insight engine. `main` = `b8a9a2c` (admin P0–5 + engine P0–P6.5 + watchdog all shipped).

Detailed specs: admin → `docs/admin-rebuild/ticket-admin-rebuild-plan.md` + `phase-6-handoff.md`;
engine → `docs/engine-rewrite/insight-engine-phased-plan.md`.

---

## 🔴 Needs Bryan (unblocks / can't be done by an agent)
- [ ] **Arm the pipeline watchdog** (#1 from this session). Set a fresh `HEALTH_CHECK_TOKEN` (any random
  string) in **Vercel env** (prophet, Production) AND as a **GitHub repo secret** (Settings → Secrets →
  Actions). Optional GH secrets for channels: `SLACK_ALERT_WEBHOOK_URL`, `RESEND_API_KEY`. Then GitHub →
  Actions → *Pipeline Watchdog* → **Run workflow** to test (it'll report `down` until armed/healthy). It
  no-ops silently until armed, so no rush — but it isn't monitoring anything until then.
- [ ] **Fix `GetTicket/.env.local`** (#2). It still points at the DEAD pre-cutover Supabase project
  (`eguflqjnodumjbmdxrnj`); live prod is `triodvdspdsuudooyura`. Agent can't pull (prod-secret dump is
  gated, and the service_role key isn't otherwise reachable). **You run:**
  `vercel env pull .env.local --environment=production` (from GetTicket/). Then local tooling reads real prod.
- [ ] **Knowledge review** (#3) — `docs/engine-rewrite/skill-knowledge-review.md`: review food-pairing@v1 +
  guerrilla@v1 prose (you + Chris). Edits → bump `@v2` → redeploy.
- [ ] **Run the P7a migration** — `supabase/migrations/20260622193000_evergreen_dismissals.sql` in the
  Supabase SQL editor (the cross-day dismissal cooldown is a graceful no-op until this table exists). SQL
  was handed over in chat 2026-06-22.
- [ ] DB **migrations** for upcoming phases go via the Supabase SQL editor — agent hands you the exact SQL,
  you run it (admin Phase 6, engine P7b/P9/P10 all need migrations).

---

## Track A — TicketAdmin panel  (owner: Bryan / admin session)
Phases 0–5 SHIPPED. **Phase 6 = Security Hardening is the last phase** (large, security-critical; full spec in
`phase-6-handoff.md`). Run an adversarial review BEFORE each sub-phase deploy (Phases 2 & 4 caught 6 + 5 bugs).

- [ ] **6a. Roles / capabilities (P0)** — `role` on `platform_admins` (super_admin/admin/read_only),
  backfill admins → super_admin, `requireCapability()`, `withAdminAction(cap, fn)` wrapper across ~20 actions
  (atomic — a partial rollout can lock admins out), `/admin/*` middleware as defense-in-depth.
- [ ] **6b. Audit hardening (P1)** — make `admin_activity_log` append-only (REVOKE UPDATE/DELETE; inserts via
  SECURITY DEFINER fn); before/after snapshots + required `reason` on destructive actions; "no log ⇒ no
  action"; log Stripe webhook state changes.
- [ ] **6c. Soft-delete + manual purge (P0/P1)** — `deleted_at` on `organizations`; delete actions soft-delete
  + hide; pre-delete snapshot; separate super_admin manual hard-purge; exclude `deleted_at` from all lists.
- [ ] **6d. Impersonation hardening (P0)** — session-flagged impersonation (no portable magic-link token);
  time-boxed, read-only by default, full-session banner, dual audit attribution.
- [ ] **6e. Rate limits + transactional cascades (P1)** — per-admin rate-limit on destructive actions; wrap
  multi-statement cascades in a SECURITY DEFINER fn for atomicity.
- [ ] **Carry-overs** — `deleteUser` post-cascade write checks; `clearTestData` pass previewed IDs (TOCTOU);
  extract shared `ConfirmDialog`; tag Bush's/Cane's `org_kind='demo'` via the shipped Set-Kind UI (no SQL).
- [ ] **Phase 0 loose end** — the 2026-06-22 bulk clear likely left **orphaned polymorphic
  `social_profiles`/snapshots** (not yet swept). Audit + sweep. (See `[[ticket-admin-panel-and-demo-data]]`.)

## Track B — Insight engine + ops  (owner: Claude / engine session)
Engine P0–P6.5 SHIPPED. Watchdog shipped (needs arming, above).

- [x] **P7a — cross-day dismissal cooldown** SHIPPED (2f638cf) — dismissed plays stay suppressed 14d across
  rebuilds. ⚠️ needs the `evergreen_dismissals` migration run (above) to activate.
- [ ] **P7b — Evergreen persist + resurface** ← NEXT. Persist saved/good plays; resurface when their
  grounding signals re-fire (relevance match). New migration `evergreen_plays`.
- [ ] **P8 — Per-operator category rerank controls** — operators boost/reorder categories per-location
  (sliders), overriding global priors. `locations.settings.categoryPriors` (no migration).
- [ ] **P9 — Dynamic expertise feed (trends)** — make skill knowledge dynamic via a weekly curated feed
  (RAG-style). Needs Bryan's curated sources + a cron + `knowledge_feeds` migration.
- [ ] **P10 — Cross-org aggregate feedback weighting** — "many liked this TYPE → weight higher" second
  multiplier with guardrails. `play_type_feedback_aggregate` migration. (Largest; last.)
- [ ] **Deferred (cheap, opportunistic):** PV (vision→positioning wiring, ≈free); P5 `ADJACENT_DOMAINS`
  adjacency (touches every producer).

---

## Recommended sequencing
- **Parallel tracks.** A (admin security) and B (engine) don't share code — run both.
- **Highest priority overall:** admin **6a (roles)** + **6d (impersonation)** — real access-control gaps.
  Don't let Phase 6 sit; it's the only thing between "internal tool" and "hardened internal tool."
- **Engine:** P7 → P8 → P9 (gated on your curated sources) → P10. PV can slot in anytime as a quick win.
- **This session:** Claude proceeds on **P7** now. The 🔴 Needs-Bryan items above are queued for you.
