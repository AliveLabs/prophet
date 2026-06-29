"use client"

// The Pass — weekly busy-times heatmap (client island, page-local).
//
// Re-implements components/traffic/traffic-heatmap.tsx with the kit token system:
// a gold-ramp intensity grid (0→100% of typical peak). Competitor picker is a
// kit-styled segmented control. Grid scrolls horizontally INSIDE this card on
// mobile (the page body never scrolls sideways). Cells animate in on view.

import { useState, useSyncExternalStore } from "react"
import { useInView } from "@/components/ticket"
import type { TrafficData } from "./traffic-types"

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const HOURS = Array.from({ length: 18 }, (_, i) => i + 6)

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
                    const style = heatStyle(score)
                    return (
                      <td key={h} className="tk-trf-cellwrap">
                        <span
                          className="tk-trf-cell"
                          data-tip={`${dayLabel} ${formatHour(h)}`}
                          data-tipv={`${score}% of peak`}
                          style={{
                            background: style.background,
                            color: style.color,
                            opacity: inView ? 1 : 0,
                            transform: inView ? "scale(1)" : "scale(.6)",
                            transitionDelay: `${Math.min(dow * 18 + h * 4, 420)}ms`,
                          }}
                        >
                          {score > 0 ? score : ""}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="tk-trf-heatleg">
        <span>Quieter</span>
        <div className="tk-trf-ramp">
          {[0, 20, 40, 60, 80, 100].map((s) => (
            <i key={s} style={{ background: heatStyle(s).background }} />
          ))}
        </div>
        <span>Busier</span>
        <span className="tk-trf-heatleg-note">% of that spot&apos;s typical peak</span>
      </div>
    </div>
  )
}
