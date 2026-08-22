// ALT-689: buying and removing add-on quantities.
//
// The customer-facing half of the metered pricing model. Until this exists, every expansion is a
// support conversation and we lose the easiest revenue we have.
//
// ── Why the decision logic is pure and separate from the Stripe calls ────────────────────────
//
// Everything that can refuse a purchase lives in `planAddOnChange`, which takes a plain context
// object and returns either an intended mutation or a typed refusal. No network, no Stripe client.
// That is what makes the safety rules unit-testable: vitest collects no .tsx and mocks no Stripe,
// so a rule that only exists inside an API route is a rule with no test. Every refusal below is a
// real failure mode, and several are ones this repo has already shipped once.

import type { Cadence, SubscriptionTier } from "@/lib/billing/tiers"
import { addOnLocationPrice, ADD_ON_PRICING, tierDisplayName } from "@/lib/billing/tiers"
import type { AddOnKind, AddOnTier } from "./pricing"
import { SELF_SERVE_ADDON_TIERS } from "./pricing"

/** What the caller wants to end up with. Absolute, not a delta: a delta races with itself if the
 *  customer double-clicks, and an absolute target is idempotent. */
export type AddOnRequest = {
  kind: AddOnKind
  /** The TOTAL quantity wanted, not the change. 0 removes the add-on entirely. */
  quantity: number
  /** Required for `competitor`: slots are allocated per location (ALT-756). */
  locationId?: string | null
}

export type AddOnContext = {
  tier: SubscriptionTier
  /** The subscription's cadence, read off its BASE price. Add-ons must match it. */
  cadence: Cadence | null
  /** Stripe subscription status, normalised the way payment_state is. */
  trialing: boolean
  hasSubscription: boolean
  /** Current billed quantity for this add-on kind. */
  currentQuantity: number
  /** For competitors: slots already allocated across OTHER locations than the one being changed. */
  allocatedElsewhere?: number
}

export type AddOnRefusal = {
  ok: false
  /** Machine-readable so the UI can offer the right next step rather than printing an error. */
  reason:
    | "no_subscription"
    | "trialing"
    | "not_self_serve_tier"
    | "cadence_unknown"
    | "invalid_quantity"
    | "location_required"
    | "unchanged"
    | "would_orphan_allocation"
  message: string
}

export type AddOnPlan = {
  ok: true
  kind: AddOnKind
  /** Absolute quantity to set on the subscription item. */
  quantity: number
  /** Positive when buying, negative when removing. Drives the copy and the proration wording. */
  delta: number
  tierForPrice?: AddOnTier
  cadence: Cadence
  /** Unit price in whole dollars, for "what will be charged" copy BEFORE confirming. */
  unitMonthly: number
  unitAnnualEffectiveMonthly: number
  locationId?: string | null
}

/** The hard ceiling per add-on. Not a business rule: a guard against a fat-fingered quantity
 *  becoming a five-figure invoice. A real chain needing more than this is a Custom conversation,
 *  which is the tier that exists for exactly that. */
export const MAX_ADDON_QUANTITY = 50

export function planAddOnChange(
  ctx: AddOnContext,
  req: AddOnRequest,
): AddOnPlan | AddOnRefusal {
  if (!ctx.hasSubscription) {
    return {
      ok: false,
      reason: "no_subscription",
      message: "Start a plan before adding to it.",
    }
  }

  // Bryan's rule, 2026-08-22: a trial cannot buy add-ons. Converting to paid comes first. Gated on
  // the subscription being in trial rather than on the tier, because the trial always runs on
  // Standard, so a tier check would not catch it.
  if (ctx.trialing) {
    return {
      ok: false,
      reason: "trialing",
      message:
        "Add-ons are available once your plan starts. Add a card or start your subscription, then come back.",
    }
  }

  // `top` (Multi-Location) has a per-location rate but no self-serve add-on price, and that is
  // deliberate: it is contract-only, so its quantities are part of a negotiated deal rather than a
  // checkout. Refuse honestly instead of resolving to a null price ID further down.
  const isSelfServe = (SELF_SERVE_ADDON_TIERS as readonly string[]).includes(ctx.tier)
  if (!isSelfServe) {
    return {
      ok: false,
      reason: "not_self_serve_tier",
      message: `${tierDisplayName(ctx.tier)} quantities are part of your agreement rather than bought online. Get in touch and we'll sort it.`,
    }
  }

  if (!ctx.cadence) {
    return {
      ok: false,
      reason: "cadence_unknown",
      message: "We couldn't read your billing period. Get in touch and we'll sort it.",
    }
  }

  if (
    !Number.isInteger(req.quantity) ||
    req.quantity < 0 ||
    req.quantity > MAX_ADDON_QUANTITY
  ) {
    return {
      ok: false,
      reason: "invalid_quantity",
      message: `Choose a quantity between 0 and ${MAX_ADDON_QUANTITY}.`,
    }
  }

  // ALT-756: a competitor slot belongs to ONE location, so a purchase has to say which.
  if (req.kind === "competitor" && !req.locationId) {
    return {
      ok: false,
      reason: "location_required",
      message: "Choose which location gets the extra competitor.",
    }
  }

  if (req.quantity === ctx.currentQuantity) {
    return { ok: false, reason: "unchanged", message: "That is already your current quantity." }
  }

  // Removing must be as easy as adding (the cancel-anytime posture), but it must not leave slots
  // allocated that are no longer paid for. `allocatedElsewhere` is what other locations hold, so
  // the new total has to cover at least that much.
  const allocatedElsewhere = ctx.allocatedElsewhere ?? 0
  if (req.kind === "competitor" && req.quantity < allocatedElsewhere) {
    return {
      ok: false,
      reason: "would_orphan_allocation",
      message:
        `Your other locations are using ${allocatedElsewhere} extra competitor${allocatedElsewhere === 1 ? "" : "s"}. ` +
        `Free one there first, or keep at least ${allocatedElsewhere}.`,
    }
  }

  const tierForPrice = req.kind === "location" ? (ctx.tier as AddOnTier) : undefined
  const price =
    req.kind === "location" ? addOnLocationPrice(ctx.tier) : ADD_ON_PRICING.competitor

  return {
    ok: true,
    kind: req.kind,
    quantity: req.quantity,
    delta: req.quantity - ctx.currentQuantity,
    tierForPrice,
    cadence: ctx.cadence,
    unitMonthly: price.monthly,
    unitAnnualEffectiveMonthly: price.annualEffectiveMonthly,
    locationId: req.locationId ?? null,
  }
}

/**
 * The per-period charge a plan implies, for "here is what you will be charged" copy.
 *
 * Deliberately NOT a proration estimate: Stripe computes proration and we show its number, because
 * an estimate that disagrees with the invoice is worse than no estimate. This is the recurring
 * amount, which is the figure a customer actually wants to know.
 */
export function addOnRecurringSummary(plan: AddOnPlan): {
  unit: number
  total: number
  perLabel: string
} {
  const unit =
    plan.cadence === "annual" ? plan.unitAnnualEffectiveMonthly : plan.unitMonthly
  return {
    unit,
    total: unit * plan.quantity,
    // Annual bills yearly but is quoted per month, so say both rather than implying a monthly debit.
    perLabel: plan.cadence === "annual" ? "/month, billed yearly" : "/month",
  }
}
