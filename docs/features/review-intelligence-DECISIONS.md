# Review Intelligence — decisions for Bryan (morning review)

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

## Watch items
- The `ReviewSentiment.source` "outscraper" enum value + file-header comment are
  aspirational/dead (Outscraper only does busy-times). Left as-is; cleanup candidate.
- Types regen (`supabase gen types`) still pending repo-wide; new table uses the same
  loose-cast convention as `insight_pool_entries` until then.
