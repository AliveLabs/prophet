import type { SupabaseClient } from "@supabase/supabase-js"
import type { IndustryType } from "@/lib/verticals"

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
