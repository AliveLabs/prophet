"use client"

import { motion } from "framer-motion"

const CHECK_ICON = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="mt-0.5 shrink-0 text-vatic-indigo">
    <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const TIERS = [
  {
    name: "Starter",
    features: [
      "3 locations",
      "15 competitors per location",
      "Weekly intelligence refresh",
      "Core signals (reviews, menus, SEO)",
      "Email intelligence briefings",
    ],
    price: "Early access pricing coming soon",
    highlight: false,
  },
  {
    name: "Pro",
    features: [
      "10 locations",
      "50 competitors per location",
      "Daily intelligence refresh",
      "All signals including social & events",
      "Priority briefings with AI narrative",
      "Kanban board & insight workflow",
    ],
    price: "Early access pricing coming soon",
    highlight: true,
  },
  {
    name: "Agency",
    features: [
      "50 locations",
      "200 competitors per location",
      "Daily refresh with priority processing",
      "Full API access",
      "White-label ready",
      "Dedicated data analyst",
    ],
    price: "Contact us",
    highlight: false,
  },
]

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const } },
}

export function PricingSection() {
  return (
    <section id="pricing" className="py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={fadeUp}
          className="mb-20 text-center"
        >
          <h2 className="font-display text-tight text-5xl text-foreground md:text-6xl">
            <em className="italic">Plans</em> that scale with your set.
          </h2>
          <p className="mt-4 text-muted-foreground">
            From your first location to a fifty-unit operation. Same feed, same confidence scoring.
          </p>
        </motion.div>

        <div className="grid gap-8 lg:grid-cols-3">
          {TIERS.map((tier, i) => (
            <motion.div
              key={tier.name}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: i * 0.1 }}
              variants={fadeUp}
              className={`relative flex flex-col rounded-xl p-10 ${
                tier.highlight
                  ? "animate-glow-pulse border-t-4 border-vatic-indigo bg-card editorial-shadow"
                  : "border border-border/50 bg-card"
              }`}
            >
              {tier.highlight && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-vatic-indigo px-4 py-1 text-[10px] font-bold uppercase tracking-widest text-white">
                  Recommended
                </div>
              )}

              <h3 className="text-xl font-bold text-foreground">{tier.name}</h3>

              <p className="mt-4 text-sm text-muted-foreground">{tier.price}</p>

              <ul className="mt-8 flex-1 space-y-4">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                    {CHECK_ICON}
                    {f}
                  </li>
                ))}
              </ul>

              <a
                href="#waitlist"
                className={`mt-8 block rounded-md px-4 py-4 text-center text-sm font-bold transition-all ${
                  tier.highlight
                    ? "vatic-gradient text-white hover:scale-[0.98]"
                    : "border border-border text-foreground hover:bg-muted/50"
                }`}
              >
                {tier.name === "Agency" ? "Contact Sales" : "Request Early Access"}
              </a>
            </motion.div>
          ))}
        </div>

        <p className="mt-12 text-center text-sm text-muted-foreground">
          Request early access to lock in launch pricing. No credit card required.
        </p>
      </div>
    </section>
  )
}
