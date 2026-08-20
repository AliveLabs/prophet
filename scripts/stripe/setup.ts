/**
 * Stripe production rollout — idempotent bootstrap script.
 *
 * Creates:
 *   - 6 Products      (Ticket × {Starter,Standard,Multi-Location}, Neat × same)
 *   - 12 Prices       (6 products × {monthly, annual})
 *   - 4 ADD-ON Prices (location + competitor, per brand-neutral product, × {monthly, annual})
 *   - 2 Portal configs (one per brand; brand-specific business_profile + products)
 *   - 1 Webhook endpoint (pointing at $APP_URL/api/stripe/webhook)
 *
 * Idempotency strategy:
 *   Every resource carries a `metadata.vatic_key` we can look up on re-runs.
 *   If found, we UPDATE; if not, we CREATE. Safe to run repeatedly.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_... \
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
  // ALT-657 — plain names. Table / Shift / House and Well / Call / Top Shelf were jargon that
  // told a buyer nothing, and they appear on the invoice and the card statement.
  { brand: "ticket", tier: "entry", name: "Ticket Starter", description: "One location, a weekly brief, and 3 competitors watched." },
  { brand: "ticket", tier: "mid", name: "Ticket Standard", description: "One location, a daily brief, and 5 competitors watched. Includes a 14-day free trial." },
  { brand: "ticket", tier: "top", name: "Ticket Multi-Location", description: "Multi-location coverage, priced per location by contract." },
  { brand: "neat", tier: "entry", name: "Neat Starter", description: "One location, a weekly brief, and 3 competitors watched." },
  { brand: "neat", tier: "mid", name: "Neat Standard", description: "One location, a daily brief, and 5 competitors watched. Includes a 14-day free trial." },
  { brand: "neat", tier: "top", name: "Neat Multi-Location", description: "Multi-location coverage, priced per location by contract." },
]

// USD, cents. Per docs/PRICING-2026-08-19.md, which is authoritative. The April 2026 brief this
// script was originally written from is superseded.
//
// ANNUAL = MONTHLY × 10, i.e. "two months free" (16.7%), not the old 20% off. That construction is
// why every effective monthly figure lands on a round number: $119 × 10 / 12 = $99.17, and
// $299 × 10 / 12 = $249.17. Keep the monthly price as the primary and derive annual, or the round
// numbers on the pricing page stop being round.
const MONTHS_PER_ANNUAL = 10

function annualFrom(monthlyCents: number): number {
  return monthlyCents * MONTHS_PER_ANNUAL
}

// `top` (Multi-Location) is CONTRACT-ONLY: no self-serve checkout, no published price. Its number
// here is the per-location list rate at 0% discount, which is the starting point for a quote, and
// it exists so the portal can still carry an existing contract. Do NOT surface it on the pricing
// page. See §5 of the pricing doc for the discount schedule and the $165/location floor.
const PRICE_USD_CENTS: Record<Tier, { monthly: number; annual: number }> = {
  entry: { monthly: 11900, annual: annualFrom(11900) }, // Starter:  $119/mo, $99/mo annual
  mid:   { monthly: 29900, annual: annualFrom(29900) }, // Standard: $299/mo, $249/mo annual
  top:   { monthly: 27500, annual: annualFrom(27500) }, // Multi-Location, per location, contract
}

// ── ALT-687: the metered add-ons ─────────────────────────────────────────────
// Locations and competitors are PURCHASED QUANTITIES, so each is one subscription item whose
// `quantity` is the number bought. Brand-neutral products: an add-on location is the same thing
// whichever brand the base plan is, and splitting them would double the number of price IDs for
// no benefit.
//
// ⚠️ INVARIANT: an add-on may never cost more than the base plan it attaches to. $229 < $249 is
// what stops a customer opening a second account instead of adding a location. An earlier draft
// priced the add-on at $269 against a $99 base and a two-location customer saved $370 by
// splitting. Any edit here must preserve that.
type AddOnKind = "location" | "competitor"

interface AddOnSpec {
  kind: AddOnKind
  /** Present for `location`: the plan the add-on attaches to. Absent for the flat competitor. */
  tier?: "entry" | "mid"
  name: string
  description: string
  monthly: number
}

