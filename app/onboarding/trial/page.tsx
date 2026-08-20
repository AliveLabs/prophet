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
import { UpgradeTilesPass } from "@/app/(dashboard)/settings/billing/upgrade-tiles-pass"
import StartTrialButton from "./start-trial-button"
import SkipCardButton from "./skip-card-button"
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
//
// ALT-658: `?pricing=1` renders the PRICING screen on this same route instead of the split
// layout. Same route on purpose — it is what makes the round trip free. The browser back button
// already works (a real navigation), "Keep my free trial" returns here explicitly, and buying a
// tier routes FORWARD, because the tiles pass context="onboarding" and the checkout route
// already sends that to /onboarding/checkout-complete. No new route, no modal, no duplicated
// pricing copy: the tiles derive every name and price from lib/billing/tiers.ts, so the pending
// tier rename lands here automatically rather than needing a second edit.

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
  // ALT-699 — the trial screen states ONE price, and it stated only the monthly one. The annual
  // price is the one we want people on and the one the discount story lives in, so hiding it here
  // makes the product look 20% more expensive than it is at the exact moment somebody decides.
  // This is not the plan PICKER (that is ?pricing=1, which has a cadence toggle); it is the single
  // line telling them what happens when the trial ends, so it names both.
  const monthly = TIER_PRICING.mid.monthly
  const annualMonthly = TIER_PRICING.mid.annualEffectiveMonthly

  const chargeDate = computeChargeDate()

  const canceled = params.canceled === "1"
  const error = typeof params.error === "string" ? params.error : null

  // ── ALT-658: the pricing screen ──────────────────────────────────────────────
  // Its own single-column stage rather than the 480px panel: three tiles do not belong in a
  // column that narrow, and a pricing screen reads better centred anyway.
  if (params.pricing === "1") {
    return (
      <BrandProvider brand={dataBrand}>
        <div className="ob">
          <div className="ob-canvas" aria-hidden="true" />
          <div className="ob-pricing tk-kit">
            <header className="ob-pricing-head">
              <span className="ob-brand">
                <span className="ob-mark"><IconBrandT /></span>
                <span className="ob-wordmark">{brand}</span>
              </span>
              <span className="ob-kicker">Every plan starts free</span>
              <h1 className="ob-h">Pick the plan that fits.</h1>
              <p className="ob-sub">
                {midName} is what your free trial runs on, and it is the one most operators stay on.
                Choosing a plan here starts the same 14-day trial: nothing is charged today.
              </p>
            </header>

            <UpgradeTilesPass industry={industry} context="onboarding" />

            <div className="ob-pricing-exit">
              <a className="ob-pricing-back" href="/onboarding/trial">
                ← Keep my free trial of {midName}
              </a>
              <p className="ob-pricing-note">
                You can change plans any time from Settings → Billing. Nothing here locks you in.
              </p>
            </div>
          </div>
        </div>
      </BrandProvider>
    )
  }

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
                  up to {midLimits.includedCompetitorsPerLocation} competitors, and
                  Instagram, Facebook, and TikTok coverage.
                </p>
              </div>
            </div>

            <div className="ob-accent">
              <span className="ob-accent-ic"><IconShield /></span>
              <div className="ob-accent-body">
                <h5>$0 today</h5>
                <p>Add a card and nothing is charged until your trial ends, and we&apos;ll remind you first. Not ready? Start without one.</p>
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
                  {midLimits.includedCompetitorsPerLocation} competitors, and social coverage.
                </p>
              </div>

              <span className="ob-panel-eyebrow">Card optional · cancel anytime</span>
              <h2 className="ob-panel-title">Here&apos;s exactly what happens</h2>

              {canceled ? (
                <div className="ob-alert">
                  <IconAlert />
                  No charge was made. Your setup is saved, so start the trial
                  whenever you&apos;re ready.
                </div>
              ) : null}
              {error ? (
                <div className="ob-alert">
                  <IconAlert />
                  We couldn&apos;t confirm that checkout. No worries: your setup
                  is saved. Try again below.
                </div>
              ) : null}

              <ul className="ob-trialfacts">
                <li>
                  <IconCheck />
                  {/* ALT-659: was "$0 today. Nothing is charged until your trial ends, and only if
                      you added a card." Bryan: the substance is right, the delivery was over-
                      explained and unpolished. Same promise, said once. */}
                  <span><strong>$0 today.</strong> A card is only charged when the trial ends, and only if you added one.</span>
                </li>
                <li>
                  <IconCheck />
                  <span>
                    <strong>${monthly}/mo after {chargeDate}</strong> unless you cancel first, or{" "}
                    <strong>${annualMonthly}/mo</strong> if you pay annually. That is two months free.
                  </span>
                </li>
                <li>
                  <IconCheck />
                  <span><strong>We&apos;ll remind you</strong> by email on day 10 and day 13, so nothing arrives as a surprise.</span>
                </li>
                <li>
                  <IconCheck />
                  <span><strong>Cancel anytime</strong> from Settings → Billing. One click, no phone calls.</span>
                </li>
              </ul>

              <StartTrialButton />
              <SkipCardButton />

              {/* ALT-658. Directly under the facts, because this is the most willing-to-buy moment
                  an operator will have and until now the screen offered no way to see a price or
                  choose a different plan. */}
              <a className="ob-pricing-link" href="/onboarding/trial?pricing=1">
                View pricing and plans
              </a>
            </section>
          </main>
        </div>
      </div>
    </BrandProvider>
  )
}
