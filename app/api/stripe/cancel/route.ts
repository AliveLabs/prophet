import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/server"
import { impersonationReadOnlyBlock } from "@/lib/auth/impersonation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { getStripeClient } from "@/lib/stripe/client"
import { requireOrgOwnerOrAdmin, applySubscriptionToOrg } from "@/lib/stripe/helpers"

// POST /api/stripe/cancel
// Body: { resume?: boolean } — omitted/false schedules a cancellation at the
// end of the current billing period (the standard self-serve UX: you keep
// access through what you already paid for); resume:true undoes a pending
// cancellation. Neither ever cancels IMMEDIATELY — that's the admin-only
// deactivateOrg path (app/actions/org-management.ts), a different intent.
//
// RBAC: only org owners or admins.

export async function POST(request: Request) {
  try {
    const block = await impersonationReadOnlyBlock()
    if (block) return NextResponse.json(block, { status: 403 })
    const user = await requireUser()
    const body = await request.json().catch(() => ({}))
    const resume = body.resume === true

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
      .select("id, stripe_subscription_id")
      .eq("id", profile.current_organization_id)
      .single()

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 })
    }
    if (!org.stripe_subscription_id) {
      return NextResponse.json({ error: "No active subscription to cancel." }, { status: 400 })
    }

    const stripe = getStripeClient()
    const updated = await stripe.subscriptions.update(org.stripe_subscription_id, {
      cancel_at_period_end: !resume,
    })

    await applySubscriptionToOrg(admin, org.id, updated)

    return NextResponse.json({ ok: true, cancelAtPeriodEnd: updated.cancel_at_period_end })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update subscription"
    const isAuth = /owner|admin|member/i.test(msg)
    console.error("Stripe cancel error:", err)
    return NextResponse.json(
      { error: isAuth ? msg : "Failed to update subscription" },
      { status: isAuth ? 403 : 500 },
    )
  }
}
