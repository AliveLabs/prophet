// Competitors — "The Set": the watched competitive set as a nav destination AND the
// home for managing watched entities (contract §7). Rebuilt to The Pass: the page-title
// chrome stays on-system (.pv-page/.pv-page-head), the BODY is re-authored with the kit
// (a roster of rival cards + the add/discover flows). Real names, ratings, and signal
// counts for the logged-in operator's location — data wiring unchanged.

import { loadOperatorContext, tierLabel } from "../operator-data"
import { TIER_LIMITS, asSubscriptionTier } from "@/lib/billing/tiers"
import CompetitorRoster from "./competitor-roster"
import "./competitors.css"

export default async function CompetitorsPage() {
  const ctx = await loadOperatorContext()
  const competitorLimit = TIER_LIMITS[asSubscriptionTier(ctx.tier)].maxCompetitorsPerLocation
  return (
    <div className="pv-page tk-comp">
      <div className="pv-page-head">
        <span className="pv-kicker">Your market</span>
        <h1 className="pv-h1">Competitors</h1>
        <p className="pv-sub">
          The places we watch for you{ctx.city ? ` around ${ctx.city}` : ""}. We track their pricing,
          reviews, social, and menus, and surface anything that moves into your brief.
        </p>
      </div>
      <hr className="pv-rule" />

      <CompetitorRoster
        initial={ctx.competitors.map((c) => ({
          id: c.id,
          name: c.name,
          rating: c.rating,
          reviewCount: c.reviewCount,
          signalCount: c.signalCount,
          topSignals: c.topSignals,
        }))}
        tierLabel={tierLabel(ctx.tier)}
        competitorLimit={competitorLimit}
        locationId={ctx.locationId}
      />

      {/* ALT-196: the misplaced "manage your own social handles" link was removed —
          own-social handles are managed in Settings, competitor handles on each
          competitor detail page. TODO(ALT-196 follow-up): this freed spot may later
          hold a 30-day "swap a competitor" note; not built here. */}
    </div>
  )
}
