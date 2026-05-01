import { config } from "dotenv"
import Stripe from "stripe"

config({ path: ".env.local" })
config({ path: ".env" })

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { typescript: true })
const mode = process.env.STRIPE_SECRET_KEY?.includes("_live_") ? "LIVE" : "TEST"

console.log(`\n== Stripe config audit (${mode} mode) ==\n`)

console.log("--- Webhook Endpoints ---")
const webhooks = await stripe.webhookEndpoints.list({ limit: 20 })
for (const w of webhooks.data) {
  console.log(`  id:       ${w.id}`)
  console.log(`  url:      ${w.url}`)
  console.log(`  status:   ${w.status}`)
  console.log(
    `  events:   ${w.enabled_events.length} (${w.enabled_events.slice(0, 3).join(", ")}${w.enabled_events.length > 3 ? ", ..." : ""})`,
  )
  console.log(`  metadata: ${JSON.stringify(w.metadata)}`)
  console.log("")
}

console.log("--- Customer Portal Configurations ---")
const portals = await stripe.billingPortal.configurations.list({ limit: 20 })
for (const p of portals.data) {
  console.log(`  id:         ${p.id}`)
  console.log(`  is_default: ${p.is_default}`)
  console.log(`  active:     ${p.active}`)
  console.log(`  brand:      ${p.metadata?.brand ?? "(no brand metadata)"}`)
  console.log(
    `  privacy:    ${p.business_profile?.privacy_policy_url ?? "(none)"}`,
  )
  console.log(
    `  terms:      ${p.business_profile?.terms_of_service_url ?? "(none)"}`,
  )
  console.log(`  headline:   ${p.business_profile?.headline ?? "(none)"}`)
  console.log("")
}

console.log("--- Account Business Profile ---")
const acct = await stripe.accounts.retrieve()
console.log(`  business_url:    ${acct.business_profile?.url ?? "(none)"}`)
console.log(`  business_name:   ${acct.business_profile?.name ?? "(none)"}`)
console.log(`  support_email:   ${acct.business_profile?.support_email ?? "(none)"}`)
console.log(`  support_url:     ${acct.business_profile?.support_url ?? "(none)"}`)
console.log(`  product_desc:    ${acct.business_profile?.product_description ?? "(none)"}`)
console.log("")
