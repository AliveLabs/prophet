"use client"

import { Card } from "@/components/ui/card"
import {
  SeverityDistribution,
  buildSeverityData,
  InsightsBySource,
  buildSourceBarData,
  WeeklyTrend,
  buildTrendData,
} from "@/components/home/home-charts"
import { useChartColors } from "@/lib/hooks/use-chart-colors"

type InsightRow = {
  id: string
  insight_type: string
  severity: string
  confidence: string
  status: string
  created_at: string
  date_key: string | null
}

export default function HomeChartsSection({
  allInsights,
}: {
  allInsights: InsightRow[]
}) {
  const chartColors = useChartColors()
  const severityData = buildSeverityData(allInsights, chartColors)
  const sourceData = buildSourceBarData(allInsights, chartColors)
  const trendData = buildTrendData(allInsights, 14)

  const hasChartData =
    severityData.some((d) => d.value > 0) ||
    sourceData.some((d) => d.count > 0) ||
    trendData.some((d) => d.count > 0)

  if (!hasChartData) return null

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="bg-card">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Severity Breakdown
        </h3>
        <div className="mt-3">
          <SeverityDistribution data={severityData} />
        </div>
      </Card>

      <Card className="bg-card">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Insights by Source
        </h3>
        <div className="mt-3">
          <InsightsBySource data={sourceData} />
        </div>
      </Card>

      <Card className="bg-card">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          14-Day Insight Trend
        </h3>
        <p className="mt-0.5 text-[10px] text-muted-foreground">New insights per day</p>
        <div className="mt-3">
          <WeeklyTrend data={trendData} />
        </div>
      </Card>
    </div>
  )
}
