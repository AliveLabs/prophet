"use client"

import { useEffect, useRef } from "react"
import {
  SIGNAL_TYPE_CONFIG,
  mapInsightToCategory,
  type SignalCategory,
} from "@/lib/competitors/helpers"

type BreakdownProps = {
  insights: Array<{ insight_type: string }>
  month: string
}

export default function SignalBreakdown({ insights, month }: BreakdownProps) {
  const barsRef = useRef<HTMLDivElement>(null)

  const counts = new Map<SignalCategory, number>()
  for (const ins of insights) {
    const cat = mapInsightToCategory(ins.insight_type)
    counts.set(cat, (counts.get(cat) ?? 0) + 1)
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const maxCount = sorted.length > 0 ? sorted[0][1] : 1

  useEffect(() => {
    if (!barsRef.current) return
    const timer = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        barsRef.current?.querySelectorAll<HTMLDivElement>("[data-pct]").forEach((el) => {
          el.style.width = `${el.dataset.pct}%`
        })
      })
    })
    return () => cancelAnimationFrame(timer)
  }, [sorted.length])

  if (sorted.length === 0) return null

  return (
    <section className="mb-8">
      <h2 className="mb-5 font-display text-[22px] font-semibold text-foreground">
        Signal breakdown{" "}
        <span className="font-normal text-deep-violet">· {month}</span>
      </h2>

      <div
        ref={barsRef}
        className="flex flex-col gap-4 rounded-[18px] border border-border bg-card px-5 py-4"
      >
        {sorted.map(([category, count]) => {
          const config = SIGNAL_TYPE_CONFIG[category]
          const pct = (count / maxCount) * 100

          return (
            <div
              key={category}
              className="grid grid-cols-[72px_1fr_20px] items-center gap-3"
            >
              <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <span className="text-sm leading-none">{config.icon}</span>
                <span>{config.label}</span>
              </div>
              <div className="h-[7px] overflow-hidden rounded-full bg-secondary/60">
                <div
                  className="h-full w-0 rounded-full transition-[width] duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)]"
                  style={{ backgroundColor: config.color }}
                  data-pct={pct}
                />
              </div>
              <span className="text-right text-xs tabular-nums text-deep-violet">
                {count}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
