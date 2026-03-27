"use client"

import { motion } from "framer-motion"

const FEATURES = [
  {
    title: "Competitor Monitoring",
    description:
      "Track up to 50 competitors across Google, social media, and their websites. Daily snapshots catch changes the moment they happen.",
    tags: ["Reviews", "Ratings", "Hours", "Attributes"],
  },
  {
    title: "Menu & Pricing Intelligence",
    description:
      "Know when competitors change prices, add items, or launch promotions. Side-by-side menu comparison shows exactly where you stand.",
    tags: ["Price Tracking", "Menu Diffs", "Promo Detection"],
  },
  {
    title: "Social Media Intelligence",
    description:
      "Monitor Instagram, Facebook, and TikTok. See what content is working for competitors, where your engagement gaps are, and what your audience responds to.",
    tags: ["Instagram", "Facebook", "TikTok", "Engagement"],
  },
  {
    title: "SEO & Visibility",
    description:
      "See who is showing up in local search, what keywords they are ranking for, and whether they are running Google Ads in your market.",
    tags: ["Local SEO", "Google Ads", "Keyword Tracking"],
  },
  {
    title: "Local Events & Foot Traffic",
    description:
      "Know which events are happening near your competitors, who is hosting them, and when foot traffic peaks. Plan staffing and promotions around real data.",
    tags: ["Events", "Busy Times", "Peak Hours"],
  },
  {
    title: "AI-Powered Insights",
    description:
      "Vatic doesn't just collect data. It reads every signal across every competitor, cross-references them, and tells you the 5 most important things in plain English.",
    tags: ["Priority Briefing", "Confidence Scores", "Recommendations"],
  },
]

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
}

export function FeaturesSection() {
  return (
    <section id="features" className="border-t border-border/50 py-24">
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
            What Vatic Tracks
          </p>
          <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
            Every signal that matters. None of the noise.
          </h2>
        </motion.div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, i) => (
            <motion.div
              key={i}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-60px" }}
              transition={{
                duration: 0.5,
                delay: i * 0.08,
                ease: [0.16, 1, 0.3, 1],
              }}
              variants={fadeUp}
              className="glass-card rounded-xl border border-border p-6"
            >
              <h3 className="mb-2 text-base font-semibold text-foreground">
                {feature.title}
              </h3>
              <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
                {feature.description}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {feature.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
