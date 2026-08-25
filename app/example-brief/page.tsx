// /example-brief — the PUBLIC example of a Ticket daily brief (Bryan, 2026-08-25).
//
// A complete fictional brief ("Copper Fern", Dallas; fictional competitors; marketing- and
// social-driven insights) rendered through the REAL BriefView, so what a visitor sees here is
// exactly what the product renders today. The marketing site links here and redirects
// getticket.ai/example-brief to this page, and its BriefProof imagery is captured from it.
//
// Rules this page lives by:
//   · Everything is fictional and labeled so on its face (the top bar; in the embedded view the
//     marketing modal's own chrome carries the Example label instead). See ./fixture.ts.
//   · No auth, no DB, no model calls: the whole page is the static fixture.
//   · readOnly: keep/dismiss and Ask stay non-interactive previews; nothing writes. The links
//     into auth-gated app pages ("See all insights", "Open your insights") are hidden by this
//     page's CSS: for a visitor they lead to a login wall, which is a dead end, not a preview.
//   · ?embed=1 hides the top bar: the marketing site loads that variant in its modal, whose own
//     chrome provides the label and the close control. frame-ancestors for this route is set in
//     next.config.ts (self + getticket.ai only).
//   · noindex for now: it exists to be linked and shared, not to compete with the marketing
//     site in search. Deliberate, and cheap to flip later.

import type { Metadata } from "next"
import { Suspense } from "react"
import { connection } from "next/server"
import BriefView from "../(dashboard)/home/brief-view"
import {
  buildMockBrief,
  buildMockPulse,
  MOCK_COMPETITORS,
  MOCK_RESTAURANT,
  MOCK_STANDING_ASK,
} from "./fixture"
import "../(dashboard)/home/brief.css"
import "./example-brief.css"

export const metadata: Metadata = {
  // The root layout's title template appends "· Ticket".
  title: "An example brief",
  description:
    "A complete example of Ticket's daily brief for a fictional restaurant: what changed around it, the evidence, and a practical starting point for each decision.",
  robots: { index: false, follow: false },
}

function TicketMark() {
  return (
    <svg width="16" height="25" viewBox="0 0 72 114" aria-hidden="true" style={{ color: "var(--ink)" }}>
      <rect x="0" y="0" width="72" height="14" rx="1.5" fill="currentColor" />
      <rect x="18" y="14" width="36" height="100" fill="currentColor" />
      <circle cx="18" cy="16" r="3.5" style={{ fill: "var(--paper)" }} />
      <circle cx="54" cy="16" r="3.5" style={{ fill: "var(--paper)" }} />
      <line x1="21.5" y1="16" x2="50.5" y2="16" style={{ stroke: "var(--paper)" }} strokeWidth="1.6" strokeDasharray="2.5,2" />
    </svg>
  )
}

// cacheComponents: the sync default export prerenders the page shell, and the uncached parts
// (searchParams + the fixture's "now") stream inside <Suspense> — same pattern as the preview
// layout. The fallback is the page's paper ground so nothing flashes.
export default function ExampleBriefPage(props: { searchParams: Promise<{ embed?: string }> }) {
  return (
    <Suspense fallback={<div className="xb-page" />}>
      <ExampleBrief searchParams={props.searchParams} />
    </Suspense>
  )
}

async function ExampleBrief({
  searchParams,
}: {
  searchParams: Promise<{ embed?: string }>
}) {
  // The fixture computes its dates from "now" so the timing chips stay alive;
  // connection() opts this subtree out of prerendering (cacheComponents flags bare new Date()).
  await connection()
  const embedded = (await searchParams).embed === "1"
  const now = new Date()
  return (
    <div className={embedded ? "xb-page xb-page-embed" : "xb-page"}>
      {!embedded ? (
        <header className="xb-bar">
          <a className="xb-brand" href="https://getticket.ai">
            <TicketMark /> TICKET
          </a>
          <span className="xb-note">Example brief &middot; a fictional restaurant, real layout</span>
          <a className="xb-cta" href="/signup">
            Start free trial
          </a>
        </header>
      ) : null}
      <main className="xb-main">
        <BriefView
          brief={buildMockBrief(now)}
          locationId="example"
          locationName={MOCK_RESTAURANT}
          competitors={[...MOCK_COMPETITORS]}
          readOnly
          standingAsk={MOCK_STANDING_ASK}
          weeklyMomentum={3}
          marketPulse={buildMockPulse(now)}
        />
      </main>
    </div>
  )
}
