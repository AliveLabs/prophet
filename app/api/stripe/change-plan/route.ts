import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/server"
import { impersonationReadOnlyBlock } from "@/lib/auth/impersonation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { getStripeClient } from "@/lib/stripe/client"
import { requireOrgOwnerOrAdmin, applySubscriptionToOrg } from "@/lib/stripe/helpers"
import { resolvePriceIdOrThrow } from "@/lib/stripe/pricing"
import { isValidIndustryType } from "@/lib/verticals"
import { PAID_TIERS, type Cadence, type SubscriptionTier } from "@/lib/billing/tiers"

// POST /api/stripe/change-plan
// Body: { tier: 'entry' | 'mid' | 'top', cadence: 'monthly' | 'annual' }
//
// ALT-228: in-app upgrade/downgrade for an EXISTING subscription (checkout/
// route.ts is for NEW subscriptions only). Updates the subscription's price
// in place via stripe.subscriptions.update — Stripe prorates automatically.
// Applies the returned subscription to the org synchronously (same pattern as
// the onboarding checkout-complete return path) so the UI reflects the new
// tier immediately rather than waiting on webhook delivery; the webhook still
// fires and re-applies idempotently.
//
// RBAC: only org owners or admins.

function isPaidTier(v: unknown): v is Exclude<SubscriptionTier, "suspended"> {
  return typeof v === "string" && (PAID_TIERS as readonly string[]).includes(v)
}

function isCadence(v: unknown): v is Cadence {
  return v === "monthly" || v === "annual"
}

export async function POST(request: Request) {
  try {
    const block = await impersonationReadOnlyBlock()
    if (block) return NextResponse.json(block, { status: 403 })
    const user = await requireUser()
    const body = await request.json().catch(() => ({}))
    const tier = body.tier
    const cadence = body.cadence

    if (!isPaidTier(tier)) {
      return NextResponse.json(
        { error: "Invalid tier. Expected one of: entry, mid, top." },
        { status: 400 },
      )
    }
    if (!isCadence(cadence)) {
      return NextResponse.json(
        { error: "Invalid cadence. Expected 'monthly' or 'annual'." },
        { status: 400 },
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

    await requireOrgOwnerOrAdmin(supabase, user.id, profile.current_organization_id)

    const admin = createAdminSupabaseClient()
    const { data: org } = await admin
      .from("organizations")
      .select("id, stripe_subscription_id, industry_type")
      .eq("id", profile.current_organization_id)
      .single()

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 })
    }
    if (!org.stripe_subscription_id) {
      return NextResponse.json(
        { error: "No active subscription to change — subscribe first." },
        { status: 400 },
      )
    }
    if (!isValidIndustryType(org.industry_type)) {
      return NextResponse.json(
        { error: `Unknown industry_type '${org.industry_type}' on org` },
        { status: 500 },
      )
    }

    const newPriceId = resolvePriceIdOrThrow(org.industry_type, tier, cadence)

    const stripe = getStripeClient()
    const current = await stripe.subscriptions.retrieve(org.stripe_subscription_id)
    const currentItemId = current.items.data[0]?.id
    if (!currentItemId) {
      return NextResponse.json(
        { error: "Subscription has no line item to change." },
        { status: 500 },
      )
    }

    const updated = await stripe.subscriptions.update(org.stripe_subscription_id, {
      items: [{ id: currentItemId, price: newPriceId }],
      proration_behavior: "always_invoice",
    })

    const { tier: newTier } = await applySubscriptionToOrg(admin, org.id, updated)

    return NextResponse.json({ ok: true, tier: newTier })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to change plan"
    const isAuth = /owner|admin|member/i.test(msg)
    console.error("Stripe change-plan error:", err)
    return NextResponse.json(
      { error: isAuth ? msg : "Failed to change plan" },
      { status: isAuth ? 403 : 500 },
    )
  }
}
