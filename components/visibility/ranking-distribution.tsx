"use client"

import { Suspense } from "react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from "recharts"

type RankDistribution = {
  pos_1: number
  pos_2_3: number
  pos_4_10: number
  pos_11_20: number
  pos_21_50: number
  pos_51_100: number
}

type Props = {
  distribution: RankDistribution
}

const COLORS = ["#22c55e", "#84cc16", "#f59e0b", "#f97316", "#ef4444"]

function RankingDistributionInner({ distribution }: Props) {
  const data = [
    { range: "1-5", count: distribution.pos_1 + distribution.pos_2_3 + Math.round(distribution.pos_4_10 * 0.2) },
    { range: "6-10", count: Math.round(distribution.pos_4_10 * 0.8) },
    { range: "11-20", count: distribution.pos_11_20 },
    { range: "21-50", count: distribution.pos_21_50 },
    { range: "51-100", count: distribution.pos_51_100 },
  ]

  const total = data.reduce((sum, d) => sum + d.count, 0)
  const dataWithPct = data.map((d) => ({
    ...d,
    pct: total > 0 ? Math.round((d.count / total) * 10000) / 100 : 0,
  }))

  if (total === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-slate-400">
        No ranking distribution data.
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={dataWithPct} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis
          dataKey="range"
          tick={{ fontSize: 11, fill: "#94a3b8" }}
          tickLine={false}
          axisLine={false}
          label={{ value: "Position", position: "insideBottom", offset: -2, fontSize: 10, fill: "#94a3b8" }}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#94a3b8" }}
          tickLine={false}
          axisLine={false}
          label={{ value: "Keywords", angle: -90, position: "insideLeft", fontSize: 10, fill: "#94a3b8" }}
        />
        <Tooltip
          contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }}
          formatter={(value, _name, item) => {
            const v = typeof value === "number" ? value : Number(value ?? 0)
            const pct = (item?.payload as { pct?: number })?.pct ?? 0
            return [`${v.toLocaleString()} (${pct}%)`, "Keywords"]
          }}
        />
        <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={60}>
          {dataWithPct.map((_, index) => (
            <Cell key={index} fill={COLORS[index % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export default function RankingDistribution(props: Props) {
  return (
    <Suspense fallback={<div className="h-48 animate-pulse rounded-xl bg-slate-100" />}>
      <RankingDistributionInner {...props} />
    </Suspense>
  )
}
