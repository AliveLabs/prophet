// Competitors — "The Set": the watched competitive set as a nav destination AND the
// home for managing watched entities (contract §7). Rebuilt to The Pass: the page-title
// chrome stays on-system (.pv-page/.pv-page-head), the BODY is re-authored with the kit
// (a roster of rival cards + the add/discover flows). Real names, ratings, and signal
// counts for the logged-in operator's location — data wiring unchanged.

import { loadOperatorContext, loadCompetitorComparison, loadCompetitorSwapState, tierLabel } from "../operator-data"
import { TIER_LIMITS, asSubscriptionTier } from "@/lib/billing/tiers"
import { computeSwapCooldown, COMPETITOR_SWAP_COOLDOWN_DAYS } from "@/lib/billing/limits"
import { TkTooltipLayer } from "@/components/ticket"
import CompetitorRoster from "./competitor-roster"
import CompetitorComparison from "./competitor-comparison"
import "./competitors.css"
// ALT-235: the busy-times heatmap reuses the Traffic page's tk-trf-* styles.
import "../traffic/traffic.css"

export default async function CompetitorsPage() {
  // Independent reads — run them together (each resolves the operator on its own).
  const [ctx, comparison, swapState] = await Promise.all([
    loadOperatorContext(),
    loadCompetitorComparison(),
    loadCompetitorSwapState(),
  ])
  const competitorLimit = TIER_LIMITS[asSubscriptionTier(ctx.tier)].maxCompetitorsPerLocation
  // ALT-195 — swap cooldown (1 / 30 days), derived from the last removal timestamp.
  const swapCooldown = computeSwapCooldown(swapState.lastRemovalAt)
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
        swapCooldown={swapCooldown}
        swapCooldownDays={COMPETITOR_SWAP_COOLDOWN_DAYS}
      />

      {/* ALT-235 — head-to-head + busy-times for the watched set, below the roster.
          Reuses the kit's TkH2HBars and the Traffic page's heatmap island; data is
          the busy-times the Traffic pipeline already ingests (no new pipeline). The
          tooltip layer renders the heatmap cells' data-tip hovers. */}
      <TkTooltipLayer />
      <CompetitorComparison
        entities={comparison.entities}
        h2h={comparison.h2h}
        hasOwnData={comparison.hasOwnData}
        hasCompetitorData={comparison.hasCompetitorData}
        ownName={ctx.locationName}
        hoursEntities={comparison.hoursEntities}
        todayDow={comparison.todayDow}
        locationId={ctx.locationId}
      />

      {/* ALT-196 freed this spot (the misplaced own-social link); ALT-195 now fills it
          with the swap rule so the operator knows the cadence before they remove one. */}
      <p className="tk-swap-rule">
        {swapCooldown.locked ? (
          <>
            <span className="tk-swap-lock" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="4" y="11" width="16" height="9" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
            </span>
            Your set is locked for {swapCooldown.daysRemaining} more day
            {swapCooldown.daysRemaining === 1 ? "" : "s"} — you can swap a competitor once every{" "}
            {COMPETITOR_SWAP_COOLDOWN_DAYS} days.
          </>
        ) : (
          <>You can swap a competitor once every {COMPETITOR_SWAP_COOLDOWN_DAYS} days. After you remove one, the set locks for {COMPETITOR_SWAP_COOLDOWN_DAYS} days.</>
        )}
      </p>
    </div>
  )
}
