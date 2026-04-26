import Stripe from "stripe"

// Single Stripe client factory used across the app. Keeping the apiVersion
// pinned here means we can audit Stripe upgrades in one spot. Caching the
// instance means checkout/webhook/portal/cron all share the same underlying
// HTTP agent and rate-limit pool.
//
// apiVersion: the library's default. We leave it implicit so `stripe` types
// (which are generated from that same version) line up. Explicit pin would
// force us to regenerate types on every bump.

let cached: Stripe | null = null

export function getStripeClient(): Stripe {
  if (cached) return cached
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not configured")
  }
  cached = new Stripe(key, {
    typescript: true,
    appInfo: {
      name: "vatic",
      url: "https://getvatic.com",
    },
  })
  return cached
}
