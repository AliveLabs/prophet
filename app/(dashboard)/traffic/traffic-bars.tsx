"use client"

// The Pass — competitor busy-times bar chart (client island, page-local).
//
// Re-implements the presentation of components/insights/traffic-chart.tsx with
// the kit's token system (no Tailwind color utilities, no fake $/covers — busy
// scores are Google-Maps "% of typical peak"). Bars animate 0→height on in-view
// and respect reduced-motion. Hour columns scroll horizontally INSIDE this card
// on mobile so the page body never scrolls sideways.

import { useState, useSyncExternalStore } from "react"
import { useInView } from "@/components/ticket"
import type { TrafficData } from "./traffic-types"

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const FULL_DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
// Token-driven series colors (cycles through the Ticket palette ramps).
const SERIES = ["--slate", "--teal", "--gold", "--rust", "--alert", "--slate-deep"] as const

function formatHour(h: number): string {
  if (h === 0) return "12a"
  if (h === 12) return "12p"
  return h < 12 ? `${h}a` : `${h - 12}p`
}

function useIsClient() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )
}

export default function TrafficBars({ data }: { data: TrafficData[] }) {
  const isClient = useIsClient()
  const { ref, inView } = useInView<HTMLDivElement>()
  const [selectedDay, setSelectedDay] = useState(() => new Date().getDay())

  if (data.length === 0) return null
  if (!isClient) return <div className="tk-trf-skel" aria-hidden="true" />

  const dayData = data
    .map((comp) => ({ ...comp, dayInfo: comp.days.find((d) => d.day_of_week === selectedDay) }))
    .filter((d) => d.dayInfo)

  const hours = Array.from({ length: 16 }, (_, i) => i + 6)

  return (
    <div className="tk-trf-bars">
      <div className="tk-trf-daypick" role="tablist" aria-label="Day of week">
        {DAY_NAMES.map((name, i) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={selectedDay === i}
            onClick={() => setSelectedDay(i)}
            className={`tk-trf-day${selectedDay === i ? " tk-on" : ""}`}
          >
            {name}
          </button>
        ))}
        <span className="tk-trf-daylabel">{FULL_DAY_NAMES[selectedDay]}</span>
      </div>

      <div className="tk-trf-plot" ref={ref}>
        <div className="tk-trf-plot-inner">
          <div className="tk-trf-cols">
            {hours.map((h) => (
              <div key={h} className="tk-trf-col">
                <div className="tk-trf-stack">
                  {dayData.map((comp, ci) => {
                    const score = comp.dayInfo?.hourly_scores[h] ?? 0
                    const color = SERIES[ci % SERIES.length]
                    return (
                      <span
                        key={comp.competitor_id}
                        className="tk-trf-bar"
                        data-tip={`${comp.competitor_name} · ${formatHour(h)}`}
                        data-tipv={`${score}% of peak`}
                        style={{
                          height: inView ? `${Math.max(score, 1.5)}%` : 0,
                          background: `var(${color})`,
                        }}
                      />
                    )
                  })}
                </div>
                <span className="tk-trf-hr">{formatHour(h)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="tk-trf-legend">
        {dayData.map((comp, ci) => (
          <span key={comp.competitor_id} className="tk-trf-leg">
            <i style={{ background: `var(${SERIES[ci % SERIES.length]})` }} />
            <b>{comp.competitor_name}</b>
            {comp.dayInfo && (
              <em>
                peak {formatHour(comp.dayInfo.peak_hour)} · {comp.dayInfo.peak_score}%
              </em>
            )}
          </span>
        ))}
      </div>
    </div>
  )
}