// The location add-on is PER PLAN. "Additional locations run on the same plan as the first" has to
// mean the same price: a flat $275 against Starter's $119 base would let a customer save money by
// running two Starter accounts instead of one two-location account. That is the same arbitrage the
// $269 draft had, and it survived into the decided sheet because only the Standard line was checked.
// Multi-Location is contract-only, so it gets no self-serve add-on price.
const ADD_ON_SPECS: AddOnSpec[] = [
  {
    kind: "location",
    tier: "entry",
    name: "Additional location (Starter)",
    description: "One more location on the Starter plan. Billed per location.",
    monthly: 11900, // parity with the Starter base: $119/mo, $99/mo annual
  },
  {
    kind: "location",
    tier: "mid",
    name: "Additional location (Standard)",
    description: "One more location on the Standard plan. Billed per location.",
    monthly: 27500, // $275/mo, $229/mo annual — an 8% discount on the $299 base
  },
  {
    kind: "competitor",
    name: "Additional competitor",
    description: "Watch one more competitor at every location. Billed per competitor.",
    monthly: 1800, // $18/mo, $15/mo annual — confirmed by Bryan 2026-08-20
  },
]

function productKey(brand: Brand, tier: Tier) {
  return `vatic.product.${brand}.${tier}`
}
function priceKey(brand: Brand, tier: Tier, cadence: Cadence) {
  return `vatic.price.${brand}.${tier}.${cadence}`
}
function addOnProductKey(spec: AddOnSpec) {
  return spec.tier ? `vatic.product.addon.${spec.kind}.${spec.tier}` : `vatic.product.addon.${spec.kind}`
}
function addOnPriceKey(spec: AddOnSpec, cadence: Cadence) {
  const t = spec.tier ? `.${spec.tier}` : ""
  return `vatic.price.addon.${spec.kind}${t}.${cadence}`
}
// The app resolves these via resolveAddOnPriceInfo in lib/stripe/pricing.ts, which scans the same
// env-var names per brand. The PRODUCT is brand-neutral but the env var is per brand, so both
// brands point at the same price ID. That is intentional: one price, two lookups.
function addOnEnvVarName(brand: Brand, spec: AddOnSpec, cadence: Cadence) {
  const tierPart = spec.tier ? `_${spec.tier.toUpperCase()}` : ""
  return `STRIPE_PRICE_ID_${brand.toUpperCase()}_ADDON_${spec.kind.toUpperCase()}${tierPart}_${cadence.toUpperCase()}`
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

async function upsertAddOnProduct(stripe: Stripe, spec: AddOnSpec): Promise<Stripe.Product> {
  const key = addOnProductKey(spec)
  const existing = await findByMetadata(
    () => stripe.products.list({ limit: 100, active: true }),
    key,
  )
  const params = {
    name: spec.name,
    description: spec.description,
    metadata: { vatic_key: key, addon: spec.kind, ...(spec.tier ? { tier: spec.tier } : {}) },
  }
  if (existing) {
    console.log(`  ✓ add-on product exists: ${spec.name} (${existing.id})`)
    return stripe.products.update(existing.id, params)
  }
  const created = await stripe.products.create(params)
  console.log(`  + add-on product created: ${spec.name} (${created.id})`)
  return created
}

async function upsertAddOnPrice(
  stripe: Stripe,
  product: Stripe.Product,
  spec: AddOnSpec,
  cadence: Cadence,
): Promise<Stripe.Price> {
  const key = addOnPriceKey(spec, cadence)
  const amount = cadence === "monthly" ? spec.monthly : annualFrom(spec.monthly)
  const existing = await findByMetadata(
    () => stripe.prices.list({ limit: 100, product: product.id, active: true }),
    key,
  )
  if (existing) {
    const matches =
      existing.unit_amount === amount &&
      existing.recurring?.interval === (cadence === "monthly" ? "month" : "year")
    if (matches) {
      console.log(`  ✓ add-on price exists: ${spec.name} ${cadence} $${(amount / 100).toFixed(2)} (${existing.id})`)
      return existing
    }
    console.log(`  ~ add-on price changed, archiving old: ${existing.id}`)
    await stripe.prices.update(existing.id, { active: false })
  }
  const created = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: amount,
    recurring: { interval: cadence === "monthly" ? "month" : "year" },
    metadata: { vatic_key: key, addon: spec.kind, cadence, ...(spec.tier ? { tier: spec.tier } : {}) },
    nickname: `${spec.name} (${cadence})`,
  })
  console.log(`  + add-on price created: ${spec.name} ${cadence} $${(amount / 100).toFixed(2)} (${created.id})`)
  return created
}

