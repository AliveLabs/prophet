// Billing — REBUILT to The Pass. All render-state logic (payment_state × trial clock),
// the Stripe checkout/portal wiring, the dunning banner, and the tier/price source of
// truth are UNCHANGED. The presentation is re-authored to the kit: a prominent
// current-plan soft panel + premium pricing tiles (recommended-tier highlight + cadence
// toggle) via the page-local islands.

import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getTrialDaysRemaining } from "@/lib/billing/trial"
import {
  asSubscriptionTier,
  getTierDisplayName,
  TIER_PRICING,
} from "@/lib/billing/tiers"
import { getVerticalConfig, isValidIndustryType, type IndustryType } from "@/lib/verticals"
import { resolvePriceInfo } from "@/lib/stripe/pricing"
import { DunningBanner } from "@/components/billing/dunning-banner"
import {
  RevealOnView,
  TkSectionHead,
  TkSoftPanel,
  TkChip,
} from "@/components/ticket"
import { UpgradeSuccessToast } from "./upgrade-success"
import { UpgradeTilesPass } from "./upgrade-tiles-pass"
import { PlanChangeTilesPass } from "./plan-change-tiles-pass"
import { CancelSubscriptionPass } from "./cancel-subscription-pass"
import { UpdateCardPass } from "./update-card-pass"
import "../settings-pass.css"

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
          "subscription_tier, billing_email, trial_started_at, trial_ends_at, industry_type, payment_state, current_period_end, cancel_at_period_end, stripe_customer_id, stripe_price_id"
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
  const noStripe = !paymentState && !isSuspended
  const isLegacyTrial = noStripe && daysRemaining > 0
  const hasCustomer = Boolean(organization?.stripe_customer_id)
  const priceInfo = resolvePriceInfo(organization?.stripe_price_id)
  // Plan changes/cancel only make sense once there's a live subscription to
  // mutate in place — trialing counts (Stripe already has the subscription),
  // past_due does not (Stripe blocks subscription updates on a failed sub).
  const canManageInApp = (isActive || isTrialing) && tier !== "suspended"

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
  const statusAlert = isPastDue || isSuspended

  return (
    <div className="pv-page">
      {upgraded && <UpgradeSuccessToast />}
      <div className="pv-page-head">
        <span className="pv-kicker">Account</span>
        <h1 className="pv-h1">Billing</h1>
        <p className="pv-sub">
          Your plan, what it costs, and where it stands. Cancel or change it anytime —
          no phone calls, no hoops.
        </p>
      </div>

      <div className="tk-kit tk-set">
        {isPastDue && (
          <div className="tk-set-block" style={{ marginTop: 22 }}>
            <DunningBanner brand={brand as "Ticket" | "Neat"} />
          </div>
        )}

        {/* ── CURRENT PLAN ── */}
        <RevealOnView className="tk-set-block">
          <TkSectionHead title="Current plan" sub="Where your subscription stands" />
          <TkSoftPanel>
            <div className="tk-set-fields">
              <div className="tk-set-field">
                <div className="tk-set-flbl">Plan</div>
                <div className="tk-set-fval">
                  <div className="tk-set-row-actions">
                    <span className="tk-set-fval-strong">{getTierDisplayName(tier, industry)}</span>
                    {(isTrialing || isLegacyTrial) && <TkChip family="social">Trial</TkChip>}
                    {isLegacyTrial && <TkChip family="reputation">No card on file</TkChip>}
                  </div>
                  {tier !== "suspended" && <PriceLabel tier={tier} />}
                </div>
              </div>
              <div className="tk-set-field">
                <div className="tk-set-flbl">Status</div>
                <div className="tk-set-fval">
                  <span className={`tk-set-statusline${statusAlert ? " tk-set-alert" : ""}`}>{statusLine}</span>
                </div>
              </div>
              {organization?.billing_email && (
                <div className="tk-set-field">
                  <div className="tk-set-flbl">Billed to</div>
                  <div className="tk-set-fval">
                    <span className="tk-set-fval-strong">{organization.billing_email}</span>
                    {!noStripe && !isSuspended && <span className="tk-set-hint">via Stripe</span>}
                  </div>
                </div>
              )}
              {hasCustomer && !isSuspended && (
                <div className="tk-set-field">
                  <div className="tk-set-flbl">Payment</div>
                  <div className="tk-set-fval">
                    <div className="tk-set-row-actions">
                      <UpdateCardPass />
                    </div>
                    <p className="tk-set-hint">
                      Your card is tokenized by Stripe — we can&rsquo;t see or update it
                      directly, so this opens a Stripe form scoped to just your card.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </TkSoftPanel>
        </RevealOnView>

        {/* ── CHANGE PLAN (in-app, ALT-228) ── */}
        {canManageInApp && (
          <RevealOnView className="tk-set-block">
            <TkSectionHead
              title="Change plan"
              sub="Upgrade, downgrade, or switch billing cadence — takes effect immediately, prorated by Stripe."
            />
            <PlanChangeTilesPass
              industry={industry}
              currentTier={tier}
              currentCadence={priceInfo?.cadence ?? null}
            />
          </RevealOnView>
        )}

        {/* ── CANCEL / RESUME (in-app, ALT-228) ── */}
        {canManageInApp && (
          <RevealOnView className="tk-set-block">
            <TkSectionHead title="Cancel" sub="No phone calls, no hoops — cancel or resume anytime" />
            <TkSoftPanel>
              <CancelSubscriptionPass cancelAtPeriodEnd={Boolean(organization?.cancel_at_period_end)} />
            </TkSoftPanel>
          </RevealOnView>
        )}

        {/* ── CHOOSE / RESUBSCRIBE ── */}
        {(noStripe || isCanceled) && (
          <RevealOnView className="tk-set-block">
            <TkSectionHead
              title={isCanceled ? "Resubscribe" : "Choose your plan"}
              sub="More competitors, daily intelligence, more locations as you grow."
            />
            <UpgradeTilesPass industry={industry} />
          </RevealOnView>
        )}
      </div>
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
    <span className="tk-set-hint">
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
