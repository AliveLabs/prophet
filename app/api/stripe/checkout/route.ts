import { NextResponse } from "next/server"
import Stripe from "stripe"
import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

function getStripeClient() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured")
  return new Stripe(key, { apiVersion: "2025-12-15.clover" })
}

function getPriceIdForTier(tier: string): string | undefined {
  const map: Record<string, string | undefined> = {
    starter: process.env.STRIPE_PRICE_ID_STARTER,
    pro: process.env.STRIPE_PRICE_ID_PRO,
    agency: process.env.STRIPE_PRICE_ID_AGENCY,
  }
  return map[tier]
}

export async function POST(request: Request) {
  try {
    const user = await requireUser()
    const body = await request.json()
    const tier = (body.tier as string)?.toLowerCase()

    const priceId = getPriceIdForTier(tier)
    if (!priceId) {
      return NextResponse.json(
        { error: "Invalid tier or price not configured" },
        { status: 400 }
      )
    }

    const supabase = await createServerSupabaseClient()
    const { data: profile } = await supabase
      .from("profiles")
      .select("current_organization_id")
      .eq("id", user.id)
      .maybeSingle()

    if (!profile?.current_organization_id) {
      return NextResponse.json(
        { error: "No organization found" },
        { status: 400 }
      )
    }

    const admin = createAdminSupabaseClient()
    const { data: org } = await admin
      .from("organizations")
      .select("id, stripe_customer_id, billing_email, name")
      .eq("id", profile.current_organization_id)
      .single()

    if (!org) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 }
      )
    }

    const stripe = getStripeClient()
    let customerId = org.stripe_customer_id

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: org.billing_email ?? user.email ?? undefined,
        name: org.name,
        metadata: { organization_id: org.id },
      })
      customerId = customer.id

      await admin
        .from("organizations")
        .update({ stripe_customer_id: customerId })
        .eq("id", org.id)
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${appUrl}/settings/billing?upgraded=true`,
      cancel_url: `${appUrl}/settings/billing`,
      subscription_data: {
        trial_period_days: 0,
        metadata: { organization_id: org.id },
      },
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error("Stripe checkout error:", err)
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    )
  }
}
