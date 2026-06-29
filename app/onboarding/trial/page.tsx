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
//
// "The Pass" rebuild: rendered into the pearlescent SPLIT layout — a canvas
// rail (brand + headline + trial value) beside a floating panel that carries
// the facts + the rust-gradient checkout CTA. Stripe wiring unchanged.

// Computed outside render so the impure Date.now() read isn't called during
// the component body. Returns the post-trial charge date (today + 14 days)
// formatted as e.g. "July 7".
function computeChargeDate() {
  return new Date(Date.now() + 14 * 86_400_000).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  })
}

const IconBrandT = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 6h14M12 6v12" />
  </svg>
)
const IconCheck = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
)
const IconAlert = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
  </svg>
)
const IconShield = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z" />
  </svg>
)

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

  const chargeDate = computeChargeDate()

  const canceled = params.canceled === "1"
  const error = typeof params.error === "string" ? params.error : null

  return (
    <BrandProvider brand={dataBrand}>
      <div className="ob">
        <div className="ob-canvas" aria-hidden="true" />

        {/* MOBILE glass top bar */}
        <header className="ob-topbar">
          <span className="ob-brand">
            <span className="ob-mark"><IconBrandT /></span>
            <span className="ob-wordmark">{brand}</span>
          </span>
          <span className="ob-steplabel">Final step</span>
        </header>

        <div className="ob-split">
          {/* LEFT — pearlescent rail */}
          <aside className="ob-rail">
            <div className="ob-rail-head">
              <span className="ob-brand">
                <span className="ob-mark"><IconBrandT /></span>
                <span className="ob-wordmark">{brand}</span>
              </span>
              <div>
                <span className="ob-kicker">14 days free</span>
                <h1 className="ob-h">
                  Start your free trial of <em>{midName}.</em>
                </h1>
                <p className="ob-sub">
                  Your trial runs on the full intelligence loop: a daily brief,
                  up to {midLimits.maxCompetitorsPerLocation} competitors, and
                  Instagram, Facebook, and TikTok coverage.
                </p>
              </div>
            </div>

            <div className="ob-accent">
              <span className="ob-accent-ic"><IconShield /></span>
              <div className="ob-accent-body">
                <h5>$0 today</h5>
                <p>Card required to start — we won&apos;t charge until your trial ends, and we&apos;ll remind you first.</p>
              </div>
            </div>
          </aside>

          {/* RIGHT — floating panel */}
          <main className="ob-stage">
            <section className="ob-panel">
              <div className="ob-mobile-head">
                <span className="ob-kicker">14 days free</span>
                <h1 className="ob-h">Start your free trial of <em>{midName}.</em></h1>
                <p className="ob-sub">
                  The full intelligence loop: a daily brief, up to{" "}
                  {midLimits.maxCompetitorsPerLocation} competitors, and social coverage.
                </p>
              </div>

              <span className="ob-panel-eyebrow">Card required · cancel anytime</span>
              <h2 className="ob-panel-title">Here&apos;s exactly what happens</h2>

              {canceled ? (
                <div className="ob-alert">
                  <IconAlert />
                  No charge was made. Your setup is saved — start the trial
                  whenever you&apos;re ready.
                </div>
              ) : null}
              {error ? (
                <div className="ob-alert">
                  <IconAlert />
                  We couldn&apos;t confirm that checkout. No worries — your setup
                  is saved. Try again below.
                </div>
              ) : null}

              <ul className="ob-trialfacts">
                <li>
                  <IconCheck />
                  <span><strong>$0 today.</strong> Your card isn&apos;t charged until the trial ends.</span>
                </li>
                <li>
                  <IconCheck />
                  <span><strong>${monthly}/mo after {chargeDate}</strong> unless you cancel first.</span>
                </li>
                <li>
                  <IconCheck />
                  <span><strong>We&apos;ll remind you</strong> by email on day 10 and day 13 — no surprise charges.</span>
                </li>
                <li>
                  <IconCheck />
                  <span><strong>Cancel anytime</strong> from Settings → Billing. One click, no phone calls.</span>
                </li>
              </ul>

              <StartTrialButton />
            </section>
          </main>
        </div>
      </div>
    </BrandProvider>
  )
}
