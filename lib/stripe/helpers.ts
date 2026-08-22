import type Stripe from "stripe"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { IndustryType } from "@/lib/verticals"
import type { SubscriptionTier } from "@/lib/billing/tiers"
import { resolvePriceInfo, resolveAddOnPriceInfo, priceBelongsToIndustry } from "@/lib/stripe/pricing"

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

/** What to do with an incoming delivery. */
export type WebhookAdmission =
  /** Never seen. Run the handler. */
  | "process"
  /** Seen AND completed cleanly. Stripe is just re-delivering; do nothing. */
  | "skip_duplicate"
  /** Seen, but the last attempt did not succeed. Run the handler again. */
  | "retry_failed"

/** PURE: the admission decision for an existing ledger row (null = no row yet).
 *
 *  ALT-738: the old `isWebhookEventNew` collapsed "we finished this" and "we have seen this",
 *  which silently discarded every retry of a FAILED event:
 *
 *    1. delivery arrives, ledger row inserted BEFORE dispatch
 *    2. handler throws, route records the error and returns 500 so Stripe retries
 *    3. Stripe retries, the insert hits 23505, we answer "ok (duplicate)" 200
 *    4. the event is gone for good, and the recorded error is read by nobody
 *
 *  So a transient failure in any handler left the org's billing state permanently diverged from
 *  Stripe: wrong tier, wrong payment_state, wrong access. Returning 500 to trigger a retry was
 *  pointless, because the retry could never get past the dedupe.
 *
 *  Insert-before-dispatch is still right (it is what makes concurrent deliveries safe), so the
 *  fix is to read the row's OUTCOME rather than its existence.
 *
 *  A row with `processed_at` null means a previous attempt died before it could record anything:
 *  a timeout, an OOM, a cold-start abort. That is exactly a case worth retrying, and it is
 *  indistinguishable from "in flight right now" only for the seconds a handler runs. Stripe's
 *  retry schedule is minutes apart, so treating it as retryable is safe and losing it is not.
 *
 *  Retry safety, checked per handler 2026-08-21: every throw point precedes the only outbound
 *  email (`invoice.payment_failed` sends last and swallows its own send errors), and the state
 *  writers are upserts. Anything added here must keep that property, or it will double-fire. */
export function admitWebhookEvent(
  row: { processed_at: string | null; error: string | null } | null
): WebhookAdmission {
  if (row == null) return "process"
  if (row.processed_at != null && row.error == null) return "skip_duplicate"
  return "retry_failed"
}

