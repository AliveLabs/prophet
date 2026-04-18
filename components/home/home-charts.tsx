"use client"

import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { useChartColors, type ChartColors } from "@/lib/hooks/use-chart-colors"

// ---------------------------------------------------------------------------
// Severity Distribution (donut chart)
// ---------------------------------------------------------------------------

function severityColors(c: ChartColors): Record<string, string> {
  return {
    critical: c.destructive,
    warning: c.signalGold,
    info: c.foreground,
    positive: c.precisionTeal,
  }
}

type SeverityData = { name: string; value: number; color: string }

export function SeverityDistribution({
  data,
}: {
  data: SeverityData[]
}) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (total === 0) return null

  return (
    <div className="flex items-center gap-6">
      <div className="h-[140px] w-[140px] shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={40}
              outerRadius={65}
              paddingAngle={2}
              dataKey="value"
              stroke="none"
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-1.5">
        {data.filter((d) => d.value > 0).map((d) => (
          <div key={d.name} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color }} />
            <span className="text-xs font-medium capitalize text-foreground">{d.name}</span>
            <span className="text-xs text-muted-foreground">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function buildSeverityData(
  insights: Array<{ severity: string }>,
  chartColors?: ChartColors
): SeverityData[] {
  const palette = chartColors ? severityColors(chartColors) : {
    critical: "#DC2626", warning: "#D4880A", info: "#2B353F", positive: "#34775E",
  }
  const fallback = chartColors?.mutedForeground ?? "#726A63"
  const counts: Record<string, number> = { critical: 0, warning: 0, info: 0, positive: 0 }
  for (const ins of insights) {
    const key = ins.severity ?? "info"
    counts[key] = (counts[key] ?? 0) + 1
  }
  return Object.entries(counts).map(([name, value]) => ({
    name,
    value,
    color: palette[name] ?? fallback,
  }))
}

// ---------------------------------------------------------------------------
// Insights by Source (bar chart)
// ---------------------------------------------------------------------------

function sourceColors(c: ChartColors): Record<string, string> {
  return {
    Competitors: c.precisionTeal,
    Events: c.carbonLight,
    SEO: c.foreground,
    Content: c.precisionTeal,
    Photos: c.signalGold,
    Traffic: c.signalGold,
    Social: c.foreground,
    Reviews: c.signalGold,
  }
}

type SourceBarData = { name: string; count: number; fill: string }

export function InsightsBySource({ data }: { data: SourceBarData[] }) {
  const filtered = data.filter((d) => d.count > 0)
  if (filtered.length === 0) return null

  return (
    <div className="h-[160px] w-full">
      <ResponsiveContainer>
        <BarChart data={filtered} layout="vertical" margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            width={70}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid var(--border)" }}
            formatter={(value) => [String(value), "Insights"]}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={14}>
            {filtered.map((entry) => (
              <Cell key={entry.name} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function buildSourceBarData(
  insights: Array<{ insight_type: string }>,
  chartColors?: ChartColors
): SourceBarData[] {
  const palette = chartColors ? sourceColors(chartColors) : {
    Competitors: "#34775E", Events: "#3D4B58", SEO: "#2B353F",
    Content: "#34775E", Photos: "#D4880A", Traffic: "#D4880A",
    Social: "#2B353F", Reviews: "#D4880A",
  }
  const fallback = chartColors?.mutedForeground ?? "#726A63"
  const counts: Record<string, number> = {}
  for (const ins of insights) {
    const t = ins.insight_type ?? ""
    let cat = "Competitors"
    if (t.startsWith("social.")) cat = "Social"
    else if (t.startsWith("events.")) cat = "Events"
    else if (t.startsWith("seo_") || t.startsWith("cross_")) cat = "SEO"
    else if (t.startsWith("menu.") || t.startsWith("content.")) cat = "Content"
    else if (t.startsWith("photo.") || t.startsWith("visual.")) cat = "Photos"
    else if (t.startsWith("traffic.") || t.startsWith("busy_times.")) cat = "Traffic"
    else if (t.startsWith("review_")) cat = "Reviews"
    counts[cat] = (counts[cat] ?? 0) + 1
  }
  return Object.entries(counts)
    .map(([name, count]) => ({
      name,
      count,
      fill: palette[name] ?? fallback,
    }))
    .sort((a, b) => b.count - a.count)
}

// ---------------------------------------------------------------------------
// Weekly Insight Trend (area spark line)
// ---------------------------------------------------------------------------

type TrendPoint = { day: string; count: number }

export function WeeklyTrend({ data }: { data: TrendPoint[] }) {
  const colors = useChartColors()
  if (data.length === 0) return null

  return (
    <div className="h-[80px] w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={colors.foreground} stopOpacity={0.3} />
              <stop offset="95%" stopColor={colors.foreground} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="day" hide />
          <YAxis hide />
          <Tooltip
            contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid var(--border)" }}
            formatter={(value) => [String(value), "Insights"]}
          />
          <Area
            type="monotone"
            dataKey="count"
            stroke={colors.foreground}
            strokeWidth={2}
            fill="url(#trendGrad)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function buildTrendData(
  insights: Array<{ created_at: string }>,
  days = 14
): TrendPoint[] {
  const today = new Date()
  const buckets = new Map<string, number>()

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    buckets.set(d.toISOString().slice(0, 10), 0)
  }

  for (const ins of insights) {
    const key = ins.created_at?.slice(0, 10)
    if (key && buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + 1)
    }
  }

  return [...buckets.entries()].map(([date, count]) => ({
    day: new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    count,
  }))
}
