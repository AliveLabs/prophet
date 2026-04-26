/**
 * Quick smoke test: verifies that every (industry, tier, cadence) resolves to a
 * live Stripe Price that belongs to the expected brand, and that both portal
 * configurations are reachable. Non-destructive — pure reads.
 *
 * Usage:
 *   npx tsx scripts/stripe/verify.ts
 */

import { config } from "dotenv"
import Stripe from "stripe"

config({ path: ".env.local" })
config({ path: ".env" })

async function main() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set")
  const stripe = new Stripe(key, { typescript: true })

  const industries = ["ticket", "neat"] as const
  const tiers = ["entry", "mid", "top"] as const
  const cadences = ["monthly", "annual"] as const

  let pass = 0
  let fail = 0

  console.log("\n== Price resolution ==\n")
  for (const brand of industries) {
    for (const tier of tiers) {
      for (const cadence of cadences) {
        const envKey = `STRIPE_PRICE_ID_${brand.toUpperCase()}_${tier.toUpperCase()}_${cadence.toUpperCase()}`
        const priceId = process.env[envKey]
        if (!priceId) {
          console.log(`  ✗ ${envKey} not set in env`)
          fail++
          continue
        }
        try {
          const price = await stripe.prices.retrieve(priceId, { expand: ["product"] })
          const product = typeof price.product === "object" && "metadata" in price.product ? price.product : null
          const brandMeta = product?.metadata?.brand
          const tierMeta = product?.metadata?.tier
          if (!price.active) {
            console.log(`  ✗ ${envKey}: price inactive`)
            fail++
            continue
          }
          if (brandMeta !== brand || tierMeta !== tier) {
            console.log(`  ✗ ${envKey}: brand/tier mismatch (got brand=${brandMeta}, tier=${tierMeta})`)
            fail++
            continue
          }
          const expectedInterval = cadence === "monthly" ? "month" : "year"
          if (price.recurring?.interval !== expectedInterval) {
            console.log(`  ✗ ${envKey}: interval mismatch (got ${price.recurring?.interval})`)
            fail++
            continue
          }
          console.log(`  ✓ ${envKey} → ${priceId} ($${(price.unit_amount ?? 0) / 100}/${expectedInterval})`)
          pass++
        } catch (err) {
          console.log(`  ✗ ${envKey}: ${(err as Error).message}`)
          fail++
        }
      }
    }
  }

  console.log("\n== Portal configurations ==\n")
  for (const brand of industries) {
    const envKey = `STRIPE_PORTAL_CONFIG_${brand.toUpperCase()}`
    const configId = process.env[envKey]
    if (!configId) {
      console.log(`  ✗ ${envKey} not set`)
      fail++
      continue
    }
    try {
      const cfg = await stripe.billingPortal.configurations.retrieve(configId, {
        expand: ["features.subscription_update.products"],
      })
      if (!cfg.active) {
        console.log(`  ✗ ${envKey}: inactive`)
        fail++
        continue
      }
      const allowedProducts = cfg.features.subscription_update?.products ?? []
      const priceCount = allowedProducts.flatMap((p) => p.prices).length
      if (allowedProducts.length === 0) {
        console.log(`  ✗ ${envKey} → ${configId} has no product groups (in-portal upgrades disabled)`)
        fail++
        continue
      }
      console.log(
        `  ✓ ${envKey} → ${configId} (${allowedProducts.length} products, ${priceCount} prices)`,
      )
      pass++
    } catch (err) {
      console.log(`  ✗ ${envKey}: ${(err as Error).message}`)
      fail++
    }
  }

  console.log("\n== Webhook endpoint ==\n")
  try {
    const endpoints = await stripe.webhookEndpoints.list({ limit: 10 })
    const ours = endpoints.data.find((e) => e.metadata?.vatic_key === "vatic.webhook.primary")
    if (!ours) {
      console.log("  ✗ no vatic webhook endpoint found")
      fail++
    } else {
      console.log(`  ✓ ${ours.id} → ${ours.url} (${ours.enabled_events.length} events, status=${ours.status})`)
      pass++
    }
  } catch (err) {
    console.log(`  ✗ webhook list failed: ${(err as Error).message}`)
    fail++
  }

  console.log(`\n== ${pass} pass / ${fail} fail ==\n`)
  if (fail > 0) process.exit(1)
}

main().catch((err) => {
  console.error("FATAL:", err)
  process.exit(1)
})
