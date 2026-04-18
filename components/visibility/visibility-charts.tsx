"use client"

import { useSyncExternalStore } from "react"
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"
import type { PieLabelRenderProps } from "recharts"
import { useChartColors } from "@/lib/hooks/use-chart-colors"

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function VisibilityCharts({ sovData, locationDomain }: Props) {
  const isClient = useSyncExternalStore(() => () => {}, () => true, () => false)
  const c = useChartColors()
  const COLORS = [
    c.vaticIndigo, c.carbonLight, c.precisionTeal, c.signalGold,
    c.destructive, c.mutedForeground, c.deepIndigo,
    c.precisionTeal, c.signalGold, c.carbonLight,
  ]

  if (!isClient || sovData.length === 0) {
    return <p className="text-sm text-muted-foreground">No share of voice data yet.</p>
  }

  // Highlight the location domain
  const chartData = sovData.slice(0, 8).map((d) => ({
    ...d,
    isLocation: locationDomain ? d.name === locationDomain : false,
  }))

  return (
    <div>
      <p className="mb-3 text-xs text-muted-foreground">
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
                  stroke={entry.isLocation ? "var(--foreground)" : "var(--background)"}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => `${value} keywords`}
              contentStyle={{
                borderRadius: 12,
                border: "1px solid var(--border)",
                fontSize: 12,
              }}
            />
            <Legend
              verticalAlign="bottom"
              height={36}
              iconType="circle"
              formatter={(value) => (
                <span className="text-xs text-muted-foreground">{value}</span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

