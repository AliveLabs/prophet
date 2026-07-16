# Review Intelligence (ALT-347 → ALT-355)

Origin: Bush's Chicken demo 2026-07-15. Reviews are the operator's #1 pain: which negatives
are genuine, how serious they are, and how to respond. This feature turns the live-fetched,
throwaway Google review data into a persisted, scored, triageable surface.

**Hard guardrail (Bryan):** Ticket surfaces authenticity + severity to prioritize and improve
RESPONSES. It never recommends removal and never coaches removal-gaming. Respond, don't remove.

## Architecture (follows existing patterns 1:1)

| Piece | Pattern followed | New code |
|---|---|---|
| `location_reviews` table | `insight_pool_entries` (RLS, non-partial unique upsert key) | `supabase/migrations/20260716090000_location_reviews.sql` |
| Review capture | own-snapshot persistence in `load_location_data` step | `lib/reviews/store.ts` + wiring in `lib/jobs/pipelines/insights.ts`, `lib/insights/dossier/build.ts` |
| Scoring pass (authenticity + severity, ONE batched call) | `analyzeReviews` (GATHER-time LLM pass, fail-soft) | `lib/reviews/scoring.ts` |
| Reviewer signals (own-data only) | pure code, no LLM | `lib/reviews/reviewer-signals.ts` |
| Genuineness blend + make-good mapping | pure fns, unit-tested, tunables in one place | `lib/reviews/make-good.ts` |
| `generosity_threshold` | `brand_tolerance` column + slider + server action | migration + `settings/*` |
| `/reviews` surface | insights page composition (`.pv-*` head, `tk-*` body) | `app/(dashboard)/reviews/*` |
| Response drafts | server action + `generateStructured`, no thinking | `lib/reviews/draft.ts`, `app/(dashboard)/reviews/actions.ts` |
| Triage/verdict capture | band-style abstraction (`review-signals.ts`), provisional weights | `lib/reviews/review-signals.ts` |

## Data notes
- Google Places field mask already returns full review objects; we now RETAIN
  `name` (stable review id), `publishTime` (absolute), `authorAttribution` (name + uri),
  `googleMapsUri` (deep link for responding). No new external calls, no cost change.
- Places caps at ~5 reviews per fetch. We ACCUMULATE across daily builds (upsert on
  stable id), so the corpus grows over time. Full-history backfill (Google Business
  Profile API for owned locations — also enables in-product reply posting) is the
  documented next step, not in this build.
- Scoring is differential: only unscored rows (or rows below current `score_version`)
  are sent, in ONE structured-output call per location per build. Sonnet tier, no
  thinking. Fallback = rows stay unscored (never fabricated scores); unscored rows
  render neutrally in the UI.

## Severity × authenticity → recommended action
`recommendMakeGood()` in `lib/reviews/make-good.ts`:
- authenticity below the caution band → capped at `respond` (never give-aways on
  suspect reviews), regardless of severity.
- red-flag reviews (deterministic phrase list, reused from sentiment.ts) → `respond`
  + flagged for owner attention (crisis handling stays human).
- otherwise severity cut-points for `discount` / `comp` shift with
  `locations.generosity_threshold` (0 = respond-only posture, 100 = generous).
All tunables in `MAKE_GOOD_TUNING` (single source of truth), pure + unit-tested.
