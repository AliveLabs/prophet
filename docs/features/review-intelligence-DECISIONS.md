# Review Intelligence — decisions (RESOLVED by Bryan, 2026-07-17 morning)

- **D1 RESOLVED:** keep the built defaults (chips, no visible score). Litmus-test the
  name ("trust score"?) during beta.
- **D2 RESOLVED:** labels stay; default moved to 50 (right down the middle). Applied
  in code + migration.
- **D3 RESOLVED:** left nav under Competitors (as built).
- **D4 RESOLVED:** no demo seeds for review — run the REAL pipeline. Bush's first for
  Bryan's review + feedback, then all locations.
- **D5 DEFERRED:** engine-learning depth for review signals stays capture-only;
  Bryan wants a proper conversation post-push. Keep as an exploration area.
- **D6 CLOSED (no build):** never make customers authenticate to outside tools.
  A suggested reply + a link to the right spot on Google is the enduring model.
  (Kills the Google Business Profile OAuth path.)
- **D7 RESOLVED:** both migrations applied to prod 2026-07-17; feature merged so
  Bryan reviews live.

Original decision framing kept below for the record.

---

Everything below was BUILT with the stated default so nothing blocked overnight.
Each is a small, isolated change if you pick differently.

## D1. Customer-facing name for the authenticity signal
- **Default built:** no score shown; a chip cue — "Reads genuine" / "Worth a closer look" —
  with the reasoning behind a "Why" rolldown. Internal field name: `authenticity_score`.
- Bert literally asked for a "trust score." If you want that phrase (or a visible score),
  it's a one-line copy map change in `app/(dashboard)/reviews/reviews-map.ts`.

## D2. Generosity threshold default + labels
- **Default built:** `generosity_threshold` = 40, bands: ≤33 "Respond first" /
  ≤66 "Measured make-goods" / ≤100 "Generous". Conservative posture per your call.
- Decide: default value, band labels, whether it also nudges the reputation skill's
  play tone (NOT wired — flagged below).

## D3. Nav placement
- **Default built:** "Reviews" added to main nav after Competitors.
- Alternative: keep it inside Insights until beta feedback lands.

## D4. Demo data for Larry
- Built: `scripts/demo/seed-location-reviews.mts` — seeds realistic scored reviews for a
  demo location (works against prod demo org via sql.mts conventions). NOT RUN anywhere.
- Decide: which org/location to seed, and whether to run the real pipeline on a live
  location instead (real Google reviews, real scoring) for the demo.

## D5. ALT-355 depth
- Built: triage status transitions, operator genuineness verdict capture
  (`review-signals.ts` band-style map, provisional weights), resolved reviews stop
  surfacing. NOT built: feeding review verdicts into `skill_feedback_rollup` — review
  triage isn't a play; forcing it into the play rollup looked semantically wrong.
  Decide if/how review learning should reach the engine (e.g., a reviewer-signals
  prior for the reputation skill).

## D6. Review corpus depth (post-beta)
- Places API returns ~5 reviews/fetch; we accumulate daily. For full history + posting
  replies from inside Ticket, the path is Google Business Profile API (owner OAuth).
  That's the "respond without leaving Ticket" unlock — real ticket, not built.

## D7. Prod migration
- Two migrations ship in this PR (`location_reviews` table + `generosity_threshold`
  column). Both additive/fail-soft. NOT applied to prod — needs your per-action OK
  per standing rule.

## From the adversarial review (2026-07-16, overnight)
9 confirmed findings; 8 fixed in-branch (edited-review re-score reset; column-level
grants so members can't tamper with engine-owned scoring columns; missing INSERT
policy for the user-scoped manual job routes; prompt-injection hardening in the
scoring system prompt; dash guards on model rationales and drafts; scoring
chunked at 15/call so a big backlog can't truncate-stall and re-bill forever;
demo-seed contradiction). One DEFERRED:
- **Concurrent double-score (low, cost-only):** the manual /api/jobs path and the
  cron worker don't coordinate, so simultaneous runs could double one scoring
  call. Rare, bounded by chunking. Fix would be a claim column; not worth the
  surface pre-beta. Revisit if the ops dashboards ever show doubled scoring calls.
- **Residual injection risk (documented):** reviews are scored in small batches,
  so hostile review text could in principle still nudge same-batch neighbors.
  The system prompt now hardens against it and red-flag floors are deterministic;
  full isolation = per-review calls = ~15x scoring cost. Revisit only with evidence.

## Morning verification checklist
- Dark mode + mobile of /reviews on the PR's Vercel preview (light desktop verified
  overnight in a local harness; dark is token-driven by construction but UNVERIFIED
  by eyeball; the throwaway harness had a scroll quirk that made dark shots useless).
- The two migrations against prod (your per-action OK), then seed the demo location
  (D4) or run a real build on one.

## Watch items
- The `ReviewSentiment.source` "outscraper" enum value + file-header comment are
  aspirational/dead (Outscraper only does busy-times). Left as-is; cleanup candidate.
- Types regen (`supabase gen types`) still pending repo-wide; new table uses the same
  loose-cast convention as `insight_pool_entries` until then.
