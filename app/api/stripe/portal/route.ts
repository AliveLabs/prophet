import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { getStripeClient } from "@/lib/stripe/client"
import {
  getPortalConfigId,
  requireOrgOwnerOrAdmin,
} from "@/lib/stripe/helpers"
import { isValidIndustryType } from "@/lib/verticals"

// POST /api/stripe/portal
// Returns: { url } -- a one-time Stripe Customer Portal URL.
//
// The Portal lets the user upgrade/downgrade between their brand's 3 paid
// tiers, cancel, update payment method, and download invoices. Which of the
// two Portal configurations (Ticket vs Neat) they land on is chosen here
// based on the org's industry_type -- so Ticket customers never see Neat
// product names in the Portal UI.
//
// RBAC: only owners/admins of the org can mint a Portal session.

export async function POST() {
  try {
    const user = await requireUser()

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
      .select("id, stripe_customer_id, industry_type")
      .eq("id", profile.current_organization_id)
      .single()

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 })
    }
    if (!org.stripe_customer_id) {
      return NextResponse.json(
        { error: "No Stripe customer exists for this org yet. Subscribe first." },
        { status: 400 }
      )
    }
    if (!isValidIndustryType(org.industry_type)) {
      return NextResponse.json(
        { error: `Unknown industry_type '${org.industry_type}' on org` },
        { status: 500 }
      )
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
    const configurationId = getPortalConfigId(org.industry_type)

    const stripe = getStripeClient()
    const session = await stripe.billingPortal.sessions.create({
      customer: org.stripe_customer_id,
      return_url: `${appUrl}/settings/billing`,
      ...(configurationId ? { configuration: configurationId } : {}),
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create portal session"
    const isAuth = /owner|admin|member/i.test(msg)
    console.error("Stripe portal error:", err)
    return NextResponse.json(
      { error: isAuth ? msg : "Failed to create portal session" },
      { status: isAuth ? 403 : 500 }
    )
  }
}
