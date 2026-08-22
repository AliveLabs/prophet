import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/server"
import { impersonationReadOnlyBlock } from "@/lib/auth/impersonation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { getStripeClient } from "@/lib/stripe/client"
import { requireOrgOwnerOrAdmin, applySubscriptionToOrg } from "@/lib/stripe/helpers"
import {
  resolveAddOnPriceId,
  resolveAddOnPriceInfo,
  resolvePriceInfo,
  type AddOnKind,
} from "@/lib/stripe/pricing"
import {
  addOnRecurringSummary,
  planAddOnChange,
  type AddOnContext,
} from "@/lib/stripe/addons"
import { asSubscriptionTier } from "@/lib/billing/tiers"
import { ensureCompetitorAllocation } from "@/lib/billing/limits"
import { isValidIndustryType } from "@/lib/verticals"
import { SUPPORT_EMAIL } from "@/lib/support/contact"
import type Stripe from "stripe"

// POST /api/stripe/addons
// Body: { kind: "location" | "competitor", quantity: number, locationId?: string, preview?: boolean }
//
// ALT-689. Buy or remove add-on quantities without a support conversation.
//
// `quantity` is the TOTAL wanted, not a delta, so a double-clicked button is idempotent rather than
// buying twice. Every refusal is decided by `planAddOnChange` in lib/stripe/addons.ts, which is a
// pure function with its own tests: the rules that stop a bad charge do not live in this file.
//
// Two Stripe traps this respects, both of which have bitten this repo already:
//   - a subscription carries a base item plus up to two add-on items and Stripe promises no order,
//     so the base item is found by asking which price is NOT an add-on (ALT-755), never data[0]
//   - add-on prices must never reach the portal's subscription_update allow-list, which is why this
//     route touches subscription items directly and does not go near the portal config

export const maxDuration = 30

type Body = {
  kind?: unknown
  quantity?: unknown
  locationId?: unknown
  preview?: unknown
}

function isAddOnKind(v: unknown): v is AddOnKind {
  return v === "location" || v === "competitor"
}

/** The add-on subscription item for a kind, or null when the customer has none yet. */
function findAddOnItem(sub: Stripe.Subscription, kind: AddOnKind) {
  return (
    sub.items.data.find((i) => {
      const priceId = typeof i.price === "string" ? i.price : i.price?.id
      return resolveAddOnPriceInfo(priceId)?.kind === kind
    }) ?? null
  )
}

/** The BASE plan item: the one whose price is not an add-on price (ALT-755). */
function findBaseItem(sub: Stripe.Subscription) {
  return (
    sub.items.data.find((i) => {
      const priceId = typeof i.price === "string" ? i.price : i.price?.id
      return resolveAddOnPriceInfo(priceId) == null
    }) ?? null
  )
}