/** Claim a delivery: insert the ledger row if new, otherwise read what happened last time. */
export async function claimWebhookEvent(
  admin: SupabaseClient,
  eventId: string,
  eventType: string
): Promise<WebhookAdmission> {
  const { error, data } = await admin
    .from("stripe_webhook_events")
    .insert({ event_id: eventId, event_type: eventType })
    .select("event_id")

  // Insert succeeded, so this delivery is genuinely new.
  if (!error) return (data?.length ?? 0) > 0 ? "process" : "retry_failed"

  // Anything other than a unique violation should bubble up, so Stripe retries rather than us
  // silently dropping the event.
  if (error.code !== "23505") throw error

  // Seen before. The DECISION now depends on how the last attempt ended.
  const { data: existing, error: readErr } = await admin
    .from("stripe_webhook_events")
    .select("processed_at, error")
    .eq("event_id", eventId)
    .maybeSingle()
  // A failed read must not be mistaken for "already handled cleanly": re-running an idempotent
  // handler is cheap, dropping a billing event is not.
  if (readErr) {
    console.error(`[stripe-webhook] ledger read failed for ${eventId}, re-running: ${readErr.message}`)
    return "retry_failed"
  }
  return admitWebhookEvent(existing ?? null)
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

// Ordering/concurrency guard: Stripe does not guarantee webhook delivery
// order, and two deliveries for the same org can run concurrently. When
// `eventCreated` (the Stripe event.created, unix seconds) is provided, the
// UPDATE is made conditional on organizations.stripe_event_created being NULL
// or <= eventCreated, and stamps the new value. Postgres serializes the two
// UPDATEs on the row lock and the stale one matches zero rows, so the newest
// event always wins regardless of arrival order. `applied: false` means the
// write was skipped as stale — callers should not act on the event further.
// Callers without an event (checkout-complete return path, cancel/change-plan
// direct sync) omit it and keep today's unguarded write.
export async function applySubscriptionToOrg(
  admin: SupabaseClient,
  orgId: string,
  subscription: Stripe.Subscription,
  opts?: { deleted?: boolean; eventCreated?: number }
): Promise<{ tier: SubscriptionTier; paymentState: string | null; applied: boolean }> {
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : (subscription.customer?.id ?? null)

  // ALT-687 — a subscription now carries a BASE item plus up to two add-on items (locations,
  // competitors) whose Stripe `quantity` is what the customer bought. This used to read
  // `items.data[0]` and assume it was the plan, which silently ignores every add-on and, worse,
  // would read an add-on as the plan if Stripe ever ordered the items differently.
  //
  // Find the base by asking which price resolves to a tier. Fall back to item 0 so a subscription
  // with an unrecognised price behaves exactly as before (the tier-preservation branch below).
  const items = subscription.items.data
  const baseItem = items.find((i) => resolvePriceInfo(i.price?.id) !== null) ?? items[0]
  const priceId = baseItem?.price?.id ?? null
  const priceInfo = resolvePriceInfo(priceId)

  // Sum add-on quantities by kind. Everything that is not a recognised add-on price contributes
  // nothing, so before the add-on prices exist in Stripe every item resolves to null, both
  // quantities are 0, and the effective caps equal the included allowances. That is what makes
  // this safe to ship ahead of ALT-670.
  let locationsPurchased = 0
  let competitorsPurchased = 0
  for (const item of items) {
    const addOn = resolveAddOnPriceInfo(item.price?.id)
    if (!addOn) continue
    const qty = typeof item.quantity === "number" && Number.isFinite(item.quantity)
      ? Math.max(0, Math.floor(item.quantity))
      : 0
    if (addOn.kind === "location") locationsPurchased += qty
    else competitorsPurchased += qty
  }

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

  // ALT-753 half B: a subscription carrying add-on items but NO recognised base price is not a
  // valid shape. An add-on supplements a plan; it cannot be the plan. The way this happens is a
  // portal allow-list that offers an add-on price as a plan-switch target, so the customer swaps
  // their $299 base for an $18 add-on and lands here: `resolvePriceInfo` returns null, the branch
  // above preserves their tier, and they keep full Standard for $18.
  //
  // The script that built such an allow-list is fixed (#298), but the LIVE portal config cannot be
  // read back with a restricted key, so whether it is already wrong is unverifiable. That is
  // ALT-698. This is the detector for the window in between.
  //
  // Deliberately an ALERT and not a correction, same as the industry mismatch below. The two causes
  // are indistinguishable from here: this shape, or base-price env vars that have simply drifted out
  // of sync while the add-on ones are current. Zeroing the quantities would take away capacity a
  // real customer paid for, and stomping the tier would cut off a paying account. Both fail toward
  // harming someone who did nothing wrong, so this preserves state and shouts instead.
  if (!opts?.deleted && !priceInfo && (locationsPurchased > 0 || competitorsPurchased > 0)) {
    console.error(
      `[stripe] ADD-ON WITHOUT A BASE PLAN org=${orgId} sub=${subscription.id} price=${priceId} ` +
        `locations=${locationsPurchased} competitors=${competitorsPurchased} tier preserved as ${tier}; ` +
        `CHECK THE PORTAL ALLOW-LIST (ALT-698) AND THIS SUBSCRIPTION'S ITEMS`,
    )
  }

  // SEC-Low L3: a price that resolves but belongs to a DIFFERENT industry than the org is a
  // mis-provisioned checkout. Accept it (never black-hole a real payment), but ALERT so ops can
  // review — otherwise the wrong tier is granted silently.
  if (!opts?.deleted && priceId && priceInfo) {
    const { data: orgRow } = await admin
      .from("organizations")
      .select("industry_type")
      .eq("id", orgId)
      .maybeSingle()
    const orgIndustry = orgRow?.industry_type
    if (orgIndustry && !priceBelongsToIndustry(priceId, orgIndustry as IndustryType)) {
      console.error(
        `[stripe] price/industry MISMATCH org=${orgId} price=${priceId} priceIndustry=${priceInfo.industry} orgIndustry=${orgIndustry} — accepted (tier=${tier}); FLAG FOR OPS REVIEW`,
      )
    }
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
    // ALT-687. On 'deleted' both park at 0: a cancelled subscription entitles nobody to add-ons,
    // and payment_state 'canceled' is what blocks access anyway.
    locations_purchased: opts?.deleted ? 0 : locationsPurchased,
    competitors_purchased: opts?.deleted ? 0 : competitorsPurchased,
    cancel_at_period_end: subscription.cancel_at_period_end ?? false,
    trial_ends_at: trialEndIso,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
  }
  if (paymentState !== null) updates.payment_state = paymentState

  if (typeof opts?.eventCreated === "number") {
    updates.stripe_event_created = opts.eventCreated
    const { data, error } = await admin
      .from("organizations")
      .update(updates)
      .eq("id", orgId)
      .or(
        `stripe_event_created.is.null,stripe_event_created.lte.${opts.eventCreated}`
      )
      .select("id")
    if (error) {
      // Throw so the webhook returns 500 and Stripe retries — a swallowed
      // error here would silently drop an access-gating billing update.
      throw new Error(
        `applySubscriptionToOrg: guarded update failed for org ${orgId}: ${error.message}`
      )
    }
    return { tier, paymentState, applied: (data?.length ?? 0) > 0 }
  }

  await admin.from("organizations").update(updates).eq("id", orgId)

  return { tier, paymentState, applied: true }
}
