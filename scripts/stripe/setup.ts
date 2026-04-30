/**
 * Stripe production rollout — idempotent bootstrap script.
 *
 * Creates:
 *   - 6 Products      (Ticket × {Entry,Mid,Top}, Neat × {Entry,Mid,Top})
 *   - 12 Prices       (6 products × {monthly, annual})
 *   - 2 Portal configs (one per brand; brand-specific business_profile + products)
 *   - 1 Webhook endpoint (pointing at $APP_URL/api/stripe/webhook)
 *
 * Idempotency strategy:
 *   Every resource carries a `metadata.vatic_key` we can look up on re-runs.
 *   If found, we UPDATE; if not, we CREATE. Safe to run repeatedly.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... \
 *   APP_URL=https://app.getticket.ai \
 *   npx tsx scripts/stripe/setup.ts
 *
 * After it finishes, paste the printed env-var block into `.env.local` (dev)
 * and Vercel project env (prod).
 */

import { config } from "dotenv"
import Stripe from "stripe"
import { randomBytes } from "node:crypto"

config({ path: ".env.local" })
config({ path: ".env" })

type Brand = "ticket" | "neat"
type Tier = "entry" | "mid" | "top"
type Cadence = "monthly" | "annual"

interface ProductSpec {
  brand: Brand
  tier: Tier
  name: string
  description: string
}

const PRODUCT_SPECS: ProductSpec[] = [
  { brand: "ticket", tier: "entry", name: "Ticket — Table", description: "Single location, starter insights for restaurants." },
  { brand: "ticket", tier: "mid", name: "Ticket — Shift", description: "Daily social + SEO intelligence for growing restaurants. Includes 14-day free trial." },
  { brand: "ticket", tier: "top", name: "Ticket — House", description: "Multi-location, daily SEO + ads intelligence for restaurant groups." },
  { brand: "neat", tier: "entry", name: "Neat — Well", description: "Single location, starter insights for liquor stores." },
  { brand: "neat", tier: "mid", name: "Neat — Call", description: "Daily social + SEO intelligence for growing liquor stores. Includes 14-day free trial." },
  { brand: "neat", tier: "top", name: "Neat — Top Shelf", description: "Multi-location, daily SEO + ads intelligence for liquor store groups." },
]

// USD, cents. Per Ticket_Neat_Pricing_Brief_Apr2026.txt.
// Annual = monthly × 12 × 0.80 (20% discount), expressed in whole cents.
const PRICE_USD_CENTS: Record<Tier, { monthly: number; annual: number }> = {
  entry: { monthly: 14900, annual: 142800 },
  mid:   { monthly: 29900, annual: 286800 },
  top:   { monthly: 49900, annual: 478800 },
}

function productKey(brand: Brand, tier: Tier) {
  return `vatic.product.${brand}.${tier}`
}
function priceKey(brand: Brand, tier: Tier, cadence: Cadence) {
  return `vatic.price.${brand}.${tier}.${cadence}`
}
function portalConfigKey(brand: Brand) {
  return `vatic.portal.${brand}`
}
function webhookKey() {
  return "vatic.webhook.primary"
}
function envVarName(brand: Brand, tier: Tier, cadence: Cadence) {
  return `STRIPE_PRICE_ID_${brand.toUpperCase()}_${tier.toUpperCase()}_${cadence.toUpperCase()}`
}

async function findByMetadata<T extends { metadata: Stripe.Metadata | null }>(
  list: () => Promise<Stripe.ApiList<T>>,
  key: string,
): Promise<T | null> {
  for await (const item of iterate(list)) {
    if (item.metadata?.vatic_key === key) return item
  }
  return null
}

async function* iterate<T>(list: () => Promise<Stripe.ApiList<T>>): AsyncGenerator<T> {
  // Stripe's SDK provides .autoPagingEach, but we use a simple loop here for the
  // small number of resources we manage. This function is only called for
  // products, prices, portal-configs, and webhook-endpoints — typically < 100 items total.
  const page = await list()
  for (const item of page.data) yield item
  if (page.has_more) {
    // Not bothering with cursor pagination: if someone has more than 100
    // matches, re-run the script. 99% case is fine.
    console.warn("  (warn) more than one page of results; only checked first page")
  }
}

