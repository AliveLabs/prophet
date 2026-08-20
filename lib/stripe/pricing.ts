// Stripe price ID <-> (industry, tier, cadence) resolver. Env-var driven so
// the same build runs against test-mode and live-mode price IDs by swapping
// Vercel env values.
//
// PRICE_MAP is evaluated lazily per-call so tests can mutate process.env.

import type {
  Cadence,
  SubscriptionTier,
} from "@/lib/billing/tiers"
import type { IndustryType } from "@/lib/verticals"

type PaidTier = Exclude<SubscriptionTier, "suspended">

export type PriceInfo = {
  industry: IndustryType
  tier: PaidTier
  cadence: Cadence
  priceId: string
}

// ALT-687 — the metered add-ons. Locations and competitors are PURCHASED QUANTITIES now, not
// tier caps, so a subscription carries a base item plus up to two add-on items whose Stripe
// `quantity` is the number bought. These are separate price IDs, resolved the same env-var way.
export type AddOnKind = "location" | "competitor"

// An additional LOCATION is priced per plan, because "additional locations run on the same plan as
// the first" has to mean the same price: a flat rate against Starter's $99 base would let a
// customer save money by splitting into two accounts. A competitor is flat, and far below either
// base, so it carries no tier. `SELF_SERVE_ADDON_TIERS` is what exists in Stripe; Multi-Location is
// contract-only and quoted, so it has no add-on price ID.
export const SELF_SERVE_ADDON_TIERS = ["entry", "mid"] as const
export type AddOnTier = (typeof SELF_SERVE_ADDON_TIERS)[number]

export type AddOnPriceInfo = {
  industry: IndustryType
  kind: AddOnKind
  /** Present for `location`, absent for the flat `competitor` add-on. */
  tier?: AddOnTier
  cadence: Cadence
  priceId: string
}

function addOnEnvKey(
  industry: IndustryType,
  kind: AddOnKind,
  cadence: Cadence,
  tier?: AddOnTier
): string {
  const brand = industry === "restaurant" ? "TICKET" : "NEAT"
  const tierPart = tier ? `_${tier.toUpperCase()}` : ""
  return `STRIPE_PRICE_ID_${brand}_ADDON_${kind.toUpperCase()}${tierPart}_${cadence.toUpperCase()}`
}

export function resolveAddOnPriceId(
  industry: IndustryType,
  kind: AddOnKind,
  cadence: Cadence,
  tier?: AddOnTier
): string | null {
  return process.env[addOnEnvKey(industry, kind, cadence, tier)] ?? null
}

/** Reverse lookup for a webhook payload. Returns null for the base price and for anything we do
 *  not recognise, which is what keeps this safe to ship before the add-on prices exist in Stripe:
 *  every item resolves to null, purchased quantities stay 0, and behaviour is unchanged. */
export function resolveAddOnPriceInfo(priceId: string | null | undefined): AddOnPriceInfo | null {
  if (!priceId) return null
  const industries: IndustryType[] = ["restaurant", "liquor_store"]
  const cadences: Cadence[] = ["monthly", "annual"]
  for (const industry of industries) {
    for (const cadence of cadences) {
      // Flat competitor add-on: no tier in the key.
      if (process.env[addOnEnvKey(industry, "competitor", cadence)] === priceId) {
        return { industry, kind: "competitor", cadence, priceId }
      }
      for (const tier of SELF_SERVE_ADDON_TIERS) {
        if (process.env[addOnEnvKey(industry, "location", cadence, tier)] === priceId) {
          return { industry, kind: "location", tier, cadence, priceId }
        }
      }
    }
  }
  return null
}

function envKey(
  industry: IndustryType,
  tier: PaidTier,
  cadence: Cadence
): string {
  const brand = industry === "restaurant" ? "TICKET" : "NEAT"
  return `STRIPE_PRICE_ID_${brand}_${tier.toUpperCase()}_${cadence.toUpperCase()}`
}

export function resolvePriceId(
  industry: IndustryType,
  tier: PaidTier,
  cadence: Cadence
): string | null {
  return process.env[envKey(industry, tier, cadence)] ?? null
}

export function resolvePriceIdOrThrow(
  industry: IndustryType,
  tier: PaidTier,
  cadence: Cadence
): string {
  const id = resolvePriceId(industry, tier, cadence)
  if (!id) {
    throw new Error(
      `Missing env var ${envKey(industry, tier, cadence)}; run scripts/stripe/setup.ts and copy the output into .env.`
    )
  }
  return id
}

// Reverse lookup: given a Stripe price ID (from a webhook payload), figure
// out which (industry, tier, cadence) triple it maps to. O(12) table scan
// on every call -- fine; webhooks are low-volume and the map is tiny.
export function resolvePriceInfo(priceId: string | null | undefined): PriceInfo | null {
  if (!priceId) return null
  const industries: IndustryType[] = ["restaurant", "liquor_store"]
  const tiers: PaidTier[] = ["entry", "mid", "top"]
  const cadences: Cadence[] = ["monthly", "annual"]
  for (const industry of industries) {
    for (const tier of tiers) {
      for (const cadence of cadences) {
        if (process.env[envKey(industry, tier, cadence)] === priceId) {
          return { industry, tier, cadence, priceId }
        }
      }
    }
  }
  return null
}

// Anti-tamper check for checkout. The API route receives {tier, cadence} from
// the client but looks up price via org.industry_type on the server, so a
// client can't smuggle a Ticket price ID into a Neat org. This helper lets the
// webhook do the same check in reverse: the price ID on a subscription event
// must match the org's industry_type. If it doesn't, we log + accept (so we
// don't blackhole a real payment) but flag the mismatch for ops review.
export function priceBelongsToIndustry(
  priceId: string,
  industry: IndustryType
): boolean {
  const info = resolvePriceInfo(priceId)
  if (!info) return false
  return info.industry === industry
}
