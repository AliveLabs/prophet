import Stripe from "stripe"
import { headers } from "next/headers"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { getTierFromPriceId } from "@/lib/billing/tiers"

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