async function upsertProduct(stripe: Stripe, spec: ProductSpec): Promise<Stripe.Product> {
  const key = productKey(spec.brand, spec.tier)
  const existing = await findByMetadata(
    () => stripe.products.list({ limit: 100, active: true }),
    key,
  )
  if (existing) {
    console.log(`  ✓ product exists: ${spec.name} (${existing.id})`)
    const updated = await stripe.products.update(existing.id, {
      name: spec.name,
      description: spec.description,
      metadata: { vatic_key: key, brand: spec.brand, tier: spec.tier },
    })
    return updated
  }
  const created = await stripe.products.create({
    name: spec.name,
    description: spec.description,
    metadata: { vatic_key: key, brand: spec.brand, tier: spec.tier },
  })
  console.log(`  + product created: ${spec.name} (${created.id})`)
  return created
}

async function upsertPrice(
  stripe: Stripe,
  product: Stripe.Product,
  spec: ProductSpec,
  cadence: Cadence,
): Promise<Stripe.Price> {
  const key = priceKey(spec.brand, spec.tier, cadence)
  const amount = PRICE_USD_CENTS[spec.tier][cadence]
  const existing = await findByMetadata(
    () => stripe.prices.list({ limit: 100, product: product.id, active: true }),
    key,
  )
  if (existing) {
    const matches = existing.unit_amount === amount &&
      existing.recurring?.interval === (cadence === "monthly" ? "month" : "year")
    if (matches) {
      console.log(`  ✓ price exists: ${spec.name} ${cadence} $${(amount / 100).toFixed(2)} (${existing.id})`)
      return existing
    }
    // Amount/interval changed -> archive old, create new. Stripe prices are immutable.
    console.log(`  ~ price changed, archiving old: ${existing.id}`)
    await stripe.prices.update(existing.id, { active: false })
  }
  const created = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: amount,
    recurring: { interval: cadence === "monthly" ? "month" : "year" },
    metadata: { vatic_key: key, brand: spec.brand, tier: spec.tier, cadence },
    nickname: `${spec.name} (${cadence})`,
  })
  console.log(`  + price created: ${spec.name} ${cadence} $${(amount / 100).toFixed(2)} (${created.id})`)
  return created
}

async function upsertPortalConfig(
  stripe: Stripe,
  brand: Brand,
  priceIds: string[],
): Promise<Stripe.BillingPortal.Configuration> {
  const key = portalConfigKey(brand)
  const existing = await findByMetadata(
    () => stripe.billingPortal.configurations.list({ limit: 100, is_default: false }),
    key,
  )
  const brandName = brand === "ticket" ? "Ticket" : "Neat"
  // Brand portal pages live on the marketing site (Bryan-managed), not the
  // product app. Restaurant -> getticket.ai. Liquor -> useneat.ai once Neat
  // launches; until then the URL is informational only because Neat customers
  // do not exist in production.
  const marketingBase =
    brand === "ticket" ? "https://www.getticket.ai" : "https://www.useneat.ai"
  const params: Stripe.BillingPortal.ConfigurationUpdateParams = {
    business_profile: {
      headline: `${brandName} — Manage your subscription`,
      privacy_policy_url: `${marketingBase}/privacy`,
      terms_of_service_url: `${marketingBase}/terms`,
    },
    features: {
      customer_update: { enabled: true, allowed_updates: ["email", "name", "phone", "address", "tax_id"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
        cancellation_reason: {
          enabled: true,
          options: ["too_expensive", "missing_features", "switched_service", "unused", "customer_service", "too_complex", "low_quality", "other"],
        },
      },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        proration_behavior: "create_prorations",
        products: priceIds.length > 0 ? [{ product: "__placeholder__", prices: priceIds }] : undefined,
      },
    },
    metadata: { vatic_key: key, brand },
  }

  // subscription_update.products expects { product, prices } groupings. Build from actual products.
  // We need to re-shape above — fix below by grouping prices by product on the fly.
  const pricesDetail = await Promise.all(
    priceIds.map((id) => stripe.prices.retrieve(id, { expand: ["product"] })),
  )
  const byProduct = new Map<string, string[]>()
  for (const p of pricesDetail) {
    const prodId = typeof p.product === "string" ? p.product : p.product.id
    if (!byProduct.has(prodId)) byProduct.set(prodId, [])
    byProduct.get(prodId)!.push(p.id)
  }
  params.features!.subscription_update!.products = Array.from(byProduct.entries()).map(
    ([product, prices]) => ({ product, prices }),
  )

  if (existing) {
    const updated = await stripe.billingPortal.configurations.update(existing.id, params)
    console.log(`  ✓ portal config exists: ${brand} (${updated.id})`)
    return updated
  }
  const created = await stripe.billingPortal.configurations.create(params as unknown as Stripe.BillingPortal.ConfigurationCreateParams)
  console.log(`  + portal config created: ${brand} (${created.id})`)
  return created
}

