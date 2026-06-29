"use client"

import { LpReveal, stIdx } from "./landing-shared"

const STEPS = [
  {
    n: "01",
    title: "Name your set",
    body:
      "Your restaurant plus up to ten competitors — five minutes. Ticket starts watching menus, pricing, reviews, social, and local search the moment you finish.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="0.5" fill="currentColor" />
      </svg>
    ),
  },
  {
    n: "02",
    title: "Signals scored",
    body:
      "Every shift is classified High, Medium, or Directional — multi-source verification filters the noise, so you only see what’s worth a second look.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 3v18h18" /><path d="m7 14 3-3 3 3 5-6" /><circle cx="18" cy="8" r="1.2" fill="currentColor" />
      </svg>
    ),
  },
  {
    n: "03",
    title: "Briefings land",
    body:
      "Daily alerts with what changed, why it matters, and the next move — priority-scored, confidence-rated, and tied to something you can do Monday morning.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
      </svg>
    ),
  },
]

export function PassHowItWorks() {
  return (
    <section id="how-it-works" className="lp-section">
      <div className="lp-wrap">
        <LpReveal className="lp-section-head" as="div">
          <span className="lp-eyebrow">How Ticket works</span>
          <h2 className="lp-h2">
            Setup to first alert:{" "}
            <span className="lp-flourish lp-em">48 hours.</span>
          </h2>
        </LpReveal>

        <LpReveal className="lp-steps" as="div" stagger>
          {STEPS.map((s, i) => (
            <div key={s.n} className="lp-step" style={stIdx(i)}>
              {i < STEPS.length - 1 && <span className="lp-step-connector" aria-hidden="true" />}
              <span className="lp-step-badge">{s.icon}</span>
              <span className="lp-step-n">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </LpReveal>
      </div>
    </section>
  )
}
