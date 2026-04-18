"use client"

import { useSyncExternalStore } from "react"
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from "recharts"
import { useChartColors } from "@/lib/hooks/use-chart-colors"

type RatingDatum = {
  name: string
  rating: number | null
  reviewCount?: number | null
}

type GrowthDatum = {
  name: string
  delta: number | null
}

type ReviewExcerpt = {
  rating?: number
  text?: string
  author?: string
  date?: string
  competitorName?: string
}

type InsightsDashboardProps = {
  ratingComparison: RatingDatum[]
  reviewGrowthDelta: GrowthDatum[]
  sentimentCounts: { positive: number; negative: number; mixed: number }
  avgCompetitorRating: number | null
  locationRating: number | null
  reviewShare: number | null
  recentReviews?: ReviewExcerpt[]
}

function useIsClient() {
  return useSyncExternalStore(() => () => {}, () => true, () => false)
}

function ChartTooltip({ active, payload, label, valueLabel }: { active?: boolean; payload?: Array<{ name?: string; value?: number }>; label?: string; valueLabel?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-border bg-card px-3.5 py-2.5 shadow-lg">
      <p className="text-[11px] font-semibold text-foreground">{label}</p>
      {payload.map((entry, idx) => (
        <p key={idx} className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{entry.value}</span>
          {" "}{valueLabel ?? entry.name}
        </p>
      ))}
    </div>
  )
}

function NoData({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
      {text}
    </div>
  )
}

