"use client"

import { LpReveal, stIdx } from "./landing-shared"

const CHECK = (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const TIERS = [
  {
    name: "Starter",
    price: "Early-access pricing soon",
    highlight: false,
    cta: "Request early access",
    features: [
      "3 locations",
      "15 competitors per location",
      "Weekly intelligence refresh",
      "Core signals (reviews, menus, search)",
      "Email intelligence briefings",
    ],
  },
  {
    name: "Pro",
    price: "Early-access pricing soon",
    highlight: true,
    cta: "Request early access",
    features: [
      "10 locations",
      "50 competitors per location",
      "Daily intelligence refresh",
      "All signals incl. social & events",
      "Priority briefings with AI narrative",
      "Board & insight workflow",
    ],
  },
  {
    name: "Agency",
    price: "Contact us",
    highlight: false,
    cta: "Contact sales",
    features: [
      "50 locations",
      "200 competitors per location",
      "Daily refresh, priority processing",
      "Full API access",
      "White-label ready",
      "Dedicated data analyst",
    ],
  },
]

export function PassPricing() {
  return (
    <section id="pricing" className="lp-section">
      <div className="lp-wrap">
        <LpReveal className="lp-section-head" as="div">
          <span className="lp-eyebrow">Pricing</span>
          <h2 className="lp-h2">
            <span className="lp-flourish">Plans</span> that scale with your set.
          </h2>
          <p className="lp-sub">
            From your first location to a fifty-unit operation. Same feed, same confidence
            scoring.
          </p>
        </LpReveal>

        <LpReveal className="lp-tiers" as="div" stagger>
          {TIERS.map((t, i) => (
            <div
              key={t.name}
              className={`lp-tier${t.highlight ? " lp-tier-feature" : ""}`}
              style={stIdx(i)}
            >
              {t.highlight && <span className="lp-tier-badge">Recommended</span>}
              <h3>{t.name}</h3>
              <p className="lp-tier-price">{t.price}</p>
              <div className="lp-tier-list">
                {t.features.map((f) => (
                  <div key={f} className="lp-tier-feat">
                    {CHECK}
                    <span>{f}</span>
                  </div>
                ))}
              </div>
              <a
                href="#waitlist"
                className={`lp-cta ${t.highlight ? "lp-cta-primary" : "lp-cta-ghost"}`}
              >
                {t.cta}
              </a>
            </div>
          ))}
        </LpReveal>

        <p className="lp-pricing-note">
          Request early access to lock in launch pricing. No credit card required.
        </p>
      </div>
    </section>
  )
}