// The add-on must never cost more than the cheapest base plan it can attach to, or a customer is
// better off opening a second account. Checked BEFORE anything is written to Stripe: a bad price
// should fail the run, not land half-applied.
function assertAddOnsBelowBase(): void {
  const cheapestBaseMonthly = Math.min(PRICE_USD_CENTS.entry.monthly, PRICE_USD_CENTS.mid.monthly)
  for (const spec of ADD_ON_SPECS) {
    // A per-plan add-on is checked against ITS OWN base. A flat add-on has to clear the cheapest
    // base, since it can attach to any of them.
    const ceiling = spec.tier ? PRICE_USD_CENTS[spec.tier].monthly : cheapestBaseMonthly
    if (spec.monthly > ceiling) {
      throw new Error(
        `ADD-ON PRICE INVARIANT BROKEN: "${spec.name}" at $${(spec.monthly / 100).toFixed(2)}/mo ` +
          `exceeds the $${(ceiling / 100).toFixed(2)}/mo base it attaches to. A customer would save ` +
          `money by opening a second account instead of adding one. See docs/PRICING-2026-08-19.md.`,
      )
    }
  }
}

async function upsertPortalConfig(
  stripe: Stripe,
  brand: Brand,
  priceIds: string[],
): Promise<Stripe.BillingPortal.Configuration> {
  const key = portalConfigKey(brand)
  // NOTE: do NOT pass `is_default: false` here. Stripe creates one default
  // portal config per account, and if our brand-A config happens to be the
  // default, filtering it out makes the lookup miss it and we'd create an
  // orphan duplicate on every re-run. The metadata lookup is unique enough.
  const existing = await findByMetadata(
    () => stripe.billingPortal.configurations.list({ limit: 100 }),
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

  assertAddOnsBelowBase()

  // --prices-only limits the run to products and prices, skipping the portal config and the
  // webhook endpoint. That exists so the whole job can be done with a RESTRICTED key holding just
  // two write scopes (Products, Prices) instead of a full secret key. The portal config and the
  // webhook already exist in the live account, so on a price change there is nothing for them to
  // do beyond re-listing the new price IDs, which is a separate, later step.
  const pricesOnly = process.argv.includes("--prices-only")
  if (pricesOnly) {
    console.log("Mode: --prices-only (skipping portal config and webhook)\n")
  }

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

  console.log("\nStep 3: Add-on products and prices (ALT-687)")
  for (const spec of ADD_ON_SPECS) {
    const product = await upsertAddOnProduct(stripe, spec)
    for (const cadence of ["monthly", "annual"] as const) {
      const price = await upsertAddOnPrice(stripe, product, spec, cadence)
      // Same price ID under both brands: the product is brand-neutral, the lookup is per brand.
      for (const brand of ["ticket", "neat"] as const) {
        envLines.push(`${addOnEnvVarName(brand, spec, cadence)}=${price.id}`)
      }
      ticketPriceIds.push(price.id)
    }
  }

  let ticketPortal: { id: string } | null = null
  let neatPortal: { id: string } | null = null
  if (pricesOnly) {
    console.log("\nSteps 4-5: SKIPPED (--prices-only)")
  } else {
    console.log("\nStep 4: Portal configurations")
    ticketPortal = await upsertPortalConfig(stripe, "ticket", ticketPriceIds)
    neatPortal = await upsertPortalConfig(stripe, "neat", neatPriceIds)

    console.log("\nStep 5: Webhook endpoint")
    await upsertWebhook(stripe, appUrl)
  }

  console.log("\n\n== .env snippet ==\n")
  console.log("# Stripe prices (Ticket)")
  envLines.filter((l) => l.includes("_TICKET_")).forEach((l) => console.log(l))
  console.log("\n# Stripe prices (Neat)")
  envLines.filter((l) => l.includes("_NEAT_")).forEach((l) => console.log(l))
  if (ticketPortal && neatPortal) {
    console.log("\n# Stripe Customer Portal configurations")
    console.log(`STRIPE_PORTAL_CONFIG_TICKET=${ticketPortal.id}`)
    console.log(`STRIPE_PORTAL_CONFIG_NEAT=${neatPortal.id}`)
    console.log("\n# Copy STRIPE_WEBHOOK_SECRET from above if the webhook was newly created.")
    console.log("# (Stripe only returns signing secrets at creation time.)")
  } else {
    console.log("\n# Portal config and webhook untouched (--prices-only).")
    console.log("# The new price IDs still need adding to the portal's allowed products later.")
  }
  console.log("\n== Done ==\n")
}

main().catch((err) => {
  console.error("\nFATAL:", err)
  process.exit(1)
})
