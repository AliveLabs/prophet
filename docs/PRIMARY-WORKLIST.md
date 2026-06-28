# Ticket — Primary Worklist (combined)

**Updated 2026-06-26.** Single at-a-glance source of truth across the two tracks (A = admin/onboarding
tool, B = customer-facing insight engine). Narrative handoff: `docs/SESSION-HANDOFF.md` + the latest
`~/vault/logs/sessions/2026-06-2x-ticket-*` logs. (We no longer pin a `main` SHA here — it rots; `git log`
is the truth.)

> **Headline: the build is essentially COMPLETE and live on prod.** Both tracks shipped. What remains is
> Bryan's decisions/curation + a small additive engineering tail — not new features.

> **▶ NEXT FOCUS (2026-06-27): the OPEN code-health audit items.** See the START-HERE block at the top of
> `docs/SESSION-HANDOFF.md` for the ordered list + what's already shipped; master ref is
> `~/vault/inbox/prophet-code-health-audit-2026-06-26.md` (§2/§8). Secondary, also pending: the **design
> concept pick** (A/B/C/D in `docs/design-concepts/round2/`) → apply to the app.

---

## ✅ Resolved 2026-06-26 (verified / done this session)
- [x] **Bush's + Cane's `org_kind='demo'`** — both verified `demo` on prod.
- [x] **`anand@alivemethod.com` super_admin** — verified GONE; `platform_admins` = bryan + chris only.
- [x] **Dead `ux-rework` Supabase branch** (`eguflqjnodumjbmdxrnj`) — deleted (cleared persistent flag → delete);
  prod now has only the `main` branch.

## 🔴 Needs Bryan (decisions / curation an agent can't make)
- [ ] **`.env.local` is stale** (pointed at the now-deleted branch DB) — `vercel env pull` to refresh local tooling.
- [ ] **Knowledge review v2** (food-pairing / guerrilla prose pass with Chris) → bump version → redeploy.
- [ ] **FSR/NRN on food-pairing** — keep (migration 190000's choice) vs pure-culinary; then match the seed.
- [ ] **Engagement / social-trends expert** — ideation captured (`[[ticket-engagement-social-expert-ideation]]`);
  scope when ready. Design constraint: keep it SERIOUS/credible. NOT building yet.
- [ ] **CENSUS_API_KEY** (P17b density enrichment) — optional, needs the key.
- [ ] **B4 / B5 review** — 8 unrendered components (`competitors/*`, `home/*`) + the `app/preview/*`
  prototype: keep/render/delete WITH Bryan (his prior work; both still in-tree).

---

## Track A — TicketAdmin panel + onboarding  (SHIPPED)
- [x] **Phases 0–6 COMPLETE** (P0–5 + 6a–6e Security Hardening). All live.
- [x] **UX rework** — completable demos (wizard setup-mode + DemoSetupBanner), provisioning keystone,
  org-level "View as customer", orgless→/onboarding routing, two-path add-location, waitlist CSV export.
- [ ] **B2 broadcast-email panel: HELD** (Bryan) — no unsubscribe infra + bypasses the CLIENT_EMAILS pause.
- [ ] **ConfirmDialog/TypedConfirmDialog extraction** — cosmetic DRY. Lowest value; do last.

## Track B — Insight engine  (SHIPPED)
- [x] **P0–P10 + PV + P5 adjacency** — cross-source convergence, expert roster, play-fusion, evergreen,
  per-operator rerank, Events Impact Engine + density, vision→positioning.
- [x] **P11–P17 Learning-Loop Spine** — `skill_knowledge` / `skill_feedback_rollup` / `skill_source_registry`
  live; presenter+calibration, social-counter, events validation gate, feedback rollup BAND, grassroots +
  partner_catalog, ask-mining → question_demand. External-trend ingest verified (0 ACTIVE by design — needs
  ≥2 tier-1 sources + conf≥70). Fail-soft: 0 learnings ⇒ briefs = the static-knowledge floor.
- [x] **§4.6 grassroots redemption** (Keep/Remove card actions, band retune, archetype cleanup).
- [x] **food-pairing fundamentals-only** (v1.1 obvious-pairing guardrails; external food-trend feed dropped).
- [x] **Hardening sprint (2026-06-26)** — budget-aware worker (no zombie/staleQueued at scale), venue
  effective-capacity probe sort (no mis-typed mega-venue stealing probes), grassroots confidence calibration
  (ranks on merit, not just the floor), this doc refresh.

### Additive engine tail (autonomous, not blocking)
- [ ] **Pipeline speed** — content ~334s / brief ~271s vs the 800s worker cap. The budget-aware worker now
  prevents overrun; OPTIMIZING the per-pipeline time (producer effort/model levers, prompt trim) is the
  follow-on. Producer effort=low is a fleet-wide cost/quality lever — Bryan's call (`[[ticket-model-cost-levers]]`).
- [ ] **Grassroots floor retirement** — once the confidence calibration proves out in live briefs (watch the
  `[synthesis] grassroots floor: … natural rank #N` logs), the floor can retire if grassroots ranks in on merit.
- [ ] **Culinary scrape sources** — Datassential / NRA What's Hot / US Foods distill 0 (JS-SPA / stale URL).
  LOW value now (food-pairing is fundamentals-only; they only feed `marketing`). Mostly a registry/URL fix.
- [ ] **Venue catalog data quality** — Wikidata enrichment + the effective-capacity sort mitigate it; a
  name-based demotion of clearly-ancillary venues ("auxiliary/practice field") is an optional further guard.
- [ ] **Events follow-ons** — density-refresh crons, L4 anomaly detection, P4 paid-events source.

---

## Negligible / cleanup
- ~~`/api/health/stripe-mode` TEMP ops diagnostic~~ — REMOVED 2026-06-28 (Stripe work closed; route deleted, closing SEC-Low L1/L2).
- ~8 PRE-EXISTING eslint errors in unrelated files (existing debt; gate is tsc + tests + build, not eslint).

## Recommended next
- **Bryan's plate** above unblocks the curation/tuning items. **Engineering-wise the product is done** — the
  remaining engine tail is additive (speed optimization, floor retirement, source curation), none blocking.
- Verify gate every change: `npx tsc --noEmit` + `npm run test:unit` + `npx next build` + adversarial review
  → commit on `main` → `git push origin main` → Vercel.
