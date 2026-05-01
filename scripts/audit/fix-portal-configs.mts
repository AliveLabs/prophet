// One-shot repair script.
//
// Background: scripts/stripe/setup.ts:upsertPortalConfig filters
// `list({ is_default: false })` when looking up the existing portal config
// by `metadata.vatic_key`. The original Ticket portal config was created
// with `is_default: true`, so the lookup misses it and the script creates
// a duplicate "new" Ticket config (orphan). The Vercel env var
// STRIPE_PORTAL_CONFIG_TICKET still points at the original, so the orphan
// is unused.
//
// This script:
//   1. Confirms the original Ticket config (is_default: true, brand: ticket)
//      and updates its privacy/terms URLs to the new marketing-site domains.
//   2. Updates the Neat config's privacy/terms (already done by setup.ts but
//      idempotent — re-asserting).
//   3. Deletes the orphan Ticket config from this morning's run.
//
// Safe to re-run; all updates are idempotent and the orphan deletion is a
// no-op once removed.

import { config } from "dotenv"
import Stripe from "stripe"

config({ path: ".env.local" })
config({ path: ".env" })

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { typescript: true })

const TICKET_MARKETING = "https://www.getticket.ai"
const NEAT_MARKETING = "https://www.useneat.ai"

const portals = await stripe.billingPortal.configurations.list({ limit: 100 })

let originalTicket: Stripe.BillingPortal.Configuration | null = null
let neat: Stripe.BillingPortal.Configuration | null = null
const orphans: Stripe.BillingPortal.Configuration[] = []

for (const p of portals.data) {
  const brand = p.metadata?.brand
  if (brand === "ticket") {
    if (p.is_default) originalTicket = p
    else orphans.push(p)
  } else if (brand === "neat") {
    neat = p
  }
}

console.log("Discovered:")
console.log(`  Original Ticket (is_default=true): ${originalTicket?.id ?? "MISSING"}`)
console.log(`  Neat:                              ${neat?.id ?? "MISSING"}`)
console.log(`  Orphan Ticket configs:             ${orphans.map((o) => o.id).join(", ") || "(none)"}`)
console.log()

if (originalTicket) {
  console.log(`Updating original Ticket portal ${originalTicket.id} ...`)
  const updated = await stripe.billingPortal.configurations.update(
    originalTicket.id,
    {
      business_profile: {
        headline: "Ticket — Manage your subscription",
        privacy_policy_url: `${TICKET_MARKETING}/privacy`,
        terms_of_service_url: `${TICKET_MARKETING}/terms`,
      },
    },
  )
  console.log(`  privacy_policy_url   = ${updated.business_profile?.privacy_policy_url}`)
  console.log(`  terms_of_service_url = ${updated.business_profile?.terms_of_service_url}`)
  console.log()
}

if (neat) {
  console.log(`Updating Neat portal ${neat.id} ...`)
  const updated = await stripe.billingPortal.configurations.update(neat.id, {
    business_profile: {
      headline: "Neat — Manage your subscription",
      privacy_policy_url: `${NEAT_MARKETING}/privacy`,
      terms_of_service_url: `${NEAT_MARKETING}/terms`,
    },
  })
  console.log(`  privacy_policy_url   = ${updated.business_profile?.privacy_policy_url}`)
  console.log(`  terms_of_service_url = ${updated.business_profile?.terms_of_service_url}`)
  console.log()
}

// Stripe doesn't allow deleting Customer Portal configurations via API; only
// archiving via `active: false`. Mark orphans inactive so they don't surface
// in dashboard noise and can never be re-activated by the setup script.
for (const orphan of orphans) {
  console.log(`Archiving orphan Ticket portal ${orphan.id} ...`)
  const archived = await stripe.billingPortal.configurations.update(orphan.id, {
    active: false,
  })
  console.log(`  active = ${archived.active}`)
}

console.log("\nDone.\n")
