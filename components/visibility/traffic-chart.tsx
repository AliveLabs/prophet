"use client"

import { Suspense, useState } from "react"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts"

type TrafficPoint = {
  date: string
  organicEtv: number
  paidEtv: number
  organicKeywords: number
}

type Props = {
  data: TrafficPoint[]
}

type ChartMode = "traffic" | "keywords"

function TrafficChartInner({ data }: Props) {
  const [mode, setMode] = useState<ChartMode>("traffic")

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        No historical data available yet.
      </div>
    )
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={() => setMode("traffic")}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
            mode === "traffic"
              ? "bg-foreground text-background"
              : "bg-secondary text-muted-foreground hover:bg-secondary/80"
          }`}
        >
          Total Traffic
        </button>
        <button
          onClick={() => setMode("keywords")}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
            mode === "keywords"
              ? "bg-foreground text-background"
              : "bg-secondary text-muted-foreground hover:bg-secondary/80"
          }`}
        >
          Keywords
        </button>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
          <defs>
            <linearGradient id="gradOrganic" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#00BFA6" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#00BFA6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradPaid" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#5A3FFF" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#5A3FFF" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) =>
              v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v)
            }
          />
          <Tooltip
            contentStyle={{
              borderRadius: 12,
              border: "1px solid var(--border)",
              fontSize: 12,
            }}
            formatter={(value) => {
              const v = typeof value === "number" ? value : Number(value ?? 0)
              return v.toLocaleString()
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {mode === "traffic" ? (
            <>
              <Area
                type="monotone"
                dataKey="organicEtv"
                name="Organic"
                stroke="#00BFA6"
                strokeWidth={2}
                fill="url(#gradOrganic)"
              />
              <Area
                type="monotone"
                dataKey="paidEtv"
                name="Paid"
                stroke="#5A3FFF"
                strokeWidth={2}
                fill="url(#gradPaid)"
              />
            </>
          ) : (
            <Area
              type="monotone"
              dataKey="organicKeywords"
              name="Keywords"
              stroke="#F2A11E"
              strokeWidth={2}
              fill="none"
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function TrafficChart(props: Props) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-secondary" />}>
      <TrafficChartInner {...props} />
    </Suspense>
  )
}
