import type Stripe from "stripe"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { IndustryType } from "@/lib/verticals"
import type { SubscriptionTier } from "@/lib/billing/tiers"
import { resolvePriceInfo } from "@/lib/stripe/pricing"

// ----------------------------------------------------------------------------
// Organization resolution
// ----------------------------------------------------------------------------
//
// Stripe webhooks carry a customer ID; some (checkout.session.completed) also
// carry our own client_reference_id = organization.id. Pull both where we can.

export async function resolveOrganizationId(
  admin: SupabaseClient,
  opts: {
    clientReferenceId?: string | null
    stripeCustomerId?: string | null
    stripeSubscriptionId?: string | null
  }
): Promise<string | null> {
  if (opts.clientReferenceId) return opts.clientReferenceId

  if (opts.stripeCustomerId) {
    const { data } = await admin
      .from("organizations")
      .select("id")
      .eq("stripe_customer_id", opts.stripeCustomerId)
      .maybeSingle()
    if (data?.id) return data.id
  }

  if (opts.stripeSubscriptionId) {
    const { data } = await admin
      .from("organizations")
      .select("id")
      .eq("stripe_subscription_id", opts.stripeSubscriptionId)
      .maybeSingle()
    if (data?.id) return data.id
  }

  return null
}

// ----------------------------------------------------------------------------
// Webhook idempotency
// ----------------------------------------------------------------------------
//
// Every webhook handler calls this first. Returns true iff this is the first
// time we've seen the event ID; subsequent calls (Stripe retries) return false
// and the handler should short-circuit.
//
// Implementation: INSERT ON CONFLICT DO NOTHING on the primary key. Postgres
// guarantees this is atomic even under concurrent webhook deliveries.

export async function isWebhookEventNew(
  admin: SupabaseClient,
  eventId: string,
  eventType: string
): Promise<boolean> {
  const { error, data } = await admin
    .from("stripe_webhook_events")
    .insert({ event_id: eventId, event_type: eventType })
    .select("event_id")

  if (error) {
    // Unique-violation = we've seen this event before; any other error should
    // bubble up so Stripe retries and we don't silently drop the event.
    if (error.code === "23505") return false
    throw error
  }

  return (data?.length ?? 0) > 0
}

export async function markWebhookEventProcessed(
  admin: SupabaseClient,
  eventId: string,
  error?: string
): Promise<void> {
  await admin
    .from("stripe_webhook_events")
    .update({
      processed_at: new Date().toISOString(),
      error: error ?? null,
    })
    .eq("event_id", eventId)
}

// ----------------------------------------------------------------------------
// Per-brand Stripe Customer Portal configuration
// ----------------------------------------------------------------------------

export function getPortalConfigId(industry: IndustryType): string | null {
  const key =
    industry === "restaurant"
      ? "STRIPE_PORTAL_CONFIG_TICKET"
      : "STRIPE_PORTAL_CONFIG_NEAT"
  return process.env[key] ?? null
}

// ----------------------------------------------------------------------------
// RBAC: owner/admin role check for billing-mutating routes
// ----------------------------------------------------------------------------
//
// Any server-initiated Stripe mutation (checkout, portal, cancel) must be
// gated to org owners or admins. Membership alone is not enough (a
// "member" role user should not be able to start a checkout).

export type OrgRole = "owner" | "admin" | "member"

export async function requireOrgOwnerOrAdmin(
  supabase: SupabaseClient,
  userId: string,
  orgId: string
): Promise<OrgRole> {
  const { data, error } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error("Not a member of this organization")

  const role = data.role as OrgRole
  if (role !== "owner" && role !== "admin") {
    throw new Error("Only owners or admins can manage billing")
  }
  return role
}

// ----------------------------------------------------------------------------
// Stripe subscription.status -> organizations.payment_state
// ----------------------------------------------------------------------------
//
// We mirror the Stripe status values 1:1. The DB CHECK accepts the superset
// we care about; anything else we let pass through as null so we don't blow up
// on unexpected states.

const VALID_PAYMENT_STATES = new Set([
  "trialing",
  "active",
  "past_due",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "unpaid",
  "paused",
])

export function normalizePaymentState(
  stripeStatus: string | null | undefined
): string | null {
  if (!stripeStatus) return null
  return VALID_PAYMENT_STATES.has(stripeStatus) ? stripeStatus : null
}

// ----------------------------------------------------------------------------
// Subscription -> organization sync
// ----------------------------------------------------------------------------
//
// One field mapping shared by the webhook (source of truth) and the onboarding
// checkout-complete return path (kills the blocked-flash when the redirect
// beats the webhook). Idempotent: applying the same subscription twice writes
// the same row.

// The Stripe types library has drifted on where current_period_end lives:
// top-level on old API versions, item-level on newer ones. Read both.
export function readSubscriptionPeriodEnd(
  subscription: Stripe.Subscription
): number | null {
  const topLevel = (subscription as unknown as { current_period_end?: number })
    .current_period_end
  if (typeof topLevel === "number") return topLevel
  const item = subscription.items.data[0] as unknown as {
    current_period_end?: number
  }
  return typeof item?.current_period_end === "number" ? item.current_period_end : null
}

export async function applySubscriptionToOrg(
  admin: SupabaseClient,
  orgId: string,
  subscription: Stripe.Subscription,
  opts?: { deleted?: boolean }
): Promise<{ tier: SubscriptionTier; paymentState: string | null }> {
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : (subscription.customer?.id ?? null)

  const priceId = subscription.items.data[0]?.price?.id ?? null
  const priceInfo = resolvePriceInfo(priceId)

  // Tier: derived from the subscription's current price. On 'deleted' the
  // tier parks on 'entry' — payment_state 'canceled' is what blocks access
  // (there is no free tier to downgrade to).
  let tier: SubscriptionTier
  if (opts?.deleted) {
    tier = "entry"
  } else if (priceInfo) {
    tier = priceInfo.tier
  } else {
    // Price ID unknown to us (env vars out of sync? deleted price?). Leave
    // the tier field alone rather than stomping a paying customer's tier.
    const { data } = await admin
      .from("organizations")
      .select("subscription_tier")
      .eq("id", orgId)
      .maybeSingle()
    tier = (data?.subscription_tier as SubscriptionTier | undefined) ?? "entry"
  }

  const paymentState = opts?.deleted
    ? "canceled"
    : normalizePaymentState(subscription.status)

  const trialEndIso =
    typeof subscription.trial_end === "number"
      ? new Date(subscription.trial_end * 1000).toISOString()
      : null

  const periodEnd = readSubscriptionPeriodEnd(subscription)

  const updates: Record<string, unknown> = {
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    stripe_price_id: priceId,
    subscription_tier: tier,
    cancel_at_period_end: subscription.cancel_at_period_end ?? false,
    trial_ends_at: trialEndIso,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
  }
  if (paymentState !== null) updates.payment_state = paymentState

  await admin.from("organizations").update(updates).eq("id", orgId)

  return { tier, paymentState }
}
