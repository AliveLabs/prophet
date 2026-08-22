/**
 * ALT-756 follow-up: push the corrected competitor add-on DESCRIPTION to live Stripe.
 *
 * Deliberately NOT `scripts/stripe/setup.ts`. That script is idempotent but broad: it also writes
 * the billing-portal configuration, and it has previously tried to push add-on prices into the
 * portal's `subscription_update.products` allow-list, which would let an add-on replace the base
 * plan. For a one-field copy fix, the safe move is the narrowest possible write.
 *
 * What this touches:  the `description` field of the competitor add-on PRODUCT.
 * What it never touches: prices, price IDs, product ids, the portal config, webhooks, anything else.
 *
 * A price ID must never move: every existing subscription item points at it.
 *
 * Usage:
 *   npx tsx scripts/stripe/update-addon-description.ts            # dry run, prints the diff
 *   npx tsx scripts/stripe/update-addon-description.ts --apply    # performs the write
 */

import Stripe from "stripe"

const WANT_DESCRIPTION = "Watch one more competitor at a location you choose. Billed per competitor."

/** Matches the add-on product by name, which setup.ts sets and does not vary by brand. */
const PRODUCT_NAME = "Additional competitor"

function requireKey(): string {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key || key.startsWith("PASTE")) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Load .env.local (e.g. `set -a; . .env.local; set +a`) first.",
    )
  }
  return key
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply")
  const stripe = new Stripe(requireKey())

  // Search by name rather than a hardcoded id, so this works against any account the key points at.
  const products = await stripe.products.list({ active: true, limit: 100 })
  const matches = products.data.filter((p) => p.name === PRODUCT_NAME)

  if (matches.length === 0) {
    throw new Error(
      `No active product named "${PRODUCT_NAME}". Nothing updated. If the key is restricted it may ` +
        `not be able to LIST products, which reads as "not found" rather than as a permission error.`,
    )
  }
  if (matches.length > 1) {
    throw new Error(
      `${matches.length} active products named "${PRODUCT_NAME}" (${matches
        .map((p) => p.id)
        .join(", ")}). Refusing to guess which one is live.`,
    )
  }

  const product = matches[0]!
  console.log(`product:  ${product.id}`)
  console.log(`current:  ${JSON.stringify(product.description)}`)
  console.log(`wanted:   ${JSON.stringify(WANT_DESCRIPTION)}`)

  if (product.description === WANT_DESCRIPTION) {
    console.log("\nAlready correct. No write needed.")
    return
  }

  if (!apply) {
    console.log("\nDRY RUN. Re-run with --apply to write this one field.")
    return
  }

  const updated = await stripe.products.update(product.id, { description: WANT_DESCRIPTION })
  console.log(`\nwrote:    ${JSON.stringify(updated.description)}`)

  // Read back rather than trusting the response, and fail loudly if it did not stick. A restricted
  // key can silently lack write scope on a field.
  const verify = await stripe.products.retrieve(product.id)
  if (verify.description !== WANT_DESCRIPTION) {
    throw new Error(
      `Verification FAILED: Stripe still reports ${JSON.stringify(verify.description)}. ` +
        `The key may lack product write scope.`,
    )
  }
  console.log("verified: description matches on read-back.")
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
