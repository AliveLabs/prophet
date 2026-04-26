import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getTrialDaysRemaining } from "@/lib/billing/trial"
import {
  asSubscriptionTier,
  getTierDisplayName,
  TIER_PRICING,
} from "@/lib/billing/tiers"
import { getVerticalConfig, isValidIndustryType, type IndustryType } from "@/lib/verticals"
import { Badge } from "@/components/ui/badge"
import { UpgradeButtons } from "./upgrade-buttons"
import { UpgradeSuccessToast } from "./upgrade-success"
import { DunningBanner } from "@/components/billing/dunning-banner"
import { ManageBillingButton } from "./manage-billing-button"

// Four render states based on (subscription_tier, payment_state):
//
//   free / null           -> "No subscription" + upgrade tiles
//   entry|mid|top /
//     trialing             -> "Trialing" card + countdown + Manage billing
//     active               -> "Active" card + renewal date + Manage billing
//     past_due             -> "Past due" card with DunningBanner call-out
//     canceled |
//     incomplete_expired  -> "Canceled" card + Resubscribe tiles
//   suspended              -> Admin-suspended message

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

  const tier = asSubscriptionTier(organization?.subscription_tier ?? "free")
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
  const isFree = tier === "free" && !paymentState
  const isSuspended = tier === "suspended"
  const hasCustomer = Boolean(organization?.stripe_customer_id)

  return (
    <section className="space-y-5">
      {upgraded && <UpgradeSuccessToast />}
      {isPastDue && <DunningBanner brand={brand as "Ticket" | "Neat"} />}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-3">
          <span className="text-[12.5px] font-semibold text-foreground">
            Billing
          </span>
        </div>
        <div className="p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-secondary px-4 py-4">
              <p className="text-[11.5px] font-medium text-muted-foreground">
                Current plan
              </p>
              <p className="mt-2 font-display text-[28px] font-semibold leading-none tracking-tight text-foreground">
                {getTierDisplayName(tier, industry)}
              </p>
              {tier !== "free" && tier !== "suspended" && (
                <PriceLabel tier={tier} />
              )}
            </div>
            <div className="rounded-lg border border-border bg-secondary px-4 py-4">
              <p className="text-[11.5px] font-medium text-muted-foreground">
                Status
              </p>
              {isTrialing ? (
                <p className="mt-2 text-[15px] font-semibold text-foreground">
                  Trial · {daysRemaining}{" "}
                  {daysRemaining === 1 ? "day" : "days"} remaining
                </p>
              ) : isActive ? (
                <p className="mt-2 text-[15px] font-semibold text-foreground">
                  {organization?.cancel_at_period_end
                    ? `Cancels on ${formatDate(organization.current_period_end)}`
                    : `Renews ${formatDate(organization?.current_period_end)}`}
                </p>
              ) : isPastDue ? (
                <p className="mt-2 text-[15px] font-semibold text-destructive">
                  Past due — update payment
                </p>
              ) : isCanceled ? (
                <p className="mt-2 text-[15px] font-semibold text-muted-foreground">
                  Canceled
                </p>
              ) : isSuspended ? (
                <p className="mt-2 text-[15px] font-semibold text-destructive">
                  Suspended
                </p>
              ) : (
                <p className="mt-2 text-[15px] font-semibold text-foreground">
                  No active subscription
                </p>
              )}
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {!isFree && !isSuspended && (
              <Badge
                variant="default"
                className="border-border text-muted-foreground"
              >
                Stripe connected
              </Badge>
            )}
            {isFree && (
              <Badge
                variant="default"
                className="border-border text-muted-foreground"
              >
                Free tier
              </Badge>
            )}
            {organization?.billing_email && (
              <span className="text-[11.5px] text-muted-foreground">
                Billed to {organization.billing_email}
              </span>
            )}
            {hasCustomer && !isSuspended && <ManageBillingButton />}
          </div>
        </div>
      </div>

      {(isFree || isCanceled) && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-3">
            <span className="text-[12.5px] font-semibold text-foreground">
              {isCanceled ? "Resubscribe" : "Upgrade your plan"}
            </span>
          </div>
          <div className="p-5">
            <p className="mb-5 text-sm text-muted-foreground">
              Unlock more locations, competitors, and daily intelligence
              refreshes.
            </p>
            <UpgradeButtons industry={industry} />
          </div>
        </div>
      )}
    </section>
  )
}

function PriceLabel({
  tier,
}: {
  tier: Exclude<ReturnType<typeof asSubscriptionTier>, "free" | "suspended">
}) {
  const pricing = TIER_PRICING[tier]
  return (
    <p className="mt-1 text-[11.5px] text-muted-foreground">
      From ${pricing.annualEffectiveMonthly}/mo annual · ${pricing.monthly}/mo
      monthly
    </p>
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
