import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/server"
import { impersonationReadOnlyBlock } from "@/lib/auth/impersonation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { getStripeClient } from "@/lib/stripe/client"
import {
  getPortalConfigId,
  requireOrgOwnerOrAdmin,
} from "@/lib/stripe/helpers"
import { isValidIndustryType } from "@/lib/verticals"

// POST /api/stripe/portal
// Body: { flow?: 'payment_method_update' } — ALT-228: plan changes and
// cancellation now happen in-app (change-plan/cancel routes); the Portal is
// reserved for what genuinely can't be done in-app — updating the tokenized
// card itself. Passing flow scopes the session to JUST that flow. Omitting it
// falls back to the full Portal (invoices, etc.) which still isn't dead scope
// even for our billing page, but is what will be used from anywhere still
// linking generically.
// Returns: { url } -- a one-time Stripe Customer Portal URL.
//
// Which of the two Portal configurations (Ticket vs Neat) is used is chosen
// here based on the org's industry_type -- so Ticket customers never see Neat
// product names in the Portal UI.
//
// RBAC: only owners/admins of the org can mint a Portal session.

export async function POST(request: Request) {
  try {
    const block = await impersonationReadOnlyBlock()
    if (block) return NextResponse.json(block, { status: 403 })
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

    const body = await request.json().catch(() => ({}))
    const flow = body.flow === "payment_method_update" ? "payment_method_update" as const : null

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
    const configurationId = getPortalConfigId(org.industry_type)

    const stripe = getStripeClient()
    const session = await stripe.billingPortal.sessions.create({
      customer: org.stripe_customer_id,
      return_url: `${appUrl}/settings/billing`,
      ...(configurationId ? { configuration: configurationId } : {}),
      ...(flow ? { flow_data: { type: flow } } : {}),
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
