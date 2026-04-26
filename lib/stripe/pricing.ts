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

type PaidTier = Exclude<SubscriptionTier, "free" | "suspended">

export type PriceInfo = {
  industry: IndustryType
  tier: PaidTier
  cadence: Cadence
  priceId: string
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
