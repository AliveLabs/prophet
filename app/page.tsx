// Marketing landing — the public front door, rebuilt to "The Pass" (Concept A).
//
// This surface lives OUTSIDE the dashboard shell, so it imports the kit
// stylesheet (which pulls in the shared token SSOT, app/editorial-tokens.css)
// and its own landing.css, then wraps everything in a token surface
// (`.ticket-chrome .tk-kit`) so every --paper/--rust/--card/--shadow-* var
// resolves and light + warm-dark both work for free. A pearlescent
// atmospheric canvas (`.lp-atmos`) supplies the premium light-depth.
//
// Presentation only — the waitlist form keeps its original business logic
// (POST /api/waitlist) and the sign-in/request-access CTAs route as before.

import type { Metadata } from "next"
import "@/components/ticket/pass.css"
import "./landing.css"

import { LandingNav } from "@/components/landing/landing-nav"
import { PassHero } from "@/components/landing/pass-hero"
import { PassProblem } from "@/components/landing/pass-problem"
import { PassFeatures } from "@/components/landing/pass-features"
import { PassHowItWorks } from "@/components/landing/pass-how-it-works"
import { PassTrust } from "@/components/landing/pass-trust"
import { PassPricing } from "@/components/landing/pass-pricing"
import { PassWaitlist, PassFooter } from "@/components/landing/pass-waitlist"

export const metadata: Metadata = {
  title: "Ticket — Competitive Intelligence for Restaurants",
  description:
    "Read the ticket. Ticket watches competitor menus, pricing, reviews, and social — every shift scored by confidence, so you move first, not last.",
}

export default function LandingPage() {
  return (
    <div className="ticket-chrome tk-kit lp-root">
      <div className="lp-atmos" aria-hidden="true" />
      <LandingNav />
      <main className="lp-shell">
        <PassHero />
        <PassProblem />
        <PassFeatures />
        <PassHowItWorks />
        <PassTrust />
        <PassPricing />
        <PassWaitlist />
      </main>
      <PassFooter />
    </div>
  )
}
