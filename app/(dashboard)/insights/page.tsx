import InsightCard from "@/components/insight-card"
import InsightsDashboard from "@/components/insights/insights-dashboard"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import { fetchPlaceDetails } from "@/lib/places/google"
import type { NormalizedSnapshot } from "@/lib/providers/types"
import { dismissInsightAction, generateInsightsAction, markInsightReadAction } from "./actions"

type InsightsPageProps = {
  searchParams?: Promise<{
    confidence?: string
    severity?: string
    range?: string
    error?: string
    location_id?: string
  }>
}

function getStartDate(range: string | undefined) {
  const days = range === "30" ? 30 : 7
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

export default async function InsightsPage({ searchParams }: InsightsPageProps) {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  const organizationId = profile?.current_organization_id
  if (!organizationId) {
    return null
  }

  const { data: locations } = await supabase
    .from("locations")
    .select("id, name, primary_place_id")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })

  const resolvedSearchParams = await Promise.resolve(searchParams)
  const selectedLocationId = resolvedSearchParams?.location_id ?? locations?.[0]?.id ?? null
  const startDate = getStartDate(resolvedSearchParams?.range)

  let query = supabase
    .from("insights")
    .select(
      "id, title, summary, confidence, severity, status, evidence, recommendations, date_key, competitor_id, insight_type"
    )
    .gte("date_key", startDate)
    .order("date_key", { ascending: false })

  if (selectedLocationId) {
    query = query.eq("location_id", selectedLocationId)
  }

  if (resolvedSearchParams?.confidence) {
    query = query.eq("confidence", resolvedSearchParams.confidence)
  }
  if (resolvedSearchParams?.severity) {
    query = query.eq("severity", resolvedSearchParams.severity)
  }

  const { data: insights } = await query
  const error = resolvedSearchParams?.error

  const selectedLocation = locations?.find((location) => location.id === selectedLocationId) ?? null
  let locationRating: number | null = null
  let locationReviewCount: number | null = null
  if (selectedLocation?.primary_place_id) {
    try {
      const details = await fetchPlaceDetails(selectedLocation.primary_place_id)
      locationRating = typeof details.rating === "number" ? details.rating : null
      locationReviewCount =
        typeof details.userRatingCount === "number" ? details.userRatingCount : null
    } catch {
      locationRating = null
      locationReviewCount = null
    }
  }

  const { data: competitors } =
    selectedLocationId
      ? await supabase
          .from("competitors")
          .select("id, name, category, metadata")
          .eq("location_id", selectedLocationId)
          .eq("is_active", true)
      : { data: [] }

  const competitorIds = competitors?.map((competitor) => competitor.id) ?? []
  const { data: snapshots } =
    competitorIds.length > 0
      ? await supabase
          .from("snapshots")
          .select("competitor_id, date_key, raw_data")
          .in("competitor_id", competitorIds)
          .gte("date_key", startDate)
      : { data: [] }

  const snapshotRows = snapshots ?? []
  const latestByCompetitor = new Map<string, NormalizedSnapshot>()
  const latestDateByCompetitor = new Map<string, string>()
  for (const snapshot of snapshotRows) {
    const dateKey = snapshot.date_key
    const competitorId = snapshot.competitor_id
    const currentLatestDate = latestDateByCompetitor.get(competitorId)
    if (!currentLatestDate || dateKey > currentLatestDate) {
      latestDateByCompetitor.set(competitorId, dateKey)
      latestByCompetitor.set(competitorId, snapshot.raw_data as NormalizedSnapshot)
    }
  }

  const ratingComparison = [
    ...(selectedLocation?.name
      ? [
          {
            name: selectedLocation.name,
            rating: locationRating,
            reviewCount: locationReviewCount,
          },
        ]
      : []),
    ...(competitors ?? []).map((competitor) => {
      const snapshot = latestByCompetitor.get(competitor.id)
      const metadata = competitor.metadata as Record<string, unknown> | null
      const placeDetails = metadata?.placeDetails as Record<string, unknown> | null
      const metadataRating = metadata?.rating as number | null | undefined
      const metadataReviewCount = metadata?.reviewCount as number | null | undefined
      return {
        name: competitor.name ?? "Competitor",
        rating:
          snapshot?.profile?.rating ??
          (placeDetails?.rating as number | null | undefined) ??
          metadataRating ??
          null,
        reviewCount:
          snapshot?.profile?.reviewCount ??
          (placeDetails?.reviewCount as number | null | undefined) ??
          metadataReviewCount ??
          null,
        priceLevel:
          snapshot?.profile?.priceLevel ??
          (placeDetails?.priceLevel as string | null | undefined) ??
          null,
        primaryType:
          (placeDetails?.primaryType as string | null | undefined) ??
          (competitor.category ?? null),
        hoursDays:
          snapshot?.hours
            ? Object.keys(snapshot.hours).length
            : placeDetails?.regularOpeningHours
              ? Object.keys(placeDetails.regularOpeningHours as Record<string, unknown>).length
              : null,
      }
    }),
  ]

  const reviewVelocity = (competitors ?? []).map((competitor) => {
    const snapshotsForCompetitor = snapshotRows
      .filter((row) => row.competitor_id === competitor.id)
      .sort((a, b) => (a.date_key > b.date_key ? -1 : 1))
    const latest = snapshotsForCompetitor[0]?.raw_data as NormalizedSnapshot | undefined
    const previous = snapshotsForCompetitor[1]?.raw_data as NormalizedSnapshot | undefined
    const delta =
      typeof latest?.profile?.reviewCount === "number" &&
      typeof previous?.profile?.reviewCount === "number"
        ? latest.profile.reviewCount - previous.profile.reviewCount
        : null
    return {
      name: competitor.name ?? "Competitor",
      delta,
    }
  })

  const baselineByCompetitor = new Map<string, NormalizedSnapshot>()
  const baselineDateByCompetitor = new Map<string, string>()
  for (const snapshot of snapshotRows) {
    const competitorId = snapshot.competitor_id
    const currentBaselineDate = baselineDateByCompetitor.get(competitorId)
    if (!currentBaselineDate || snapshot.date_key < currentBaselineDate) {
      baselineDateByCompetitor.set(competitorId, snapshot.date_key)
      baselineByCompetitor.set(competitorId, snapshot.raw_data as NormalizedSnapshot)
    }
  }

  const reviewGrowthDelta = (competitors ?? []).map((competitor) => {
    const latest = latestByCompetitor.get(competitor.id)
    const baseline = baselineByCompetitor.get(competitor.id)
    const latestCount = latest?.profile?.reviewCount
    const baselineCount = baseline?.profile?.reviewCount
    const delta =
      typeof latestCount === "number" && typeof baselineCount === "number"
        ? latestCount - baselineCount
        : null
    return {
      name: competitor.name ?? "Competitor",
      delta,
    }
  })

  const reviewCountComparison = ratingComparison
    .filter((item) => item.name)
    .map((item) => ({
      name: item.name,
      rating: item.rating ?? null,
      reviewCount: item.reviewCount ?? null,
    }))

  const reviewSumByDate = new Map<string, number>()
  const reviewCountByDate = new Map<string, number>()
  for (const snapshot of snapshotRows) {
    const dateKey = snapshot.date_key
    const profile = (snapshot.raw_data as NormalizedSnapshot)?.profile
    if (typeof profile?.reviewCount !== "number") {
      continue
    }
    reviewSumByDate.set(dateKey, (reviewSumByDate.get(dateKey) ?? 0) + profile.reviewCount)
    reviewCountByDate.set(dateKey, (reviewCountByDate.get(dateKey) ?? 0) + 1)
  }
  const reviewTrend = Array.from(reviewSumByDate.entries())
    .map(([date, total]) => {
      const count = reviewCountByDate.get(date) ?? 0
      return {
        date,
        location: locationReviewCount,
        competitors: count > 0 ? Number((total / count).toFixed(1)) : null,
      }
    })
    .sort((a, b) => (a.date > b.date ? 1 : -1))

  const sentimentCounts = { positive: 0, negative: 0, mixed: 0 }
  const themeInsights =
    insights?.filter((insight) => insight.insight_type === "review_themes") ?? []
  for (const insight of themeInsights) {
    const evidence = insight.evidence as Record<string, unknown>
    const counts = evidence?.sentimentCounts as
      | { positive?: number; negative?: number; mixed?: number }
      | undefined
    if (counts) {
      sentimentCounts.positive += counts.positive ?? 0
      sentimentCounts.negative += counts.negative ?? 0
      sentimentCounts.mixed += counts.mixed ?? 0
    } else {
      const themes = (evidence?.themes as Array<Record<string, unknown>> | undefined) ?? []
      for (const theme of themes) {
        const sentiment = theme.sentiment as string | undefined
        if (sentiment === "positive") sentimentCounts.positive += 1
        else if (sentiment === "negative") sentimentCounts.negative += 1
        else sentimentCounts.mixed += 1
      }
    }
  }

  const avgCompetitorRating = (() => {
    const ratings = ratingComparison
      .filter((item) => item.name !== selectedLocation?.name)
      .map((item) => item.rating)
      .filter((value): value is number => typeof value === "number")
    if (!ratings.length) return null
    return Number((ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(2))
  })()

  const competitorReviewTotal = ratingComparison
    .filter((item) => item.name !== selectedLocation?.name)
    .map((item) => item.reviewCount)
    .filter((value): value is number => typeof value === "number")
    .reduce((sum, value) => sum + value, 0)
  const locationReviewTotal = typeof locationReviewCount === "number" ? locationReviewCount : 0
  const reviewShare =
    locationReviewTotal + competitorReviewTotal > 0
      ? Number(
          ((locationReviewTotal / (locationReviewTotal + competitorReviewTotal)) * 100).toFixed(1)
        )
      : null

  const latestSnapshotDate =
    snapshotRows.length > 0
      ? snapshotRows
          .map((row) => row.date_key)
          .sort((a, b) => (a > b ? -1 : 1))[0]
      : null

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-sm">
        <h1 className="text-2xl font-semibold">Insights</h1>
        <p className="mt-2 text-sm text-slate-600">
          Review daily changes across your approved competitors.
        </p>
        {error ? (
          <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {decodeURIComponent(error)}
          </p>
        ) : null}
        <form className="mt-4 flex flex-wrap gap-3" method="get">
          <select
            name="location_id"
            defaultValue={selectedLocationId ?? ""}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          >
            {locations?.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name ?? "Location"}
              </option>
            ))}
          </select>
          <select
            name="range"
            defaultValue={resolvedSearchParams?.range ?? "7"}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
          </select>
          <select
            name="confidence"
            defaultValue={resolvedSearchParams?.confidence ?? ""}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          >
            <option value="">All confidence</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select
            name="severity"
            defaultValue={resolvedSearchParams?.severity ?? ""}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          >
            <option value="">All severity</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
          <button
            type="submit"
            className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Apply filters
          </button>
        </form>
        {selectedLocationId ? (
          <form action={generateInsightsAction} className="mt-4">
            <input type="hidden" name="location_id" value={selectedLocationId} />
            <button
              type="submit"
              className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white"
            >
              Generate insights
            </button>
          </form>
        ) : null}
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          <p className="font-semibold text-slate-700">Debug context</p>
          <div className="mt-2 grid gap-1">
            <span>Location ID: {selectedLocationId ?? "n/a"}</span>
            <span>Approved competitors: {competitors?.length ?? 0}</span>
            <span>Snapshots in range: {snapshotRows.length}</span>
            <span>Latest snapshot date: {latestSnapshotDate ?? "n/a"}</span>
          </div>
          {snapshotRows.length === 0 ? (
            <p className="mt-2 text-xs text-amber-700">
              No snapshots found yet. Baseline insights will use current Google Places data.
            </p>
          ) : null}
        </div>
      </div>

      {selectedLocationId ? (
        <InsightsDashboard
          ratingComparison={ratingComparison}
          reviewGrowthDelta={reviewGrowthDelta}
          sentimentCounts={sentimentCounts}
          reviewCountComparison={reviewCountComparison}
          avgCompetitorRating={avgCompetitorRating}
          locationRating={locationRating}
          reviewShare={reviewShare}
        />
      ) : null}

      <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-5 text-slate-900">
        <h2 className="text-lg font-semibold text-indigo-900">Location of interest</h2>
        <p className="mt-1 text-sm text-indigo-800">
          {selectedLocation?.name ?? "Location"} • Rating{" "}
          {locationRating ?? "n/a"} • Reviews {locationReviewCount ?? "n/a"}
        </p>
      </div>

      <div className="space-y-6">
        <h2 className="text-lg font-semibold text-slate-900">Competitor insights</h2>
        {competitors?.length ? (
          competitors.map((competitor) => {
            const competitorInsights =
              insights?.filter((insight) => insight.competitor_id === competitor.id) ?? []
            return (
              <div key={competitor.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-slate-900">{competitor.name}</h3>
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                    Competitor
                  </span>
                </div>
                <div className="mt-4 space-y-4">
                  {competitorInsights.length ? (
                    competitorInsights.map((insight) => (
                      <InsightCard
                        key={insight.id}
                        title={insight.title}
                        summary={insight.summary}
                        confidence={insight.confidence}
                        severity={insight.severity}
                        status={insight.status}
                        evidence={insight.evidence as Record<string, unknown>}
                        recommendations={insight.recommendations as Array<Record<string, unknown>>}
                        actions={
                          <>
                            <form action={markInsightReadAction}>
                              <input type="hidden" name="insight_id" value={insight.id} />
                              <button
                                type="submit"
                                className="rounded-full border border-zinc-200 px-3 py-1 text-xs"
                              >
                                Mark read
                              </button>
                            </form>
                            <form action={dismissInsightAction}>
                              <input type="hidden" name="insight_id" value={insight.id} />
                              <button
                                type="submit"
                                className="rounded-full border border-zinc-200 px-3 py-1 text-xs"
                              >
                                Dismiss
                              </button>
                            </form>
                          </>
                        }
                        accent="competitor"
                      />
                    ))
                  ) : (
                    <p className="text-sm text-slate-500">No insights yet for this competitor.</p>
                  )}
                </div>
              </div>
            )
          })
        ) : (
          <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
            No approved competitors yet.
          </p>
        )}
      </div>

      {insights && insights.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          No insights yet. Once snapshots run, changes will appear here.
        </p>
      ) : null}
    </section>
  )
}
