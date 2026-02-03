"use client"

import { useEffect, useState } from "react"
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

type RatingDatum = {
  name: string
  rating: number | null
  reviewCount?: number | null
}

type GrowthDatum = {
  name: string
  delta: number | null
}

type InsightsDashboardProps = {
  ratingComparison: RatingDatum[]
  reviewGrowthDelta: GrowthDatum[]
  reviewCountComparison: RatingDatum[]
  sentimentCounts: { positive: number; negative: number; mixed: number }
  avgCompetitorRating: number | null
  locationRating: number | null
  reviewShare: number | null
}

export default function InsightsDashboard({
  ratingComparison,
  reviewGrowthDelta,
  reviewCountComparison,
  sentimentCounts,
  avgCompetitorRating,
  locationRating,
  reviewShare,
}: InsightsDashboardProps) {
  const [isClient, setIsClient] = useState(false)
  useEffect(() => {
    setIsClient(true)
  }, [])

  const sentimentData = [
    { name: "Positive", value: sentimentCounts.positive, color: "#22c55e" },
    { name: "Mixed", value: sentimentCounts.mixed, color: "#eab308" },
    { name: "Negative", value: sentimentCounts.negative, color: "#ef4444" },
  ]

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700">Reputation KPIs</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-500">Avg competitor rating</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {avgCompetitorRating ?? "n/a"}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Location rating: {locationRating ?? "n/a"}
              </p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-500">Review share (location)</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {reviewShare !== null ? `${reviewShare}%` : "n/a"}
              </p>
              <p className="mt-1 text-xs text-slate-500">Share of total reviews</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700">Sentiment distribution</h3>
          <p className="mt-1 text-xs text-slate-500">
            Aggregated from competitor review themes (LLM). Not a comparison to your location.
          </p>
          <div className="mt-4 h-[260px] w-full">
            {isClient && sentimentData.some((item) => item.value > 0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={sentimentData} dataKey="value" nameKey="name" outerRadius={90}>
                    {sentimentData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                No sentiment themes yet.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700">Rating comparison</h3>
          <div className="mt-4 h-[260px] w-full">
            {isClient && ratingComparison.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ratingComparison}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 5]} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(value) => [`${value}`, "Rating"]} />
                  <Bar dataKey="rating" fill="#6366f1" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                No rating data yet.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700">Review count comparison</h3>
          <div className="mt-4 h-[260px] w-full">
            {isClient && reviewCountComparison.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={reviewCountComparison}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(value) => [`${value}`, "Reviews"]} />
                  <Bar dataKey="reviewCount" fill="#f97316" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                No review count data yet.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700">Review growth vs baseline</h3>
          <p className="mt-1 text-xs text-slate-500">
            Requires at least two snapshots per competitor.
          </p>
          <div className="mt-4 h-[260px] w-full">
            {isClient && reviewGrowthDelta.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={reviewGrowthDelta}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(value) => [`${value}`, "Review delta"]} />
                  <Bar dataKey="delta" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                Not enough snapshots yet.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700">Sentiment by themes</h3>
          <p className="mt-1 text-xs text-slate-500">
            Counts of competitor review themes labeled by the LLM.
          </p>
          <div className="mt-4 h-[260px] w-full">
            {isClient && sentimentData.some((item) => item.value > 0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sentimentData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(value) => [`${value}`, "Themes"]} />
                  <Bar dataKey="value" fill="#64748b" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                No sentiment themes yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
