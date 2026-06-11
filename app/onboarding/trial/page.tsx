import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import { isTrialActive } from "@/lib/billing/trial"
import {
  TIER_LIMITS,
  TIER_PRICING,
  getTierDisplayName,
} from "@/lib/billing/tiers"
import { isValidIndustryType, type IndustryType } from "@/lib/verticals"
import { BrandProvider } from "@/components/brand-provider"
import StartTrialButton from "./start-trial-button"
import "../onboarding.css"

// The card step of onboarding. The wizard's processing step lands here once
// the org/location/competitors are persisted; the trial itself starts at
// Stripe checkout (mid tier, 14 days, card required) — until then the org has
// no trial clock and no recurring pulls. Honest copy: $0 today, the exact
// charge amount and date, day 10 + 13 reminders, cancel anytime.

export default async function TrialPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  if (!profile?.current_organization_id) {
    redirect("/onboarding")
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("name, industry_type, subscription_tier, payment_state, trial_ends_at")
    .eq("id", profile.current_organization_id)
    .maybeSingle()

  if (!org) {
    redirect("/onboarding")
  }

  // Already carded (trialing/active/dunning) or on a legacy clock trial —
  // nothing to collect here.
  if (
    isTrialActive({
      trial_ends_at: org.trial_ends_at,
      subscription_tier: org.subscription_tier,
      payment_state: org.payment_state,
    })
  ) {
    redirect("/home")
  }

  const industry: IndustryType = isValidIndustryType(org.industry_type)
    ? org.industry_type
    : "restaurant"
  const brand = industry === "liquor_store" ? "Neat" : "Ticket"
  const dataBrand = industry === "liquor_store" ? "neat" : "ticket"
  const midName = getTierDisplayName("mid", industry)
  const midLimits = TIER_LIMITS.mid
  const monthly = TIER_PRICING.mid.monthly

  const chargeDate = new Date(Date.now() + 14 * 86_400_000).toLocaleDateString(
    "en-US",
    { month: "long", day: "numeric" }
  )

  const canceled = params.canceled === "1"
  const error = typeof params.error === "string" ? params.error : null

  return (
    <BrandProvider brand={dataBrand}>
      <div className="ob">
        <div className="ob-top">
          <span className="ob-brand">{brand.toUpperCase()}</span>
          <span className="ob-steplabel">Final step</span>
        </div>
        <div className="ob-progress">
          {Array.from({ length: 5 }).map((_, i) => (
            <i key={i} className={i < 4 ? "done" : "current"} />
          ))}
        </div>

        <div className="ob-card">
          <span className="ob-kicker">14 days free · card required</span>
          <h1 className="ob-h">Start your free trial of {midName}.</h1>
          <p className="ob-sub">
            Your trial runs on the {midName} tier — the full intelligence loop:
            a daily brief, up to {midLimits.maxCompetitorsPerLocation} competitors,
            and Instagram, Facebook, and TikTok coverage.
          </p>

          {canceled ? (
            <div className="ob-alert">
              No charge was made. Your setup is saved — start the trial whenever
              you&apos;re ready.
            </div>
          ) : null}
          {error ? (
            <div className="ob-alert">
              We couldn&apos;t confirm that checkout. No worries — your setup is
              saved. Try again below.
            </div>
          ) : null}

          <ul className="ob-trialfacts">
            <li>
              <strong>$0 today.</strong> Your card isn&apos;t charged until the
              trial ends.
            </li>
            <li>
              <strong>${monthly}/mo after {chargeDate}</strong> unless you cancel
              first.
            </li>
            <li>
              <strong>We&apos;ll remind you</strong> by email on day 10 and day 13
              — no surprise charges.
            </li>
            <li>
              <strong>Cancel anytime</strong> from Settings → Billing. One click,
              no phone calls.
            </li>
          </ul>

          <StartTrialButton />
        </div>
      </div>
    </BrandProvider>
  )
}
