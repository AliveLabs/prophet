"use client"

import { LpReveal, stIdx } from "./landing-shared"
import { GENERAL_CONTACT_EMAIL } from "@/lib/support/contact"
import { SELF_SERVE_TIERS } from "@/lib/billing/tiers"
import {
  PRICE_UNIT,
  tierBriefLine,
  tierCompetitorLine,
  tierMonthlyPrice,
  tierName,
} from "@/lib/billing/tier-copy"

// ── ALT-764: the tiles are DERIVED, not typed ────────────────────────────────────────────────
//
// This page used to hardcode three tiles named "Starter", "Pro" and "Agency", claiming 3/15,
// 10/50 and 50/200 locations-to-competitors. Two of those tiers never existed, Standard (the tier
// we actually sell) was missing entirely, and the competitor counts overstated the enforced caps
// by up to 20x. It stayed wrong through the whole tier rename because nothing connected the copy
// to the thing that enforces it.
//
// So the counts and names now come from lib/billing/tiers.ts, which is the same module the
// checkout, the webhook and the cap enforcement read. A tier cannot be advertised here unless it
// is in SELF_SERVE_TIERS, and its numbers cannot disagree with TIER_LIMITS, because there is no
// second copy to disagree with. tests/unit/billing/tier-copy-is-derived.test.ts pins that.
//
// Deriving from SELF_SERVE_TIERS is also what makes the page honest about WHAT IT IS: a list of
// plans you can buy online. Multi-Location is real and priced per location, but it is contract
// only (isSelfServeTier is false for it), so it belongs as a contact line and not as a tile with
// entitlement claims. That matches the pricing page on the marketing site.

const CHECK = (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** Per-tier copy that is NOT derivable from a number. Kept minimal and true to what ships. */
const TIER_COPY: Record<
  "entry" | "mid",
  { for: string; highlight: boolean; badge?: string; cta: string; extras: string[] }
> = {
  entry: {
    for: "For one location finding its footing.",
    highlight: false,
    cta: "Request early access",
    extras: [
      "Menus, prices, reviews and social",
      "Local search visibility",
      "Weather and nearby events",
    ],
  },
  mid: {
    for: "For an operator who wants to move the same week, not the next one.",
    highlight: true,
    badge: "Most popular",
    // NOT "Start free trial", even though Standard is the tier that has one. Both CTAs here
    // point at #waitlist, and a button must say what it does. The marketing site says "Start
    // free trial" because its CTA really does start signup.
    cta: "Request early access",
    extras: [
      "Everything in Starter",
      "Your own social presence tracked too",
      "Invite your managers",
    ],
  },
}

export function PassPricing() {
  const tiers = SELF_SERVE_TIERS.filter(
    (t): t is "entry" | "mid" => t === "entry" || t === "mid",
  )

  return (
    <section id="pricing" className="lp-section">
      <div className="lp-wrap">
        <LpReveal className="lp-section-head" as="div">
          <span className="lp-eyebrow">Pricing</span>
          <h2 className="lp-h2">
            <span className="lp-flourish">Plans</span> that scale with your set.
          </h2>
          <p className="lp-sub">
            Priced per location, so one restaurant or a group pays the same rate per room. Same
            feed, same confidence scoring.
          </p>
        </LpReveal>

        <LpReveal className="lp-tiers" as="div" stagger>
          {tiers.map((tier, i) => {
            const copy = TIER_COPY[tier]
            const features = [tierBriefLine(tier), tierCompetitorLine(tier), ...copy.extras]
            return (
              <div
                key={tier}
                className={`lp-tier${copy.highlight ? " lp-tier-feature" : ""}`}
                style={stIdx(i)}
              >
                {copy.badge && <span className="lp-tier-badge">{copy.badge}</span>}
                <h3>{tierName(tier)}</h3>
                <p className="lp-tier-price">
                  ${tierMonthlyPrice(tier)}
                  <span className="lp-tier-per"> {PRICE_UNIT}</span>
                </p>
                <p className="lp-tier-for">{copy.for}</p>
                <div className="lp-tier-list">
                  {features.map((f) => (
                    <div key={f} className="lp-tier-feat">
                      {CHECK}
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
                <a
                  href="#waitlist"
                  className={`lp-cta ${copy.highlight ? "lp-cta-primary" : "lp-cta-ghost"}`}
                >
                  {copy.cta}
                </a>
              </div>
            )
          })}
        </LpReveal>

        {/* Multi-Location is real but contract only, so it gets a line and no entitlement claims. */}
        <p className="lp-pricing-note">
          Running a group or a chain? Multi-Location is priced per location.{" "}
          <a href={`mailto:${GENERAL_CONTACT_EMAIL}?subject=Multi-Location%20pricing`}>
            Get a quote
          </a>
          .
        </p>
      </div>
    </section>
  )
}
