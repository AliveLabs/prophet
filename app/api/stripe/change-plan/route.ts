import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/server"
import { impersonationReadOnlyBlock } from "@/lib/auth/impersonation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { getStripeClient } from "@/lib/stripe/client"
import { requireOrgOwnerOrAdmin, applySubscriptionToOrg } from "@/lib/stripe/helpers"
import { resolvePriceIdOrThrow, resolveAddOnPriceInfo } from "@/lib/stripe/pricing"
import { isValidIndustryType } from "@/lib/verticals"
import {
  SELF_SERVE_TIERS,
  TIER_LIMITS,
  isPaidTier,
  isSelfServeTier,
  tierDisplayName,
  type Cadence,
} from "@/lib/billing/tiers"
import {
  planCompetitorTrim,
  resolveTrimSelection,
  type TrimLocation,
} from "@/lib/billing/competitor-trim"
import { SUPPORT_EMAIL } from "@/lib/support/contact"

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
    // Present on the SECOND call, after the customer has chosen what to keep on the trim screen.
    const keepCompetitorIds: string[] | null = Array.isArray(body.keepCompetitorIds)
      ? body.keepCompetitorIds.filter((x: unknown): x is string => typeof x === "string")
      : null

    // ALT-732: same hole as /api/stripe/checkout, in the second of the two endpoints that can
    // move money. This validated with PAID_TIERS, so an existing Standard subscriber could
    // change-plan onto contract-only Multi-Location and land on a CHEAPER price with strictly
    // more entitlement, without ever touching a checkout page.
    if (!isSelfServeTier(tier)) {
      const contractOnly = isPaidTier(tier)
      return NextResponse.json(
        {
          error: contractOnly
            ? `${tierDisplayName(tier as string)} is quoted per location rather than sold online. ` +
              `Email ${SUPPORT_EMAIL} and we'll get you set up.`
            : `Invalid tier. Expected one of: ${SELF_SERVE_TIERS.join(", ")}.`,
        },
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
        { error: "No active subscription to change. Subscribe first." },
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
    // ALT-755: this took items.data[0] and assumed it was the BASE plan. A subscription now carries
    // a base item plus up to two add-on items (locations, competitors), and Stripe does not promise
    // an order, so a plan change could reprice an ADD-ON at the base plan's price and leave the base
    // untouched. At the add-on rates that is a $650/mo error in either direction.
    //
    // The base item is the one whose price resolves as a BASE price. resolveAddOnPriceInfo returns
    // non-null only for add-on price IDs, so it is the discriminator, and it already exists for the
    // webhook to read the same distinction. No new mapping.
    //
    // Latent while add-on purchasing does not exist, so every live subscription has exactly one
    // item and items.data[0] happens to be right. That is luck, not correctness.
    const baseItem = current.items.data.find(
      (i) => resolveAddOnPriceInfo(typeof i.price === "string" ? i.price : i.price?.id) == null,
    )
    const currentItemId = baseItem?.id
    if (!currentItemId) {
      return NextResponse.json(
        { error: "Subscription has no base plan line item to change." },
        { status: 500 },
      )
    }

    // ALT-758: a plan change DURING A TRIAL has to say what happens to the trial, explicitly.
    //
    // Stripe's documented rule: switching prices "does not normally change the billing date or
    // generate an immediate charge unless: the billing interval is changed [...] a trial starts
    // or ends", and in those cases Stripe will "apply a credit for the unused time on the previous
    // price, immediately charge the customer using the new price, and reset the billing date".
    //
    // So a trialing customer switching monthly -> annual was one interval change away from being
    // charged in the middle of a trial we told them was $0 for 14 days. Relying on the default
    // was the bug: it left the outcome to an interaction between two Stripe rules.
    //
    // Passing `trial_end` explicitly removes the ambiguity. Per the same docs it "will always
    // overwrite any trials that might apply via a subscribed plan" and "the billing_cycle_anchor
    // will be updated to the trial_end value", which is exactly what we want: the trial ends when
    // we promised, and the first charge lands then, at the new price and cadence. Prorations are
    // switched off for that path because there is no used paid time to prorate.
    //
    // NOT blocked: moving to Starter mid-trial, even though TRIAL_ELIGIBLE_TIERS is ["mid"] only,
    // so the trial continues on a tier that has no trial of its own. That is deliberate. Blocking
    // it would tell someone who has decided Standard is too expensive that their only option is
    // to cancel, and losing the account costs far more than the few days of Starter serve cost.
    // Flagged for Bryan rather than decided silently; reversing it is a one-line guard here.
    // ── Downgrading past the competitor cap needs the customer's choice, not ours ──────────────
    //
    // A Standard org holding 5 competitors moving to Starter (cap 3) used to just... land there.
    // Nothing deactivated the excess, the roster still showed 5, and the nightly brief analysed an
    // arbitrary subset. Ordering that query made it deterministic and the over-cap notice made it
    // visible, but neither is the same as being ASKED. Bryan's call: a deselect screen.
    //
    // So this route answers the first call with a 409 carrying what the screen needs, and applies
    // the change on the second call once `keepCompetitorIds` says what to keep.
    const newCap = TIER_LIMITS[tier].includedCompetitorsPerLocation
    const { data: locRows } = await admin
      .from("locations")
      .select("id, name, competitors_purchased")
      .eq("organization_id", org.id)
    const { data: compRows } = await admin
      .from("competitors")
      .select("id, name, location_id, created_at, metadata")
      .in("location_id", (locRows ?? []).map((l) => l.id))
      .eq("is_active", true)

    const trimLocations: TrimLocation[] = (locRows ?? []).map((l) => ({
      locationId: l.id,
      locationName: l.name ?? "This location",
      // Purchased slots survive a plan change: they are billed separately, so they add to the NEW
      // tier's included count rather than being lost with the old one.
      cap: newCap + Math.max(0, l.competitors_purchased ?? 0),
      competitors: (compRows ?? [])
        .filter(
          (c) =>
            c.location_id === l.id &&
            (c.metadata as Record<string, unknown> | null)?.status === "approved",
        )
        .map((c) => ({ id: c.id, name: c.name ?? "This competitor", createdAt: c.created_at })),
    }))
    const trims = planCompetitorTrim(trimLocations)

    let removeIds: string[] = []
    if (trims.length > 0) {
      if (!keepCompetitorIds) {
        // Not an error the customer caused, so it carries the data to fix it rather than a message.
        return NextResponse.json(
          {
            reason: "needs_competitor_selection",
            error: "Choose which competitors to keep on this plan.",
            newTierName: tierDisplayName(tier),
            selection: trims.map((t) => ({
              locationId: t.locationId,
              locationName: t.locationName,
              cap: t.cap,
              mustRemove: t.mustRemove,
              suggestedKeepIds: t.suggestedKeepIds,
              competitors: t.competitors.map((c) => ({ id: c.id, name: c.name })),
            })),
          },
          { status: 409 },
        )
      }
      const resolved = resolveTrimSelection(trims, keepCompetitorIds)
      if (!resolved.ok) {
        return NextResponse.json({ error: resolved.message }, { status: 400 })
      }
      removeIds = resolved.removeIds
    }

    const trialEnd = current.status === "trialing" ? current.trial_end : null
    const updated = await stripe.subscriptions.update(org.stripe_subscription_id, {
      items: [{ id: currentItemId, price: newPriceId }],
      ...(typeof trialEnd === "number"
        ? { trial_end: trialEnd, proration_behavior: "none" as const }
        : { proration_behavior: "always_invoice" as const }),
    })

    const { tier: newTier } = await applySubscriptionToOrg(admin, org.id, updated)

    // Deactivate AFTER the plan change lands, deliberately. The other order strips competitors and
    // then, if Stripe refuses, leaves the customer on the plan they were trying to leave with data
    // gone for nothing. This order can only leave them briefly over cap, which the competitors page
    // now states plainly and the nightly brief handles deterministically.
    //
    // Soft delete (is_active = false), which is what the rest of the product means by "stop
    // watching": history survives and re-adding restores it.
    if (removeIds.length > 0) {
      const { error: trimErr } = await admin
        .from("competitors")
        .update({ is_active: false })
        .in("id", removeIds)
      if (trimErr) {
        console.error(
          `[change-plan] plan changed to ${newTier} but trimming ${removeIds.length} competitor(s) FAILED org=${org.id}: ${trimErr.message}`,
        )
        return NextResponse.json({
          ok: true,
          tier: newTier,
          warning:
            "Your plan changed, but we could not stop watching the ones you deselected. Your Competitors page will show what is over your plan.",
        })
      }
    }

    return NextResponse.json({ ok: true, tier: newTier, removed: removeIds.length })
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
