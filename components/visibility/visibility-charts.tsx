"use client"

import { useEffect, useState } from "react"
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"
import type { PieLabelRenderProps } from "recharts"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Props = {
  sovData: Array<{ name: string; value: number }>
  locationDomain: string | null
}

// ---------------------------------------------------------------------------
// Color palette
// ---------------------------------------------------------------------------

const COLORS = [
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#06b6d4", // cyan
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // rose
  "#ec4899", // pink
  "#3b82f6", // blue
  "#14b8a6", // teal
  "#f97316", // orange
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function VisibilityCharts({ sovData, locationDomain }: Props) {
  const [isClient, setIsClient] = useState(false)
  useEffect(() => setIsClient(true), [])

  if (!isClient || sovData.length === 0) return null

  // Highlight the location domain
  const chartData = sovData.slice(0, 8).map((d) => ({
    ...d,
    isLocation: locationDomain ? d.name === locationDomain : false,
  }))

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold text-slate-900">Share of Voice</h2>
      <p className="mb-4 text-xs text-slate-400">
        % of tracked keywords where each domain ranks in the Top 10
      </p>
      <div className="h-[280px] w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={100}
              innerRadius={50}
              paddingAngle={2}
              label={(props: PieLabelRenderProps) => {
                const n = String(props.name ?? "")
                const p = Number(props.percent ?? 0)
                return `${n} (${(p * 100).toFixed(0)}%)`
              }}
              labelLine
            >
              {chartData.map((entry, index) => (
                <Cell
                  key={entry.name}
                  fill={COLORS[index % COLORS.length]}
                  strokeWidth={entry.isLocation ? 3 : 1}
                  stroke={entry.isLocation ? "#1e1b4b" : "#fff"}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => `${value} keywords`}
              contentStyle={{
                borderRadius: 12,
                border: "1px solid #e2e8f0",
                fontSize: 12,
              }}
            />
            <Legend
              verticalAlign="bottom"
              height={36}
              iconType="circle"
              formatter={(value) => (
                <span className="text-xs text-slate-600">{value}</span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
