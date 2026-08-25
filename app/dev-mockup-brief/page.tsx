// DEV-ONLY marketing mockup route — renders a fully FICTIONAL brief (Copper Fern, Dallas)
// through the REAL BriefView, so marketing screenshots always show the product's current
// layout. No auth, no DB: everything comes from ./fixture. Guarded to non-production.
//
// To refresh the marketing site's brief imagery: run the dev server, capture this route
// (light theme, 2x), and drop the shots into ticket-marketing. See fixture.ts for the rules
// the fictional content follows.

import { notFound } from "next/navigation"
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

export default async function DevMockupBrief() {
  if (process.env.NODE_ENV === "production") notFound()
  // Dates in the fixture are computed from "now" so the mockup always reads current;
  // connection() opts the route out of prerendering (cacheComponents flags bare new Date()).
  await connection()
  const now = new Date()
  return (
    <div style={{ background: "#f5f3ef", minHeight: "100vh", padding: "32px 24px" }}>
      <BriefView
        brief={buildMockBrief(now)}
        locationId="mock"
        locationName={MOCK_RESTAURANT}
        competitors={[...MOCK_COMPETITORS]}
        readOnly
        standingAsk={MOCK_STANDING_ASK}
        weeklyMomentum={3}
        marketPulse={buildMockPulse(now)}
      />
    </div>
  )
}
