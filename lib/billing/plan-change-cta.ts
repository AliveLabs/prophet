// ---------------------------------------------------------------------------
// The label on a plan-change tile's button (ALT-770).
//
// This is four lines of branching that used to live inline in a nested ternary chain inside
// app/(dashboard)/settings/billing/plan-change-tiles-pass.tsx. It is extracted for one reason:
// `vitest` collects only `tests/unit/**/*.test.ts` and never `.tsx`, so logic inside that
// component could not be asserted at all. The decision that was silently wrong for months was
// the decision that no test could reach, which is the pattern this repo keeps rediscovering.
//
// What it is deciding is the text on the button a customer presses to change what they pay, so
// the honest fallback matters as much as the happy path: when the direction cannot be justified
// (see planChangeDirection, which answers "unknown" for an unranked or unrecognised tier) this
// names the destination instead of guessing "Upgrade" or "Downgrade". "Switch to Starter" is
// true whatever the customer is on today.
// ---------------------------------------------------------------------------

import type { Cadence, PlanChangeDirection } from "./tiers"

export type PlanChangeCtaInput = {
  /** This exact tile IS the plan the customer is on, cadence included. */
  isCurrentPlan: boolean
  /** A change request for this tile is in flight. */
  isLoading: boolean
  /** Same tier as today, different cadence: a billing-period switch, not a plan change. */
  isSameTier: boolean
  cadence: Cadence
  direction: PlanChangeDirection
  /** This tile's own operator-facing plan name, for the neutral fallback. */
  displayName: string
}

export function planChangeCta(i: PlanChangeCtaInput): string {
  // Order is load-bearing and preserves the original component's precedence: the current plan
  // reads "Current plan" even mid-request, because its tile is disabled and can never be the
  // one loading.
  if (i.isCurrentPlan) return "Current plan"
  if (i.isLoading) return "Changing…"
  if (i.isSameTier) {
    return i.cadence === "annual" ? "Switch to annual →" : "Switch to monthly →"
  }
  if (i.direction === "upgrade") return "Upgrade →"
  if (i.direction === "downgrade") return "Downgrade →"
  // "same" cannot reach here (isSameTier caught it) and "unknown" means we genuinely do not know
  // which way this move goes. Name the destination rather than assert a direction.
  return `Switch to ${i.displayName} →`
}
