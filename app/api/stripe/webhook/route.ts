import Stripe from "stripe"
import { headers } from "next/headers"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { getStripeClient } from "@/lib/stripe/client"
import {
  isWebhookEventNew,
  markWebhookEventProcessed,
  normalizePaymentState,
  resolveOrganizationId,
} from "@/lib/stripe/helpers"
import { resolvePriceInfo } from "@/lib/stripe/pricing"
import { type SubscriptionTier } from "@/lib/billing/tiers"
import { sendEmail, FROM_ADDRESS_TICKET, FROM_ADDRESS_NEAT } from "@/lib/email/send"
import { PaymentFailed } from "@/lib/email/templates/payment-failed"
import { isValidIndustryType, type IndustryType } from "@/lib/verticals"
import {
  getOrganizationBillingEmail,
  isMarketingContactsEnabled,
  upsertMarketingContact,
  type MarketingIndustryType,
  type MarketingStatus,
} from "@/lib/marketing/contacts"

// Stripe webhook dispatcher. Every event is:
//   1. Verified against STRIPE_WEBHOOK_SECRET
//   2. De-duped via public.stripe_webhook_events (event_id PK)
//   3. Dispatched to a per-type handler
//   4. Marked processed (or processed-with-error) at the end
//
// Handlers update public.organizations and best-effort mirror into
// marketing.contacts. Failures in handlers throw -> we return 500 so Stripe
// retries; failures in the marketing mirror are swallowed so the billing
// update still ack's 200.

