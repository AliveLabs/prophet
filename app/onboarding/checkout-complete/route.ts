import { NextResponse } from "next/server"
import type Stripe from "stripe"
import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { getStripeClient } from "@/lib/stripe/client"
import { applySubscriptionToOrg } from "@/lib/stripe/helpers"

// GET /onboarding/checkout-complete?session_id={CHECKOUT_SESSION_ID}
//
// Stripe redirects here after the onboarding trial checkout. The webhook is
// the source of truth, but it can lose the race against this redirect — so we
// verify the session server-side and apply the same idempotent org sync
// before sending the user to /home. session_id is unguessable and is
// retrieved with our secret key; the org comes from client_reference_id we
// set at session creation, so nothing here trusts client input.

export async function GET(request: Request) {
  const url = new URL(request.url)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? url.origin

  const user = await requireUser()

  const sessionId = url.searchParams.get("session_id")
  if (!sessionId) {
    return NextResponse.redirect(`${appUrl}/onboarding/trial?error=missing_session`)
  }

  try {
    const stripe = getStripeClient()
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    })

    const orgId = session.client_reference_id
    const subscription = session.subscription as Stripe.Subscription | null

    if (!orgId || !subscription || typeof subscription === "string") {
      return NextResponse.redirect(`${appUrl}/onboarding/trial?error=incomplete`)
    }

    // The signed-in user must belong to the org the session was created for.
    const supabase = await createServerSupabaseClient()
    const { data: membership } = await supabase
      .from("organization_members")
      .select("id")
      .eq("organization_id", orgId)
      .eq("user_id", user.id)
      .maybeSingle()
    if (!membership) {
      return NextResponse.redirect(`${appUrl}/home`)
    }

    const admin = createAdminSupabaseClient()
    await applySubscriptionToOrg(admin, orgId, subscription)

    return NextResponse.redirect(`${appUrl}/home?trial_started=1`)
  } catch (err) {
    console.error("checkout-complete verification failed:", err)
    // The webhook will still land; let the user through to the app rather
    // than stranding them on an error page.
    return NextResponse.redirect(`${appUrl}/home`)
  }
}