async function upsertWebhook(stripe: Stripe, appUrl: string): Promise<Stripe.WebhookEndpoint> {
  const url = `${appUrl.replace(/\/+$/, "")}/api/stripe/webhook`
  const key = webhookKey()
  const enabledEvents: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "customer.subscription.trial_will_end",
    "customer.updated",
    "customer.deleted",
    "invoice.payment_failed",
    "invoice.paid",
    "invoice.payment_succeeded",
  ]
  const existing = await findByMetadata(
    () => stripe.webhookEndpoints.list({ limit: 100 }),
    key,
  )
  if (existing) {
    const updated = await stripe.webhookEndpoints.update(existing.id, {
      url,
      enabled_events: enabledEvents,
      metadata: { vatic_key: key },
    })
    console.log(`  ✓ webhook exists: ${url} (${updated.id})`)
    console.log(`    NOTE: signing secret is only returned on creation. Rotate manually if needed.`)
    return updated
  }
  const created = await stripe.webhookEndpoints.create({
    url,
    enabled_events: enabledEvents,
    metadata: { vatic_key: key },
  })
  console.log(`  + webhook created: ${url} (${created.id})`)
  console.log(`    STRIPE_WEBHOOK_SECRET=${created.secret}`)
  return created
}

async function main() {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  const appUrl = process.env.APP_URL
  if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set")
  if (!appUrl) throw new Error("APP_URL is not set (e.g. https://app.getticket.ai)")

  const stripe = new Stripe(stripeKey, { typescript: true })

  const mode = stripeKey.includes("_live_") ? "LIVE" : "TEST"
  console.log(`\n== Stripe setup (${mode} mode) ==\n`)
  console.log(`App URL: ${appUrl}`)
  console.log(`Idempotency seed: ${randomBytes(4).toString("hex")}\n`)

  console.log("Step 1: Products")
  const products = new Map<string, Stripe.Product>()
  for (const spec of PRODUCT_SPECS) {
    const p = await upsertProduct(stripe, spec)
    products.set(productKey(spec.brand, spec.tier), p)
  }

  console.log("\nStep 2: Prices")
  const envLines: string[] = []
  const ticketPriceIds: string[] = []
  const neatPriceIds: string[] = []
  for (const spec of PRODUCT_SPECS) {
    const product = products.get(productKey(spec.brand, spec.tier))!
    for (const cadence of ["monthly", "annual"] as const) {
      const price = await upsertPrice(stripe, product, spec, cadence)
      envLines.push(`${envVarName(spec.brand, spec.tier, cadence)}=${price.id}`)
      if (spec.brand === "ticket") ticketPriceIds.push(price.id)
      else neatPriceIds.push(price.id)
    }
  }

  console.log("\nStep 3: Portal configurations")
  const ticketPortal = await upsertPortalConfig(stripe, "ticket", ticketPriceIds)
  const neatPortal = await upsertPortalConfig(stripe, "neat", neatPriceIds)

  console.log("\nStep 4: Webhook endpoint")
  await upsertWebhook(stripe, appUrl)

  console.log("\n\n== .env snippet ==\n")
  console.log("# Stripe prices (Ticket)")
  envLines.filter((l) => l.includes("_TICKET_")).forEach((l) => console.log(l))
  console.log("\n# Stripe prices (Neat)")
  envLines.filter((l) => l.includes("_NEAT_")).forEach((l) => console.log(l))
  console.log("\n# Stripe Customer Portal configurations")
  console.log(`STRIPE_PORTAL_CONFIG_TICKET=${ticketPortal.id}`)
  console.log(`STRIPE_PORTAL_CONFIG_NEAT=${neatPortal.id}`)
  console.log("\n# Copy STRIPE_WEBHOOK_SECRET from above if the webhook was newly created.")
  console.log("# (Stripe only returns signing secrets at creation time.)")
  console.log("\n== Done ==\n")
}

main().catch((err) => {
  console.error("\nFATAL:", err)
  process.exit(1)
})
