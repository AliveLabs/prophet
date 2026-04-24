import Stripe from "stripe"
import { headers } from "next/headers"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { getTierFromPriceId } from "@/lib/billing/tiers"
import {
  getOrganizationBillingEmail,
  isMarketingContactsEnabled,
  upsertMarketingContact,
  type MarketingIndustryType,
  type MarketingStatus,
} from "@/lib/marketing/contacts"

function getStripeClient() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not configured")
  }
  return new Stripe(key, {
    apiVersion: "2025-12-15.clover",
  })
}

async function resolveOrganizationId(
  customerId: string | null,
  metadata: Stripe.Metadata
) {
  if (metadata?.organization_id) {
    return metadata.organization_id
  }
  if (!customerId) {
    return null
  }

  const supabase = createAdminSupabaseClient()
  const { data } = await supabase
    .from("organizations")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle()

  return data?.id ?? null
}

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
    return new Response(`Webhook error: ${String(error)}`, { status: 400 })
  }

  const supabase = createAdminSupabaseClient()

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription
      const customerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer?.id ?? null

      const organizationId = await resolveOrganizationId(customerId, subscription.metadata)
      if (!organizationId) {
        break
      }

      const priceId = subscription.items.data[0]?.price?.id ?? null
      const tier =
        event.type === "customer.subscription.deleted"
          ? "free"
          : getTierFromPriceId(priceId)

      await supabase
        .from("organizations")
        .update({
          stripe_customer_id: customerId,
          stripe_subscription_id: subscription.id,
          subscription_tier: tier,
        })
        .eq("id", organizationId)

      await mirrorSubscriptionToMarketing({
        organizationId,
        customerId,
        tier,
        eventType: event.type,
      })

      break
    }
    case "invoice.payment_failed": {
      break
    }
    case "invoice.payment_succeeded": {
      break
    }
    default:
      break
  }

  return new Response("ok", { status: 200 })
}

// Phase 3 marketing automation mirror. Stripe webhooks are the ground truth
// for `stripe_customer_id` and lifecycle transitions (paid -> churned). We
// write a best-effort mirror into `marketing.contacts` so Chris's n8n
// workflows see the same state without a cross-DB sync.
//
// Swallowing errors here is deliberate: Stripe retries webhooks on non-2xx,
// and a missing/misconfigured marketing schema (early rollout) must not cause
// duplicate delivery of the core billing update.
//
// Note: we intentionally do NOT mirror a free-tier subscription back to
// 'trial'. A downgrade from paid to free is either a manual churn or an
// operator action -- let the n8n state machine decide from the raw event
// rather than stomping the marketing row.
async function mirrorSubscriptionToMarketing(args: {
  organizationId: string
  customerId: string | null
  tier: string
  eventType: string
}): Promise<void> {
  if (!isMarketingContactsEnabled()) return

  try {
    const supabase = createAdminSupabaseClient()

    const { data: org, error: orgError } = await supabase
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

    let status: MarketingStatus | undefined
    if (args.eventType === "customer.subscription.deleted") {
      status = "churned"
    } else if (args.tier !== "free") {
      status = "paid"
    }
    // tier === 'free' on a non-deleted event: leave status untouched.

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
