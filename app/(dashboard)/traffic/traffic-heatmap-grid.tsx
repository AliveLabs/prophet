"use client"

// The Pass — weekly busy-times heatmap (client island, page-local).
//
// Re-implements components/traffic/traffic-heatmap.tsx with the kit token system:
// a gold-ramp intensity grid (0→100% of typical peak). Competitor picker is a
// kit-styled segmented control. Grid scrolls horizontally INSIDE this card on
// mobile (the page body never scrolls sideways). Cells animate in on view.

import { useState, useSyncExternalStore } from "react"
import { useInView } from "@/components/ticket"
import { busyLevel, BUSY_LEVEL_LABEL, BUSY_LEVEL_REP } from "@/lib/traffic/busy-level"
import type { TrafficData } from "./traffic-types"

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
// Full calendar day (12a-11p). The grid used to start at 6a, which hid the
// 12a-5a hours late-night and 24h spots actually trade in — the same hours our
// insights tell operators to capitalize on.
const HOURS = Array.from({ length: 24 }, (_, i) => i)

function formatHour(h: number): string {
  if (h === 0) return "12a"
  if (h === 12) return "12p"
  return h < 12 ? `${h}a` : `${h - 12}p`
}

// 6-step intensity ramp built from gold tokens (token-driven so dark works free).
function heatStyle(score: number): { background: string; color: string } {
  if (score === 0) return { background: "var(--paper-2)", color: "transparent" }
  const t = Math.min(1, score / 100)
  const pct = Math.round(18 + t * 70) // 18%→88% gold mix
  return {
    background: `color-mix(in srgb, var(--gold) ${pct}%, var(--card))`,
    color: score >= 58 ? "#3a2a08" : "var(--ink-3)",
  }
}

function useIsClient() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )
}

export default function TrafficHeatmapGrid({ data }: { data: TrafficData[] }) {
  const isClient = useIsClient()
  const { ref, inView } = useInView<HTMLDivElement>()
  const [selected, setSelected] = useState(data[0]?.competitor_id ?? "")

  if (data.length === 0) return null
  if (!isClient) return <div className="tk-trf-skel" aria-hidden="true" />

  const competitor = data.find((d) => d.competitor_id === selected) ?? data[0]

  return (
    <div className="tk-trf-heat">
      {data.length > 1 && (
        <div className="tk-trf-segs" role="tablist" aria-label="Competitor">
          {data.map((d) => (
            <button
              key={d.competitor_id}
              type="button"
              role="tab"
              aria-selected={competitor.competitor_id === d.competitor_id}
              onClick={() => setSelected(d.competitor_id)}
              className={`tk-trf-seg${competitor.competitor_id === d.competitor_id ? " tk-on" : ""}`}
            >
              {d.competitor_name}
            </button>
          ))}
        </div>
      )}

      <div className="tk-trf-heatscroll" ref={ref}>
        <table className="tk-trf-grid">
          <thead>
            <tr>
              <th className="tk-trf-gh tk-trf-gh-day" scope="col">
                Day
              </th>
              {HOURS.map((h) => (
                <th key={h} className="tk-trf-gh" scope="col">
                  {formatHour(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAY_LABELS.map((dayLabel, dow) => {
              const dayInfo = competitor.days.find((d) => d.day_of_week === dow)
              return (
                <tr key={dow}>
                  <th className="tk-trf-rh" scope="row">
                    {dayLabel}
                  </th>
                  {HOURS.map((h) => {
                    const score = dayInfo?.hourly_scores[h] ?? 0
                    // ALT-286: categorical, not a raw %. Color by busy level; the specific
                    // "% of peak" stays as supporting detail in the tooltip only.
                    const lvl = busyLevel(score)
                    const background =
                      lvl === -1 ? "var(--paper-2)" : heatStyle(BUSY_LEVEL_REP[lvl]).background
                    return (
                      <td key={h} className="tk-trf-cellwrap">
                        <span
                          className="tk-trf-cell"
                          data-tip={`${dayLabel} ${formatHour(h)}`}
                          data-tipv={lvl === -1 ? "Closed" : `${BUSY_LEVEL_LABEL[lvl]} · ${score}% of peak`}
                          style={{
                            background,
                            opacity: inView ? 1 : 0,
                            transform: inView ? "scale(1)" : "scale(.6)",
                            transitionDelay: `${Math.min(dow * 18 + h * 4, 420)}ms`,
                          }}
                        />
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ALT-286: legend speaks the four levels (no raw %); the exact % is tooltip-only. */}
      <div className="tk-trf-heatleg">
        {([0, 1, 2, 3] as const).map((lvl) => (
          <span className="tk-trf-lv" key={lvl}>
            <i style={{ background: heatStyle(BUSY_LEVEL_REP[lvl]).background }} />
            {BUSY_LEVEL_LABEL[lvl]}
          </span>
        ))}
      </div>
    </div>
  )
}
