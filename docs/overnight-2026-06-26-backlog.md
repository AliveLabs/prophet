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
- 3 concept mockups (mild/medium/wild) produced by the design panel — review, pick a direction, THEN we apply
  it to the real components. Do not ship a restyle until you've chosen.

## (filled in as the night continues)
