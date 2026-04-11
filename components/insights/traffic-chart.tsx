"use client"

import { useState, useSyncExternalStore } from "react"

type TrafficData = {
  competitor_id: string
  competitor_name: string
  days: Array<{
    day_of_week: number
    hourly_scores: number[]
    peak_hour: number
    peak_score: number
    typical_time_spent: string | null
  }>
}

type Props = {
  data: TrafficData[]
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const FULL_DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const COMPETITOR_COLORS = [
  "bg-vatic-indigo", "bg-vatic-indigo-soft", "bg-precision-teal", "bg-signal-gold",
  "bg-vatic-alert-red", "bg-muted-violet", "bg-deep-indigo", "bg-signal-gold",
]

function formatHour(h: number): string {
  if (h === 0) return "12a"
  if (h === 12) return "12p"
  return h < 12 ? `${h}a` : `${h - 12}p`
}

function useIsClient() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
}

export default function TrafficChart({ data }: Props) {
  const isClient = useIsClient()
  const [selectedDay, setSelectedDay] = useState(new Date().getDay())

  if (data.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
        <svg className="mx-auto h-10 w-10 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
        </svg>
        <p className="mt-2 text-sm font-medium text-muted-foreground">No busy times data yet</p>
        <p className="text-xs text-muted-foreground">Traffic patterns will appear after the weekly data fetch</p>
      </div>
    )
  }

  if (!isClient) {
    return <div className="h-80 animate-pulse rounded-2xl bg-secondary" />
  }

  const dayData = data.map(comp => {
    const dayInfo = comp.days.find(d => d.day_of_week === selectedDay)
    return { ...comp, dayInfo }
  }).filter(d => d.dayInfo)

  const hours = Array.from({ length: 16 }, (_, i) => i + 6)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <svg className="h-5 w-5 text-signal-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75z" />
        </svg>
        <h3 className="text-sm font-bold text-foreground">Competitor Busy Times</h3>
        <span className="text-xs text-muted-foreground">{FULL_DAY_NAMES[selectedDay]}</span>
      </div>

      <div className="flex gap-1">
        {DAY_NAMES.map((name, i) => (
          <button
            key={name}
            onClick={() => setSelectedDay(i)}
            className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition ${
              selectedDay === i
                ? "bg-signal-gold text-white shadow-sm"
                : "bg-card text-muted-foreground ring-1 ring-border hover:bg-secondary"
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card p-4">
        <div className="min-w-[600px]">
          <div className="flex items-end gap-0.5" style={{ height: 200 }}>
            {hours.map(h => {
              return (
                <div key={h} className="flex flex-1 flex-col items-center gap-0.5">
                  <div className="flex w-full items-end justify-center gap-px" style={{ height: 160 }}>
                    {dayData.map((comp, ci) => {
                      const score = comp.dayInfo?.hourly_scores[h] ?? 0
                      const height = Math.max((score / 100) * 160, 2)
                      return (
                        <div
                          key={comp.competitor_id}
                          className={`w-full max-w-[12px] rounded-t-sm ${COMPETITOR_COLORS[ci % COMPETITOR_COLORS.length]} transition-all`}
                          style={{ height }}
                          title={`${comp.competitor_name}: ${score}% at ${formatHour(h)}`}
                        />
                      )
                    })}
                  </div>
                  <span className="text-[9px] text-muted-foreground">{formatHour(h)}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        {dayData.map((comp, ci) => (
          <div key={comp.competitor_id} className="flex items-center gap-2 text-xs">
            <span className={`h-2.5 w-2.5 rounded-full ${COMPETITOR_COLORS[ci % COMPETITOR_COLORS.length]}`} />
            <span className="font-medium text-foreground">{comp.competitor_name}</span>
            {comp.dayInfo && (
              <span className="text-muted-foreground">
                Peak: {formatHour(comp.dayInfo.peak_hour)} ({comp.dayInfo.peak_score}%)
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