export async function POST(request: Request) {
  try {
    const block = await impersonationReadOnlyBlock()
    if (block) return NextResponse.json(block, { status: 403 })
    const user = await requireUser()

    const body = (await request.json().catch(() => ({}))) as Body
    if (!isAddOnKind(body.kind)) {
      return NextResponse.json(
        { error: "Invalid kind. Expected 'location' or 'competitor'." },
        { status: 400 },
      )
    }
    const kind = body.kind
    const quantity = typeof body.quantity === "number" ? body.quantity : Number.NaN
    const locationId = typeof body.locationId === "string" ? body.locationId : null
    const previewOnly = body.preview === true

    const supabase = await createServerSupabaseClient()
    const { data: profile } = await supabase
      .from("profiles")
      .select("current_organization_id")
      .eq("id", user.id)
      .maybeSingle()
    if (!profile?.current_organization_id) {
      return NextResponse.json({ error: "No organization found" }, { status: 400 })
    }
    const orgId = profile.current_organization_id
    await requireOrgOwnerOrAdmin(supabase, user.id, orgId)

    const admin = createAdminSupabaseClient()
    const { data: org } = await admin
      .from("organizations")
      .select("id, subscription_tier, stripe_subscription_id, industry_type")
      .eq("id", orgId)
      .single()
    if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 })
    if (!isValidIndustryType(org.industry_type)) {
      return NextResponse.json(
        { error: `Unknown industry_type '${org.industry_type}' on org` },
        { status: 500 },
      )
    }

    const tier = asSubscriptionTier(org.subscription_tier)

    // ── Build the decision context from Stripe, which is billing truth ─────────────────────────
    const stripe = getStripeClient()
    let sub: Stripe.Subscription | null = null
    if (org.stripe_subscription_id) {
      sub = await stripe.subscriptions.retrieve(org.stripe_subscription_id)
    }

    const baseItem = sub ? findBaseItem(sub) : null
    const basePriceId = baseItem
      ? typeof baseItem.price === "string"
        ? baseItem.price
        : baseItem.price?.id
      : null
    // Cadence comes off the BASE price: an add-on must bill on the same interval as the plan it
    // attaches to, or Stripe ends up with mixed intervals on one subscription.
    const cadence = resolvePriceInfo(basePriceId)?.cadence ?? null

    const existingItem = sub ? findAddOnItem(sub, kind) : null
    const currentQuantity = existingItem?.quantity ?? 0

    // ALT-756: competitor slots are allocated per location, so a reduction must not orphan slots
    // that OTHER locations are already using.
    let allocatedElsewhere = 0
    if (kind === "competitor") {
      const { data: locRows } = await admin
        .from("locations")
        .select("id, competitors_purchased")
        .eq("organization_id", orgId)
      allocatedElsewhere = (locRows ?? [])
        .filter((l) => l.id !== locationId)
        .reduce((sum, l) => sum + Math.max(0, l.competitors_purchased ?? 0), 0)
    }

    const ctx: AddOnContext = {
      tier,
      cadence,
      // Stripe's status is authoritative for "is this a trial", not our mirrored column.
      trialing: sub?.status === "trialing",
      hasSubscription: Boolean(sub) && sub?.status !== "canceled",
      currentQuantity,
      allocatedElsewhere,
    }

    const plan = planAddOnChange(ctx, { kind, quantity, locationId })
    if (!plan.ok) {
      return NextResponse.json(
        { error: plan.message, reason: plan.reason },
        // `unchanged` is not a client error worth a red banner; it is a no-op.
        { status: plan.reason === "unchanged" ? 200 : 400 },
      )
    }

    const recurring = addOnRecurringSummary(plan)
    const priceId = resolveAddOnPriceId(org.industry_type, kind, plan.cadence, plan.tierForPrice)
    if (!priceId) {
      // A missing env var is an ops problem, not the customer's fault. Say so without naming a vendor.
      console.error(
        `[addons] no price configured org=${orgId} kind=${kind} tier=${plan.tierForPrice ?? "-"} cadence=${plan.cadence}`,
      )
      return NextResponse.json(
        { error: `We couldn't price that yet. Email ${SUPPORT_EMAIL} and we'll sort it.` },
        { status: 500 },
      )
    }

    // ── Preview: the recurring figure, and a plain statement that today is prorated ──────────
    //
    // Bryan, 2026-08-22: state the monthly amount and say the first charge is prorated, rather than
    // computing a to-the-cent figure. It passes on making a judgement call while still implying the
    // charge is smaller than a full month, and it is honest without a second source of truth for a
    // number Stripe owns.
    //
    // This deliberately does NOT call invoices.createPreview any more. A number we do not display
    // is a Stripe round-trip, a latency cost and a failure mode bought for nothing. Everything
    // returned here is computed locally by addOnRecurringSummary, which has tests.
    if (previewOnly) {
      return NextResponse.json({
        ok: true,
        preview: true,
        kind,
        quantity: plan.quantity,
        delta: plan.delta,
        unit: recurring.unit,
        total: recurring.total,
        perLabel: recurring.perLabel,
      })
    }

    // ── Apply ─────────────────────────────────────────────────────────────────────────────────
    let updated: Stripe.Subscription
    if (existingItem && plan.quantity === 0) {
      // Removing entirely. Deleting the item is cleaner than quantity 0, which Stripe treats as a
      // billable line of zero and leaves cluttering the invoice.
      updated = await stripe.subscriptions.update(sub!.id, {
        items: [{ id: existingItem.id, deleted: true }],
        proration_behavior: "always_invoice",
      })
    } else if (existingItem) {
      updated = await stripe.subscriptions.update(sub!.id, {
        items: [{ id: existingItem.id, quantity: plan.quantity }],
        proration_behavior: "always_invoice",
      })
    } else {
      updated = await stripe.subscriptions.update(sub!.id, {
        items: [{ price: priceId, quantity: plan.quantity }],
        proration_behavior: "always_invoice",
      })
    }

    // Mirror the new quantities immediately rather than waiting on webhook delivery, the same
    // pattern change-plan uses. The webhook still fires and re-applies idempotently.
    await applySubscriptionToOrg(admin, org.id, updated)

    // ── Allocate, for competitors ──────────────────────────────────────────────────────────────
    // Stripe knows how many were bought; only we know where they go. Done AFTER the successful
    // charge so the invariant (allocated <= billed) can never be transiently violated.
    if (kind === "competitor" && locationId) {
      const perLocation = Math.max(0, plan.quantity - allocatedElsewhere)
      ensureCompetitorAllocation(plan.quantity, allocatedElsewhere + perLocation)
      const { error: allocErr } = await admin
        .from("locations")
        .update({ competitors_purchased: perLocation })
        .eq("id", locationId)
        .eq("organization_id", orgId)
      if (allocErr) {
        // The charge succeeded and the allocation did not, which is the one ordering that can bill
        // for something undelivered. Loud, because it needs a human, and the customer is told.
        console.error(
          `[addons] ALLOCATION FAILED AFTER CHARGE org=${orgId} location=${locationId} qty=${perLocation}: ${allocErr.message}`,
        )
        return NextResponse.json(
          {
            error:
              `Your subscription was updated but we couldn't apply the slot to that location. ` +
              `Email ${SUPPORT_EMAIL} and we'll fix it right away.`,
          },
          { status: 500 },
        )
      }
    }

    return NextResponse.json({
      ok: true,
      kind,
      quantity: plan.quantity,
      delta: plan.delta,
      unit: recurring.unit,
      total: recurring.total,
      perLabel: recurring.perLabel,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update add-ons"
    const isAuth = /owner|admin|member/i.test(msg)
    console.error("Stripe add-on error:", err)
    return NextResponse.json(
      { error: isAuth ? msg : "Failed to update add-ons" },
      { status: isAuth ? 403 : 500 },
    )
  }
}
