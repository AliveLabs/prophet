import { NextResponse } from "next/server"
import { randomUUID } from "node:crypto"
import { requireUser } from "@/lib/auth/server"
import { impersonationReadOnlyBlock } from "@/lib/auth/impersonation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { getStripeClient } from "@/lib/stripe/client"
import { requireOrgOwnerOrAdmin, isBillingAuthError } from "@/lib/stripe/helpers"
import { resolvePriceIdOrThrow } from "@/lib/stripe/pricing"
import { verifyReusableCustomer } from "@/lib/stripe/customer-reuse"
import { isValidIndustryType } from "@/lib/verticals"
import {
  SELF_SERVE_TIERS,
  isPaidTier,
  isSelfServeTier,
  isTrialEligibleTier,
  tierDisplayName,
  type Cadence,
} from "@/lib/billing/tiers"
import { SUPPORT_EMAIL } from "@/lib/support/contact"

// POST /api/stripe/checkout
// Body: { tier: 'entry' | 'mid' | 'top', cadence: 'monthly' | 'annual',
//         context?: 'onboarding' }
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
// context 'onboarding' returns the customer to /onboarding/checkout-complete
// (which verifies the session server-side and syncs the org before /home);
// the default returns to the billing page as before.
//
// RBAC: only org owners or admins can start a checkout.

function isCadence(v: unknown): v is Cadence {
  return v === "monthly" || v === "annual"
}

// ALT-732: this validated against PAID_TIERS, which includes the contract-only Multi-Location
// tier, so `{tier:"top"}` resolved a live Stripe price and opened a real checkout. That made
// Multi-Location self-servable at its list rate ($2,750/yr, $275/mo) while Standard costs more
// ($2,990/yr, $299/mo) for strictly less entitlement. A tier being real is not the same question
// as a tier being buyable without us, and this endpoint has to ask the second one.

export async function POST(request: Request) {
  try {
    const block = await impersonationReadOnlyBlock()
    if (block) return NextResponse.json(block, { status: 403 })
    const user = await requireUser()
    const body = await request.json().catch(() => ({}))
    const tier = body.tier
    const cadence = body.cadence

    if (!isSelfServeTier(tier)) {
      // A REAL tier that simply is not self-serve gets an answer an operator can act on; an
      // unrecognised value gets the plain validation error. Collapsing both into one message
      // would tell someone who typo'd a tier to go email sales about Multi-Location.
      const contractOnly = isPaidTier(tier)
      return NextResponse.json(
        {
          error: contractOnly
            ? `${tierDisplayName(tier as string)} is quoted per location rather than sold online. ` +
              `Email ${SUPPORT_EMAIL} and we'll get you set up.`
            : `Invalid tier. Expected one of: ${SELF_SERVE_TIERS.join(", ")}.`,
        },
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
    // ALT-578: takes the default `requireActive: true`. Starting a paid
    // subscription for a soft-deleted organisation must not be possible.
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
    // ALT-551: a stored customer id is a foreign key into a system we do not control.
    // It goes stale (deleted in the Stripe dashboard, left over from test mode, written
    // by the other brand during the shared-DB era) and passing a stale one to Checkout
    // throws "No such customer", which the billing page used to swallow into a dead
    // button. Verify before reuse; mint a fresh customer when it no longer resolves.
    let customerId = await verifyReusableCustomer(stripe, org.stripe_customer_id)

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

      const { error } = await admin
        .from("organizations")
        .update({ stripe_customer_id: customerId })
        .eq("id", org.id)
      if (error) throw new Error(`checkout: failed to link stripe_customer_id for org ${org.id}: ${error.message}`)
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
    const withTrial = isTrialEligibleTier(tier)
    const fromOnboarding = body.context === "onboarding"
    const successUrl = fromOnboarding
      ? `${appUrl}/onboarding/checkout-complete?session_id={CHECKOUT_SESSION_ID}`
      : `${appUrl}/settings/billing?upgraded=true`
    const cancelUrl = fromOnboarding
      ? `${appUrl}/onboarding/trial?canceled=1`
      : `${appUrl}/settings/billing`

    // Idempotency key: same org + same price within a short window collapses
    // to one session. Nonce breaks collisions across distinct user attempts.
    const idempotencyKey = `checkout:${org.id}:${priceId}:${randomUUID()}`

    const session = await stripe.checkout.sessions.create(
      {
        customer: customerId,
        client_reference_id: org.id,
        line_items: [{ price: priceId, quantity: 1 }],
        mode: "subscription",
        success_url: successUrl,
        cancel_url: cancelUrl,
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
    // A typed refusal rather than a regex on the message: a new refusal whose wording
    // missed /owner|admin|member/ used to come back as a 500 "Failed to ...", which reads
    // like our bug instead of a decision about their account. isBillingAuthError keeps the
    // regex as a backstop, so nothing that returned 403 before changes.
    const isAuth = isBillingAuthError(err)
    console.error("Stripe checkout error:", err)
    return NextResponse.json(
      { error: isAuth ? msg : "Failed to create checkout session" },
      { status: isAuth ? 403 : 500 }
    )
  }
}
