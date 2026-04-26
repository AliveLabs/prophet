import { NextResponse } from "next/server"
import { randomUUID } from "node:crypto"
import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { getStripeClient } from "@/lib/stripe/client"
import { requireOrgOwnerOrAdmin } from "@/lib/stripe/helpers"
import { resolvePriceIdOrThrow } from "@/lib/stripe/pricing"
import { isValidIndustryType } from "@/lib/verticals"
import {
  PAID_TIERS,
  isTrialEligibleTier,
  type Cadence,
  type SubscriptionTier,
} from "@/lib/billing/tiers"

// POST /api/stripe/checkout
// Body: { tier: 'entry' | 'mid' | 'top', cadence: 'monthly' | 'annual' }
//
// Creates (or reuses) a Stripe Customer for the user's current organization,
// then opens a Checkout Session. The price is resolved server-side from
// (industry_type, tier, cadence) so a Ticket org cannot check out a Neat price
// by tampering with the request body.
//
// Trial rules (brief section 3/4):
//   - Only the mid tier offers a 14-day trial.
//   - Card is required up front (payment_method_collection: 'always').
//   - On trial end with no payment method, Stripe cancels the subscription
//     (trial_settings.end_behavior.missing_payment_method = 'cancel').
//
// RBAC: only org owners or admins can start a checkout.

function isCadence(v: unknown): v is Cadence {
  return v === "monthly" || v === "annual"
}

function isPaidTier(v: unknown): v is Exclude<SubscriptionTier, "free" | "suspended"> {
  return typeof v === "string" && (PAID_TIERS as readonly string[]).includes(v)
}

export async function POST(request: Request) {
  try {
    const user = await requireUser()
    const body = await request.json().catch(() => ({}))
    const tier = body.tier
    const cadence = body.cadence

    if (!isPaidTier(tier)) {
      return NextResponse.json(
        { error: "Invalid tier. Expected one of: entry, mid, top." },
        { status: 400 }
      )
    }
    if (!isCadence(cadence)) {
      return NextResponse.json(
        { error: "Invalid cadence. Expected 'monthly' or 'annual'." },
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
      return NextResponse.json({ error: "No organization found" }, { status: 400 })
    }

    // RBAC must come before any Stripe-side work.
    await requireOrgOwnerOrAdmin(supabase, user.id, profile.current_organization_id)

    const admin = createAdminSupabaseClient()
    const { data: org } = await admin
      .from("organizations")
      .select("id, stripe_customer_id, billing_email, name, industry_type")
      .eq("id", profile.current_organization_id)
      .single()

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 })
    }
    if (!isValidIndustryType(org.industry_type)) {
      return NextResponse.json(
        { error: `Unknown industry_type '${org.industry_type}' on org` },
        { status: 500 }
      )
    }

    const priceId = resolvePriceIdOrThrow(org.industry_type, tier, cadence)

    const stripe = getStripeClient()
    let customerId = org.stripe_customer_id

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: org.billing_email ?? user.email ?? undefined,
        name: org.name,
        metadata: {
          organization_id: org.id,
          industry_type: org.industry_type,
        },
      })
      customerId = customer.id

      await admin
        .from("organizations")
        .update({ stripe_customer_id: customerId })
        .eq("id", org.id)
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
    const withTrial = isTrialEligibleTier(tier)

    // Idempotency key: same org + same price within a short window collapses
    // to one session. Nonce breaks collisions across distinct user attempts.
    const idempotencyKey = `checkout:${org.id}:${priceId}:${randomUUID()}`

    const session = await stripe.checkout.sessions.create(
      {
        customer: customerId,
        client_reference_id: org.id,
        line_items: [{ price: priceId, quantity: 1 }],
        mode: "subscription",
        success_url: `${appUrl}/settings/billing?upgraded=true`,
        cancel_url: `${appUrl}/settings/billing`,
        allow_promotion_codes: true,
        payment_method_collection: "always",
        subscription_data: {
          metadata: {
            organization_id: org.id,
            industry_type: org.industry_type,
            tier,
            cadence,
          },
          ...(withTrial
            ? {
                trial_period_days: 14,
                trial_settings: {
                  end_behavior: { missing_payment_method: "cancel" },
                },
              }
            : {}),
        },
      },
      { idempotencyKey }
    )

    return NextResponse.json({ url: session.url })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create checkout session"
    const isAuth = /owner|admin|member/i.test(msg)
    console.error("Stripe checkout error:", err)
    return NextResponse.json(
      { error: isAuth ? msg : "Failed to create checkout session" },
      { status: isAuth ? 403 : 500 }
    )
  }
}