function StarRating({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <svg
          key={star}
          className={`h-3 w-3 ${star <= rating ? "text-signal-gold" : "text-muted-foreground"}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </span>
  )
}

export default function InsightsDashboard({
  ratingComparison,
  reviewGrowthDelta,
  sentimentCounts,
  avgCompetitorRating,
  locationRating,
  reviewShare,
  recentReviews = [],
}: InsightsDashboardProps) {
  const isClient = useIsClient()
  const chartColors = useChartColors()

  const sentimentData = [
    { name: "Positive", value: sentimentCounts.positive, color: chartColors.precisionTeal },
    { name: "Mixed", value: sentimentCounts.mixed, color: chartColors.signalGold },
    { name: "Negative", value: sentimentCounts.negative, color: chartColors.destructive },
  ]

  const sentimentTotal = sentimentData.reduce((s, d) => s + d.value, 0)
  const dominantSentiment = sentimentData.reduce((a, b) => (a.value >= b.value ? a : b))

  const barSharedProps = {
    axisLine: false as const,
    tickLine: false as const,
  }

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Avg Competitor Rating</p>
          <p className="mt-1.5 text-3xl font-bold text-foreground">{avgCompetitorRating ?? "—"}</p>
          {locationRating !== null && (
            <p className="mt-1 text-xs text-muted-foreground">
              Your rating: <span className={locationRating >= (avgCompetitorRating ?? 0) ? "font-semibold text-precision-teal" : "font-semibold text-signal-gold"}>{locationRating}</span>
            </p>
          )}
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Review Share</p>
          <p className="mt-1.5 text-3xl font-bold text-foreground">{reviewShare !== null ? `${reviewShare}%` : "—"}</p>
          <p className="mt-1 text-xs text-muted-foreground">Your share of total reviews</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Dominant Sentiment</p>
          <p className="mt-1.5 text-3xl font-bold" style={{ color: dominantSentiment.color }}>
            {sentimentTotal > 0 ? dominantSentiment.name : "—"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {sentimentTotal > 0 ? `${Math.round((dominantSentiment.value / sentimentTotal) * 100)}% of ${sentimentTotal} themes` : "No data yet"}
          </p>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Competitor Overview: grouped bar for rating + review count */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm lg:col-span-1">
          <h3 className="text-sm font-semibold text-foreground">Competitor Overview</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Rating comparison</p>
          <div className="mt-4 h-[240px] w-full">
            {isClient && ratingComparison.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ratingComparison} barCategoryGap="25%">
                  <defs>
                    <linearGradient id="ratingGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={chartColors.carbonLight} stopOpacity={0.9} />
                      <stop offset="100%" stopColor={chartColors.foreground} stopOpacity={0.6} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} {...barSharedProps} />
                  <YAxis domain={[0, 5]} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} {...barSharedProps} width={28} />
                  <Tooltip content={<ChartTooltip valueLabel="rating" />} />
                  <Bar dataKey="rating" fill="url(#ratingGrad)" radius={[6, 6, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <NoData text="No rating data yet." />
            )}
          </div>
        </div>

        {/* Sentiment Analysis: donut chart */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm lg:col-span-1">
          <h3 className="text-sm font-semibold text-foreground">Sentiment Analysis</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Competitor review themes</p>
          <div className="relative mt-4 h-[240px] w-full">
            {isClient && sentimentTotal > 0 ? (
              <>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={sentimentData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius="55%"
                      outerRadius="80%"
                      paddingAngle={3}
                      strokeWidth={0}
                    >
                      {sentimentData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = payload[0]
                        return (
                          <div className="rounded-xl border border-border bg-card px-3.5 py-2.5 shadow-lg">
                            <p className="text-[11px] font-semibold text-foreground">{d?.name}</p>
                            <p className="text-xs text-muted-foreground">
                              <span className="font-medium text-foreground">{d?.value}</span> themes
                            </p>
                          </div>
                        )
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <p className="text-2xl font-bold text-foreground">{sentimentTotal}</p>
                  <p className="text-[10px] font-medium text-muted-foreground">themes</p>
                </div>
              </>
            ) : (
              <NoData text="No sentiment themes yet." />
            )}
          </div>
          {sentimentTotal > 0 && (
            <div className="mt-2 flex items-center justify-center gap-4">
              {sentimentData.map((d) => (
                <div key={d.name} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: d.color }} />
                  {d.name}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Review Momentum: delta bar */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm lg:col-span-1">
          <h3 className="text-sm font-semibold text-foreground">Review Momentum</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Growth since baseline snapshot</p>
          <div className="mt-4 h-[240px] w-full">
            {isClient && reviewGrowthDelta.some((d) => d.delta !== null) ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={reviewGrowthDelta} barCategoryGap="25%">
                  <defs>
                    <linearGradient id="deltaGradPos" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={chartColors.precisionTeal} stopOpacity={0.9} />
                      <stop offset="100%" stopColor={chartColors.precisionTeal} stopOpacity={0.6} />
                    </linearGradient>
                    <linearGradient id="deltaGradNeg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={chartColors.destructive} stopOpacity={0.9} />
                      <stop offset="100%" stopColor={chartColors.destructive} stopOpacity={0.6} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} {...barSharedProps} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} {...barSharedProps} width={28} />
                  <Tooltip content={<ChartTooltip valueLabel="new reviews" />} />
                  <Bar
                    dataKey="delta"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={36}
                  >
                    {reviewGrowthDelta.map((entry, idx) => (
                      <Cell
                        key={idx}
                        fill={(entry.delta ?? 0) >= 0 ? "url(#deltaGradPos)" : "url(#deltaGradNeg)"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <NoData text="Needs 2+ snapshots per competitor." />
            )}
          </div>
        </div>
      </div>

      {/* Recent Reviews */}
      {recentReviews.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Recent Reviews</h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Latest review excerpts from competitors</p>
            </div>
            <div className="flex items-center gap-3 text-[10px]">
              {sentimentCounts.positive > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-precision-teal/15 px-2.5 py-1 font-semibold text-precision-teal">
                  <span className="h-1.5 w-1.5 rounded-full bg-precision-teal" />
                  {sentimentCounts.positive} positive
                </span>
              )}
              {sentimentCounts.negative > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-destructive/15 px-2.5 py-1 font-semibold text-destructive">
                  <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
                  {sentimentCounts.negative} negative
                </span>
              )}
              {sentimentCounts.mixed > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-signal-gold/10 px-2.5 py-1 font-semibold text-signal-gold">
                  <span className="h-1.5 w-1.5 rounded-full bg-signal-gold" />
                  {sentimentCounts.mixed} mixed
                </span>
              )}
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recentReviews.slice(0, 6).map((review, idx) => (
              <div key={idx} className="rounded-xl border border-border bg-secondary p-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {typeof review.rating === "number" && <StarRating rating={review.rating} />}
                    {review.competitorName && (
                      <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        {review.competitorName}
                      </span>
                    )}
                  </div>
                  {review.date && (
                    <span className="text-[10px] text-muted-foreground">{review.date}</span>
                  )}
                </div>
                {review.text && (
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    {review.text.slice(0, 180)}{review.text.length > 180 ? "..." : ""}
                  </p>
                )}
                {review.author && (
                  <p className="mt-1.5 text-[10px] font-medium text-muted-foreground">
                    — {review.author}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