export async function POST(req: Request) {
  const stripe = getStripeClient()
  const headerList = await headers()
  const signature = headerList.get("stripe-signature")
  if (!signature) {
    return new Response("Missing Stripe signature", { status: 400 })
  }

  const body = await req.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET ?? ""
    )
  } catch (error) {
    console.error("Stripe webhook signature verification failed:", error)
    return new Response(`Webhook error: ${String(error)}`, { status: 400 })
  }

  const admin = createAdminSupabaseClient()

  const isNew = await isWebhookEventNew(admin, event.id, event.type)
  if (!isNew) {
    // Duplicate delivery: Stripe retried an event we already handled.
    return new Response("ok (duplicate)", { status: 200 })
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(admin, event.data.object as Stripe.Checkout.Session)
        break

      case "customer.updated":
        await handleCustomerUpdated(admin, event.data.object as Stripe.Customer)
        break

      case "customer.deleted":
        await handleCustomerDeleted(admin, event.data.object as Stripe.Customer)
        break

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.trial_will_end":
        await handleSubscriptionEvent(
          admin,
          event.data.object as Stripe.Subscription,
          event.type
        )
        break

      case "invoice.payment_succeeded":
        // No-op. The matching subscription.updated carries the authoritative
        // current_period_end + payment_state; we rely on that.
        break

      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(admin, event.data.object as Stripe.Invoice)
        break

      default:
        // Unknown type -- still mark processed so idempotency ledger is clean.
        break
    }

    await markWebhookEventProcessed(admin, event.id)
    return new Response("ok", { status: 200 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Webhook handler for ${event.type} failed:`, err)
    await markWebhookEventProcessed(admin, event.id, msg)
    // 500 -> Stripe will retry.
    return new Response("handler error", { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleCheckoutSessionCompleted(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  session: Stripe.Checkout.Session
): Promise<void> {
  const customerId = typeof session.customer === "string" ? session.customer : null
  const clientReferenceId = session.client_reference_id ?? null

  const orgId = await resolveOrganizationId(admin, {
    clientReferenceId,
    stripeCustomerId: customerId,
  })
  if (!orgId) {
    console.warn("checkout.session.completed: could not resolve org", session.id)
    return
  }

  // Make sure the customer_id is linked; the rest (tier, price, trial end)
  // will flow in via the subscription.created event that follows.
  if (customerId) {
    await admin
      .from("organizations")
      .update({ stripe_customer_id: customerId })
      .eq("id", orgId)
  }
}

async function handleCustomerUpdated(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  customer: Stripe.Customer
): Promise<void> {
  // If the user changed their email in the Portal, mirror it into billing_email.
  const email = customer.email
  if (!email) return
  await admin
    .from("organizations")
    .update({ billing_email: email })
    .eq("stripe_customer_id", customer.id)
}

async function handleCustomerDeleted(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  customer: Stripe.Customer
): Promise<void> {
  // Hard delete of Stripe customer: clear our FK so future checkouts mint a
  // fresh one. Subscription fields get cleared by subscription.deleted, which
  // always precedes this.
  await admin
    .from("organizations")
    .update({
      stripe_customer_id: null,
      stripe_subscription_id: null,
      stripe_price_id: null,
      subscription_tier: "free",
      payment_state: "canceled",
      cancel_at_period_end: false,
    })
    .eq("stripe_customer_id", customer.id)
}

async function handleSubscriptionEvent(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  subscription: Stripe.Subscription,
  eventType:
    | "customer.subscription.created"
    | "customer.subscription.updated"
    | "customer.subscription.deleted"
    | "customer.subscription.trial_will_end"
): Promise<void> {
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : (subscription.customer?.id ?? null)

  const orgId = await resolveOrganizationId(admin, {
    clientReferenceId: subscription.metadata?.organization_id ?? null,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
  })
  if (!orgId) {
    console.warn(`${eventType}: could not resolve org`, subscription.id)
    return
  }

  const priceId = subscription.items.data[0]?.price?.id ?? null
  const priceInfo = resolvePriceInfo(priceId)

  // Tier: derived from the subscription's current price. If the event is
  // 'deleted' we hard-downgrade to 'free' regardless of what Stripe reports.
  let tier: SubscriptionTier
  if (eventType === "customer.subscription.deleted") {
    tier = "free"
  } else if (priceInfo) {
    tier = priceInfo.tier
  } else {
    // Price ID unknown to us (env vars out of sync? deleted price?). Leave
    // the tier field alone rather than stomping to 'free' and accidentally
    // locking out a paying customer.
    tier = (await readOrgTier(admin, orgId)) ?? "free"
  }

  const paymentState =
    eventType === "customer.subscription.deleted"
      ? "canceled"
      : normalizePaymentState(subscription.status)

  const trialEndIso =
    typeof subscription.trial_end === "number"
      ? new Date(subscription.trial_end * 1000).toISOString()
      : null

  // Subscription shape returns current_period_end at the root on REST; the
  // generated types sometimes expose it on items. Try root first.
  const periodEnd = readPeriodEnd(subscription)

  const updates: Record<string, unknown> = {
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    stripe_price_id: priceId,
    subscription_tier: tier,
    cancel_at_period_end: subscription.cancel_at_period_end ?? false,
    trial_ends_at: trialEndIso,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
  }
  if (paymentState !== null) updates.payment_state = paymentState

  await admin.from("organizations").update(updates).eq("id", orgId)

  // trial_will_end fires 3 days before trial_end. Our Day 10 / Day 13
  // reminders are driven by the cron instead (so we control the send window
  // and can dedupe per day), so this handler only needs to keep the DB in
  // sync -- already done by the update above.
  if (eventType === "customer.subscription.trial_will_end") {
    return
  }

  await mirrorSubscriptionToMarketing({
    organizationId: orgId,
    customerId,
    tier,
    subscription,
    eventType,
  })
}

async function handleInvoicePaymentFailed(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  invoice: Stripe.Invoice
): Promise<void> {
  const customerId = typeof invoice.customer === "string" ? invoice.customer : null
  if (!customerId) return

  const { data: org } = await admin
    .from("organizations")
    .select("id, industry_type, billing_email")
    .eq("stripe_customer_id", customerId)
    .maybeSingle()
  if (!org) return

  const industryType: IndustryType = isValidIndustryType(org.industry_type)
    ? org.industry_type
    : "restaurant"
  const brand: "Ticket" | "Neat" = industryType === "liquor_store" ? "Neat" : "Ticket"
  // Use the shared FROM_ADDRESS_* constants from lib/email/send.ts so we have a
  // single source of truth for sender addresses (and so a domain rebrand only
  // touches one file). Previously these were duplicated string literals.
  const fromAddress =
    industryType === "liquor_store" ? FROM_ADDRESS_NEAT : FROM_ADDRESS_TICKET

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  const amountDue = (invoice.amount_due ?? 0) / 100
  const hostedInvoiceUrl = invoice.hosted_invoice_url ?? null

  const to = org.billing_email ?? invoice.customer_email ?? null
  if (!to) return

  await sendEmail({
    from: fromAddress,
    to,
    subject: `Action needed: ${brand} payment failed`,
    react: PaymentFailed({
      brand,
      amount: amountDue,
      currency: invoice.currency?.toUpperCase() ?? "USD",
      portalUrl: `${appUrl}/settings/billing`,
      invoiceUrl: hostedInvoiceUrl,
    }),
    clientFacing: true,
    overrideClientEmailPause: true,
  }).catch((err) => {
    console.error("payment_failed email send error:", err)
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readOrgTier(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  orgId: string
): Promise<SubscriptionTier | null> {
  const { data } = await admin
    .from("organizations")
    .select("subscription_tier")
    .eq("id", orgId)
    .maybeSingle()
  return (data?.subscription_tier as SubscriptionTier | undefined) ?? null
}

// The Stripe types library has drifted on where current_period_end lives:
// top-level on old API versions, item-level on newer ones. Read both.
function readPeriodEnd(subscription: Stripe.Subscription): number | null {
  const topLevel = (subscription as unknown as { current_period_end?: number })
    .current_period_end
  if (typeof topLevel === "number") return topLevel
  const item = subscription.items.data[0] as unknown as {
    current_period_end?: number
  }
  return typeof item?.current_period_end === "number" ? item.current_period_end : null
}

// Stripe is the source of truth for lifecycle transitions (paid -> churned /
// trial). This mirror writes the same state into marketing.contacts so
// Chris's n8n workflows see it without cross-DB sync. Errors here are
// swallowed -- the billing update above has already landed and Stripe must
// get a 200 on the webhook regardless of marketing mirror success.
async function mirrorSubscriptionToMarketing(args: {
  organizationId: string
  customerId: string | null
  tier: SubscriptionTier
  subscription: Stripe.Subscription
  eventType: string
}): Promise<void> {
  if (!isMarketingContactsEnabled()) return

  try {
    const admin = createAdminSupabaseClient()

    const { data: org, error: orgError } = await admin
      .from("organizations")
      .select("industry_type")
      .eq("id", args.organizationId)
      .maybeSingle()
    if (orgError || !org) {
      console.error("marketing mirror: org lookup failed", orgError)
      return
    }

    const billingEmail = await getOrganizationBillingEmail(args.organizationId)
    if (!billingEmail) {
      console.warn(
        `marketing mirror: no billing_email for org ${args.organizationId}, skipping`
      )
      return
    }

    // Marketing status transitions:
    //   deleted event                -> 'churned'
    //   trialing subscription        -> 'trial'
    //   active subscription on paid tier -> 'paid'
    //   anything else                -> leave untouched (let n8n decide)
    let status: MarketingStatus | undefined
    if (args.eventType === "customer.subscription.deleted") {
      status = "churned"
    } else if (args.subscription.status === "trialing") {
      status = "trial"
    } else if (args.tier !== "free" && args.subscription.status === "active") {
      status = "paid"
    }

    const industryType: MarketingIndustryType =
      org.industry_type === "liquor_store" ? "liquor_store" : "restaurant"

    await upsertMarketingContact({
      email: billingEmail,
      industryType,
      status,
      stripeCustomerId: args.customerId,
    })
  } catch (error) {
    console.error("marketing mirror threw:", error)
  }
}
