# Overnight 2026-06-26 — Backlog for Bryan + Claude (review together)

Things scoped but intentionally NOT auto-shipped tonight (need calibration, a product call, or are bigger
than one safe overnight change). Grouped by workstream. Shipped items are in the session log / PRIMARY-WORKLIST.

## #3 Ranking — shipped L1/L2/L4; these need your call
- **L3 — category-prior rebalance** (`lib/skills/scoring-config.ts:119-143`). Today demand=1.0, convergence=1.0,
  positioning=0.95, reputation=0.92, operations=0.85. **RECOMMENDATION: HOLD / don't change yet.** Evidence: across
  all 37 briefs, convergence (competitive) is already the #1 rank-1 category (8 rank-1) AHEAD of demand (5). With
  L1 removing the "demand leads" prompt bias + L4 making events-high-confidence harder, the structural bias is
  addressed without touching priors — lowering demand now would likely OVERCORRECT. Revisit only if post-deploy
  briefs still over-weight weather/events. The 0-100 weight stays yours.
- **L6 — wire `importance` to novelty** (`scoring-config.ts:97-104`, neutral 50 today). The most principled fix
  for "I keep seeing the same weather/events": penalize a play whose evidence ref appeared in recent briefs,
  reward fresh ones. Fail-soft (defaults to 50 when no history). Medium build (adds a brief-history lookup).
  HIGH value — recommend building next. Held only because it's bigger than a one-line safe change.
- **L5 — auto-suppress recurring event-type plays after N days** (`synthesis.ts` new gate). High risk (a Fri
  match ≠ a Sun match); needs a per-event stableKey cooldown policy. Product call.

## #9 Design — concept VIEWS to review together (not shipped to prod)
3 concept mockups (full write-up: `docs/design-concepts/README.md`; live links below). Review, pick a
direction (or a fusion), THEN we apply it to the real components. Do not ship a restyle until you've chosen.
- MILD "The Front Page": https://claude.ai/code/artifact/03ce04f5-41b5-452d-90fe-a95ee0839e3c
- MEDIUM "The Score Spine": https://claude.ai/code/artifact/2cbffb6d-372f-4d07-98d9-3cac0f84022f
- WILD "The Overnight Edition": https://claude.ai/code/artifact/b06827d4-ee4d-4d21-a3aa-475d43f0bd1b
(also committed as standalone HTML in `docs/design-concepts/`.)

## #8 Image analysis — verified GOOD; brief at `docs/image-analysis-brief-2026-06-26.md`. Fixes not shipped:
- **Fix 1 (HIGH leverage):** the 12 deterministic visual-insight RULES (`lib/social/visual-insights.ts`) read
  only aggregate scores → generic titles. Make them cite the specific content the Gemini tagger already
  produces (subcategories, lighting patterns, the unused ownerOrStaffPresent/steamOrMotion). Kills the generic smell.
- **Fix 3:** raise the 10-post/profile vision cap + harden the Supabase-Storage gate (coverage ~50% of media
  posts today). Cost/latency lever — your call.
- **Fix 4:** real menu-board OCR comparison (Places photos already OCR `menu_board`).
- Model stays `gemini-2.5-flash` (correct; the rich output proves it). No change.

## (filled in as the night continues)
