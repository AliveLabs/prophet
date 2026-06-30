"use client"

// ALT-235 — "You vs the block": head-to-head + busy-times for the watched set,
// placed below the roster on the Competitors overview.
//
// REUSE over rebuild: the head-to-head bars are the kit's <TkH2HBars/> (same viz
// the Visibility page uses), and the busy-times heatmap is the Traffic page's
// <TrafficHeatmapGrid/> island, fed the SAME serializable shape the Traffic page
// builds. The day-by-day read is navigable by the heatmap's per-entity selector
// (one entity's full week at a time, the grid scrolls inside its own card) —
// mirroring how the Traffic page avoids rendering every entity × 7 days at once.
//
// Honest framing: busy scores are Google Maps popular times — "% of each spot's
// own typical peak", a relative read of the block's rhythm, not headcount or
// sales. We never fabricate a number; missing data renders as a flagged gap.

import {
  RevealOnView,
  TkCard,
  TkSectionHead,
  TkH2HBars,
  TkEmptyState,
} from "@/components/ticket"
import TrafficHeatmapGrid from "../traffic/traffic-heatmap-grid"
import CompetitorHoursGrid, { type HoursEntity } from "./competitor-hours-grid"
import type { TrafficData } from "../traffic/traffic-types"
import type { ComparisonEntity, ComparisonH2HRow } from "../operator-data"

const CHART_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M3 3v18h18" />
    <path d="M7 14l4-4 3 3 5-6" />
  </svg>
)

export default function CompetitorComparison({
  entities,
  h2h,
  hasOwnData,
  hasCompetitorData,
  ownName,
  hoursEntities,
  todayDow,
  locationId,
}: {
  entities: ComparisonEntity[]
  h2h: ComparisonH2HRow[]
  hasOwnData: boolean
  hasCompetitorData: boolean
  ownName: string
  hoursEntities: HoursEntity[]
  todayDow: number
  locationId?: string
}) {
  const hasHours = hoursEntities.some((e) => e.hoursKnown)

  // Nothing pulled on any side yet — one honest empty state, no fake viz.
  if (!hasCompetitorData && !hasOwnData && !hasHours) {
    return (
      <section className="tk-comp-sec">
        <TkSectionHead
          title="You vs the block"
          sub="Head-to-head, busy times, and open hours, once we've read the set"
        />
        <TkEmptyState
          icon={CHART_ICON}
          title="No competitor read yet"
          description="We pull each rival's busy times and open hours from Google Maps. Once a competitor's data lands, and your own listing is read, you'll see where you're ahead, when the block fills up, and who's open when. Open the Foot traffic page to start a pull."
        />
      </section>
    )
  }

  // The heatmap island takes the Traffic page's TrafficData shape. The own row is
  // labeled so it's obvious which entry is you in the selector.
  const heatmapData: TrafficData[] = entities.map((e) => ({
    competitor_id: e.competitor_id,
    competitor_name: e.isYou ? `${e.competitor_name} · You` : e.competitor_name,
    days: e.days,
  }))

  return (
    <section className="tk-comp-sec">
      {/* ── HEAD-TO-HEAD ── */}
      {h2h.length > 0 ? (
        <RevealOnView>
          <TkSectionHead
            title="You vs the block"
            sub="Where you draw a bigger crowd, and where they do"
          />
          <TkCard>
            <TkH2HBars
              rows={h2h}
              note="Crowd pull compares peak busyness from Google Maps popular times — % of each spot's own typical peak, a relative read of the block's rhythm, not headcount or sales."
            />
          </TkCard>
        </RevealOnView>
      ) : hasCompetitorData && !hasOwnData ? (
        // Competitors have data but we have no own curve to compare against. Flag the
        // gap honestly instead of inventing a "you" value — the heatmap below still
        // shows the competitor read.
        <RevealOnView>
          <TkSectionHead
            title="You vs the block"
            sub="Add your own listing to unlock the head-to-head"
          />
          <TkEmptyState
            icon={CHART_ICON}
            title="We can't compare you yet"
            description={`We have busy-times for your competitors but not for ${ownName} — so we won't fake a head-to-head. Once your own popular-times curve is pulled, you'll see where you draw a bigger crowd than each rival.`}
          />
        </RevealOnView>
      ) : null}

      {/* ── BUSY TIMES BY DAY (heatmap, per-entity selector) ── */}
      {hasCompetitorData || hasOwnData ? (
        <>
          <TkSectionHead
            title="When the block fills up"
            sub="Pick a spot to read its week, hour by hour"
          />
          <RevealOnView>
            <div className="tk-trf-panel">
              <p className="tk-trf-panel-sub">
                How busy each spot runs across the week — % of that spot&apos;s own typical peak,
                from Google Maps popular times. Pick a spot to read its full week; the grid scrolls
                sideways inside its card.
              </p>
              <TrafficHeatmapGrid data={heatmapData} />
            </div>
          </RevealOnView>
        </>
      ) : null}

      {/* ── ALT-231 WHO'S OPEN WHEN (24h open-hours + busy by day, day selector) ── */}
      <CompetitorHoursGrid entities={hoursEntities} todayDow={todayDow} locationId={locationId} />
    </section>
  )
}
