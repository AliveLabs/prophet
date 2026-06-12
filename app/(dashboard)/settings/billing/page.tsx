import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getTrialDaysRemaining } from "@/lib/billing/trial"
import {
  asSubscriptionTier,
  getTierDisplayName,
  TIER_PRICING,
} from "@/lib/billing/tiers"
import { getVerticalConfig, isValidIndustryType, type IndustryType } from "@/lib/verticals"
import { UpgradeButtons } from "./upgrade-buttons"
import { UpgradeSuccessToast } from "./upgrade-success"
import { DunningBanner } from "@/components/billing/dunning-banner"
import { ManageBillingButton } from "./manage-billing-button"

// Render states based on (payment_state, trial clock) — there is no free tier:
//
//   null payment_state + live trial clock  -> legacy card-less trial: countdown
//                                             + "no card on file" + plan tiles
//   null payment_state, no/expired clock   -> "No subscription" + plan tiles
//   trialing                               -> "Trial" card + countdown + Manage billing
//   active                                 -> "Active" card + renewal date + Manage billing
//   past_due                               -> "Past due" card with DunningBanner call-out
//   canceled | incomplete_expired          -> "Canceled" card + Resubscribe tiles
//   suspended                              -> Admin-suspended message

export default async function BillingPage({
  searchParams,
}: {
  searchParams?: Promise<{ upgraded?: string }>
}) {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()
  const params = await Promise.resolve(searchParams)
  const upgraded = params?.upgraded === "true"

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  const organizationId = profile?.current_organization_id
  const { data: organization } = organizationId
    ? await supabase
        .from("organizations")
        .select(
          "subscription_tier, billing_email, trial_started_at, trial_ends_at, industry_type, payment_state, current_period_end, cancel_at_period_end, stripe_customer_id"
        )
        .eq("id", organizationId)
        .single()
    : { data: null }

  const tier = asSubscriptionTier(organization?.subscription_tier)
  const industry: IndustryType = isValidIndustryType(organization?.industry_type)
    ? organization.industry_type
    : "restaurant"
  const brand = getVerticalConfig(industry).brand.displayName
  const paymentState = organization?.payment_state ?? null
  const daysRemaining = organization
    ? getTrialDaysRemaining({ trial_ends_at: organization.trial_ends_at })
    : 0

  const isTrialing = paymentState === "trialing"
  const isActive = paymentState === "active"
  const isPastDue = paymentState === "past_due"
  const isCanceled =
    paymentState === "canceled" || paymentState === "incomplete_expired"
  const isSuspended = tier === "suspended"
  // Never been through Stripe checkout: either a legacy card-less trial
  // (internal clock still running) or no subscription at all.
  const noStripe = !paymentState && !isSuspended
  const isLegacyTrial = noStripe && daysRemaining > 0
  const hasCustomer = Boolean(organization?.stripe_customer_id)

  const statusLine =
    isTrialing || isLegacyTrial
      ? `Trial · ${daysRemaining} ${daysRemaining === 1 ? "day" : "days"} remaining`
      : isActive
        ? organization?.cancel_at_period_end
          ? `Cancels on ${formatDate(organization.current_period_end)}`
          : `Renews ${formatDate(organization?.current_period_end)}`
        : isPastDue
          ? "Past due — update payment"
          : isCanceled
            ? "Canceled"
            : isSuspended
              ? "Suspended"
              : "No active subscription"
  const statusTone = isPastDue || isSuspended ? "var(--alert)" : "var(--ink)"

  return (
    <div className="pv-page">
      {upgraded && <UpgradeSuccessToast />}
      <div className="pv-page-head">
        <span className="pv-kicker">Account</span>
        <h1 className="pv-h1">Billing</h1>
        <p className="pv-sub">
          Your plan, what it costs, and where it stands. Cancel or change it
          anytime — no phone calls, no hoops.
        </p>
      </div>
      <hr className="pv-rule" />

      {isPastDue && (
        <div className="pv-section">
          <DunningBanner brand={brand as "Ticket" | "Neat"} />
        </div>
      )}

      <div className="pv-section">
        <div className="pv-section-head">Current plan</div>
        <div className="pv-card">
          <div className="pv-field">
            <div className="pv-field__label">Plan</div>
            <div className="pv-field__val">
              {getTierDisplayName(tier, industry)}
              {(isTrialing || isLegacyTrial) && (
                <span className="pv-pill pv-pill--watch" style={{ marginLeft: 10 }}>
                  Trial
                </span>
              )}
              {isLegacyTrial && (
                <span className="pv-pill pv-pill--threat" style={{ marginLeft: 6 }}>
                  No card on file
                </span>
              )}
              {tier !== "suspended" && (
                <div className="pv-field__hint">
                  <PriceLabel tier={tier} />
                </div>
              )}
            </div>
          </div>
          <div className="pv-field">
            <div className="pv-field__label">Status</div>
            <div className="pv-field__val" style={{ color: statusTone }}>
              {statusLine}
            </div>
          </div>
          {organization?.billing_email && (
            <div className="pv-field">
              <div className="pv-field__label">Billed to</div>
              <div className="pv-field__val">
                {organization.billing_email}
                {!noStripe && !isSuspended && (
                  <div className="pv-field__hint">via Stripe</div>
                )}
              </div>
            </div>
          )}
          {hasCustomer && !isSuspended && (
            <div className="pv-field">
              <div className="pv-field__label">Payment</div>
              <div className="pv-field__val">
                <ManageBillingButton />
                <div className="pv-field__hint">
                  Update your card, switch plans, or cancel in the Stripe portal.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {(noStripe || isCanceled) && (
        <div className="pv-section">
          <div className="pv-section-head">
            {isCanceled ? "Resubscribe" : "Choose your plan"}
            <span className="pv-section-sub">
              More competitors, daily intelligence, more locations as you grow.
            </span>
          </div>
          <UpgradeButtons industry={industry} />
        </div>
      )}
    </div>
  )
}

function PriceLabel({
  tier,
}: {
  tier: Exclude<ReturnType<typeof asSubscriptionTier>, "suspended">
}) {
  const pricing = TIER_PRICING[tier]
  return (
    <span>
      From ${pricing.annualEffectiveMonthly}/mo annual · ${pricing.monthly}/mo monthly
    </span>
  )
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}
