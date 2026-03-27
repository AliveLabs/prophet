"use client"

import { motion } from "framer-motion"

const TIERS = [
  {
    name: "Starter",
    features: [
      "3 locations",
      "15 competitors per location",
      "Weekly intelligence refresh",
      "Core signals (reviews, menus, SEO)",
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
      "All signals including social and events",
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
      "White-label ready",
    ],
    price: "Contact us",
    highlight: false,
  },
]

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
}

export function PricingSection() {
  return (
    <section id="pricing" className="border-t border-border/50 py-24">
      <div className="mx-auto max-w-6xl px-6">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          variants={fadeUp}
          className="mb-16 text-center"
        >
          <p className="mb-4 text-sm font-semibold uppercase tracking-widest text-precision-teal">
            Pricing
          </p>
          <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
            Simple plans. No per-seat pricing.
          </h2>
        </motion.div>

        <div className="grid gap-6 md:grid-cols-3">
          {TIERS.map((tier, i) => (
            <motion.div
              key={tier.name}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-60px" }}
              transition={{
                duration: 0.5,
                delay: i * 0.1,
                ease: [0.16, 1, 0.3, 1],
              }}
              variants={fadeUp}
              className={`flex flex-col rounded-xl border p-6 ${
                tier.highlight
                  ? "pricing-highlight border-vatic-indigo"
                  : "border-border"
              } bg-card`}
            >
              {tier.highlight && (
                <span className="mb-3 inline-block self-start rounded-md bg-vatic-indigo px-2.5 py-0.5 text-xs font-semibold text-white">
                  Recommended
                </span>
              )}
              <h3 className="text-xl font-semibold text-foreground">
                {tier.name}
              </h3>
              <ul className="mt-5 flex-1 space-y-3">
                {tier.features.map((f) => (
                  <li
                    key={f}
                    className="flex items-start gap-2 text-sm text-muted-foreground"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      className="mt-0.5 shrink-0 text-precision-teal"
                    >
                      <path
                        d="M3 8.5l3 3 7-7"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-sm font-medium text-muted-foreground">
                {tier.price}
              </p>
              <a
                href="#waitlist"
                className={`mt-4 block rounded-lg px-4 py-2.5 text-center text-sm font-semibold transition-opacity hover:opacity-90 ${
                  tier.highlight
                    ? "bg-precision-teal text-white"
                    : "bg-secondary text-foreground"
                }`}
              >
                Join the Waitlist
              </a>
            </motion.div>
          ))}
        </div>

        <p className="mt-10 text-center text-sm text-muted-foreground">
          Join the waitlist to lock in early access pricing.
        </p>
      </div>
    </section>
  )
}
