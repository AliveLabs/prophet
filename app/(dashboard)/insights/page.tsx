import InsightCard from "@/components/insight-card"
import InsightsDashboard from "@/components/insights/insights-dashboard"
import AutoFilterForm from "@/components/filters/auto-filter-form"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import { fetchPlaceDetails } from "@/lib/places/google"
import type { NormalizedSnapshot } from "@/lib/providers/types"
import { dismissInsightAction, generateInsightsAction, markInsightReadAction } from "./actions"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type InsightsPageProps = {
  searchParams?: Promise<{
    confidence?: string
    severity?: string
    range?: string
    error?: string
    location_id?: string
    source?: string
  }>
}

function getStartDate(range: string | undefined) {
  const days = range === "30" ? 30 : 7
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function InsightsPage({ searchParams }: InsightsPageProps) {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  const organizationId = profile?.current_organization_id
  if (!organizationId) return null

  const { data: locations } = await supabase
    .from("locations")
    .select("id, name, primary_place_id")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })

  const resolvedSearchParams = await Promise.resolve(searchParams)
  const selectedLocationId = resolvedSearchParams?.location_id ?? locations?.[0]?.id ?? null
  const startDate = getStartDate(resolvedSearchParams?.range)

  // -------------------------------------------------------------------------
  // Fetch insights
  // -------------------------------------------------------------------------

  let query = supabase
    .from("insights")
    .select(
      "id, title, summary, confidence, severity, status, evidence, recommendations, date_key, competitor_id, insight_type"
    )
    .gte("date_key", startDate)
    .order("date_key", { ascending: false })

  if (selectedLocationId) query = query.eq("location_id", selectedLocationId)
  if (resolvedSearchParams?.confidence) query = query.eq("confidence", resolvedSearchParams.confidence)
  if (resolvedSearchParams?.severity) query = query.eq("severity", resolvedSearchParams.severity)

  const sourceFilter = resolvedSearchParams?.source
  if (sourceFilter === "events") query = query.like("insight_type", "events.%")
  else if (sourceFilter === "seo") query = query.like("insight_type", "seo_%")
  else if (sourceFilter === "competitors") {
    query = query.not("insight_type", "like", "events.%")
    query = query.not("insight_type", "like", "seo_%")
  }

  const { data: insights } = await query
  const error = resolvedSearchParams?.error

  // -------------------------------------------------------------------------
  // Location details
  // -------------------------------------------------------------------------

  const selectedLocation = locations?.find((l) => l.id === selectedLocationId) ?? null
  let locationRating: number | null = null
  let locationReviewCount: number | null = null

  if (selectedLocation?.primary_place_id) {
    try {
      const details = await fetchPlaceDetails(selectedLocation.primary_place_id)
      locationRating = typeof details.rating === "number" ? details.rating : null
      locationReviewCount = typeof details.userRatingCount === "number" ? details.userRatingCount : null
    } catch {
      // silently skip
    }
  }

  // -------------------------------------------------------------------------
  // Competitor + snapshot data (for charts)
  // -------------------------------------------------------------------------

  const { data: competitors } = selectedLocationId
    ? await supabase
        .from("competitors")
        .select("id, name, category, metadata")
        .eq("location_id", selectedLocationId)
        .eq("is_active", true)
    : { data: [] }

  const competitorIds = competitors?.map((c) => c.id) ?? []
  const { data: snapshots } = competitorIds.length > 0
    ? await supabase
        .from("snapshots")
        .select("competitor_id, date_key, raw_data")
        .in("competitor_id", competitorIds)
        .gte("date_key", startDate)
    : { data: [] }

  const snapshotRows = snapshots ?? []

  // Build latest snapshot per competitor
  const latestByCompetitor = new Map<string, NormalizedSnapshot>()
  const latestDateByCompetitor = new Map<string, string>()
  for (const snap of snapshotRows) {
    const cur = latestDateByCompetitor.get(snap.competitor_id)
    if (!cur || snap.date_key > cur) {
      latestDateByCompetitor.set(snap.competitor_id, snap.date_key)
      latestByCompetitor.set(snap.competitor_id, snap.raw_data as NormalizedSnapshot)
    }
  }

  // Rating comparison data
  const ratingComparison = [
    ...(selectedLocation?.name
      ? [{ name: selectedLocation.name, rating: locationRating, reviewCount: locationReviewCount }]
      : []),
    ...(competitors ?? []).map((c) => {
      const snap = latestByCompetitor.get(c.id)
      const meta = c.metadata as Record<string, unknown> | null
      const pd = meta?.placeDetails as Record<string, unknown> | null
      return {
        name: c.name ?? "Competitor",
        rating: snap?.profile?.rating ?? (pd?.rating as number | null) ?? (meta?.rating as number | null) ?? null,
        reviewCount: snap?.profile?.reviewCount ?? (pd?.reviewCount as number | null) ?? (meta?.reviewCount as number | null) ?? null,
        priceLevel: snap?.profile?.priceLevel ?? (pd?.priceLevel as string | null) ?? null,
        primaryType: (pd?.primaryType as string | null) ?? (c.category ?? null),
        hoursDays: snap?.hours ? Object.keys(snap.hours).length : pd?.regularOpeningHours ? Object.keys(pd.regularOpeningHours as Record<string, unknown>).length : null,
      }
    }),
  ]

  // Review growth
  const baselineByCompetitor = new Map<string, NormalizedSnapshot>()
  const baselineDateByCompetitor = new Map<string, string>()
  for (const snap of snapshotRows) {
    const cur = baselineDateByCompetitor.get(snap.competitor_id)
    if (!cur || snap.date_key < cur) {
      baselineDateByCompetitor.set(snap.competitor_id, snap.date_key)
      baselineByCompetitor.set(snap.competitor_id, snap.raw_data as NormalizedSnapshot)
    }
  }

  const reviewGrowthDelta = (competitors ?? []).map((c) => {
    const latest = latestByCompetitor.get(c.id)
    const baseline = baselineByCompetitor.get(c.id)
    const delta = typeof latest?.profile?.reviewCount === "number" && typeof baseline?.profile?.reviewCount === "number"
      ? latest.profile.reviewCount - baseline.profile.reviewCount : null
    return { name: c.name ?? "Competitor", delta }
  })

  const reviewCountComparison = ratingComparison.filter((i) => i.name).map((i) => ({
    name: i.name, rating: i.rating ?? null, reviewCount: i.reviewCount ?? null,
  }))

  // Sentiment
  const sentimentCounts = { positive: 0, negative: 0, mixed: 0 }
  const themeInsights = insights?.filter((i) => i.insight_type === "review_themes") ?? []
  for (const ins of themeInsights) {
    const ev = ins.evidence as Record<string, unknown>
    const counts = ev?.sentimentCounts as { positive?: number; negative?: number; mixed?: number } | undefined
    if (counts) {
      sentimentCounts.positive += counts.positive ?? 0
      sentimentCounts.negative += counts.negative ?? 0
      sentimentCounts.mixed += counts.mixed ?? 0
    } else {
      const themes = (ev?.themes as Array<Record<string, unknown>> | undefined) ?? []
      for (const t of themes) {
        const s = t.sentiment as string | undefined
        if (s === "positive") sentimentCounts.positive += 1
        else if (s === "negative") sentimentCounts.negative += 1
        else sentimentCounts.mixed += 1
      }
    }
  }

  // KPIs
  const avgCompetitorRating = (() => {
    const ratings = ratingComparison.filter((i) => i.name !== selectedLocation?.name).map((i) => i.rating).filter((v): v is number => typeof v === "number")
    if (!ratings.length) return null
    return Number((ratings.reduce((s, v) => s + v, 0) / ratings.length).toFixed(2))
  })()

  const compReviewTotal = ratingComparison.filter((i) => i.name !== selectedLocation?.name).map((i) => i.reviewCount).filter((v): v is number => typeof v === "number").reduce((s, v) => s + v, 0)
  const locReviewTotal = typeof locationReviewCount === "number" ? locationReviewCount : 0
  const reviewShare = locReviewTotal + compReviewTotal > 0
    ? Number(((locReviewTotal / (locReviewTotal + compReviewTotal)) * 100).toFixed(1)) : null

  // -------------------------------------------------------------------------
  // Build competitor name map for subject labels
  // -------------------------------------------------------------------------

  const competitorNameMap = new Map<string, string>()
  for (const c of competitors ?? []) {
    competitorNameMap.set(c.id, c.name ?? "Competitor")
  }

  // -------------------------------------------------------------------------
  // Summary counts for banner
  // -------------------------------------------------------------------------

  const allInsights = insights ?? []
  const eventInsightCount = allInsights.filter((i) => (i.insight_type as string).startsWith("events.")).length
  const seoInsightCount = allInsights.filter((i) => (i.insight_type as string).startsWith("seo_")).length
  const compInsightCount = allInsights.filter((i) => !(i.insight_type as string).startsWith("events.") && !(i.insight_type as string).startsWith("seo_") && i.competitor_id).length
  const locInsightCount = allInsights.filter((i) => !(i.insight_type as string).startsWith("events.") && !(i.insight_type as string).startsWith("seo_") && !i.competitor_id).length

  // Group by date for separators
  const insightsByDate = new Map<string, typeof allInsights>()
  for (const ins of allInsights) {
    const dk = ins.date_key as string
    const arr = insightsByDate.get(dk) ?? []
    arr.push(ins)
    insightsByDate.set(dk, arr)
  }
  const sortedDates = Array.from(insightsByDate.keys()).sort((a, b) => (a > b ? -1 : 1))

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <section className="space-y-6">
      {/* Header + filters */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Insights</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Changes and opportunities across your competitors and local events.
            </p>
          </div>
          {selectedLocationId && (
            <form action={generateInsightsAction}>
              <input type="hidden" name="location_id" value={selectedLocationId} />
              <button
                type="submit"
                className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Generate insights
              </button>
            </form>
          )}
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {decodeURIComponent(error)}
          </p>
        )}

        {/* Compact filter bar -- auto-navigates on change */}
        <AutoFilterForm
          filters={[
            {
              name: "location_id",
              defaultValue: selectedLocationId ?? "",
              options: (locations ?? []).map((l) => ({ value: l.id, label: l.name ?? "Location" })),
            },
            {
              name: "range",
              defaultValue: resolvedSearchParams?.range ?? "7",
              options: [
                { value: "7", label: "7 days" },
                { value: "30", label: "30 days" },
              ],
            },
            {
              name: "confidence",
              defaultValue: resolvedSearchParams?.confidence ?? "",
              options: [
                { value: "", label: "All confidence" },
                { value: "high", label: "High" },
                { value: "medium", label: "Medium" },
                { value: "low", label: "Low" },
              ],
            },
            {
              name: "severity",
              defaultValue: resolvedSearchParams?.severity ?? "",
              options: [
                { value: "", label: "All severity" },
                { value: "info", label: "Info" },
                { value: "warning", label: "Warning" },
                { value: "critical", label: "Critical" },
              ],
            },
            {
              name: "source",
              defaultValue: resolvedSearchParams?.source ?? "",
              options: [
                { value: "", label: "All sources" },
                { value: "competitors", label: "Competitors" },
                { value: "events", label: "Events" },
                { value: "seo", label: "SEO" },
              ],
            },
          ]}
        />
      </div>

      {/* Summary banner */}
      {allInsights.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          <span className="font-semibold text-slate-800">
            {allInsights.length} insight{allInsights.length !== 1 ? "s" : ""}
          </span>
          {eventInsightCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 font-medium text-violet-700">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
              {eventInsightCount} event{eventInsightCount !== 1 ? "s" : ""}
            </span>
          )}
          {seoInsightCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-700">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
              {seoInsightCount} SEO
            </span>
          )}
          {compInsightCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {compInsightCount} competitor
            </span>
          )}
          {locInsightCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
              {locInsightCount} location
            </span>
          )}
        </div>
      )}

      {/* Charts dashboard */}
      {selectedLocationId && (
        <InsightsDashboard
          ratingComparison={ratingComparison}
          reviewGrowthDelta={reviewGrowthDelta}
          sentimentCounts={sentimentCounts}
          reviewCountComparison={reviewCountComparison}
          avgCompetitorRating={avgCompetitorRating}
          locationRating={locationRating}
          reviewShare={reviewShare}
        />
      )}

      {/* Location summary banner */}
      {selectedLocation && (
        <div className="flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50/50 px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100">
            <svg className="h-4 w-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-indigo-900">{selectedLocation.name}</p>
            <p className="text-xs text-indigo-700">
              {locationRating ? `${locationRating.toFixed(1)} stars` : ""}
              {locationRating && locationReviewCount ? " · " : ""}
              {locationReviewCount ? `${locationReviewCount.toLocaleString()} reviews` : ""}
              {!locationRating && !locationReviewCount ? "Your location of interest" : ""}
            </p>
          </div>
        </div>
      )}

      {/* Unified insight feed */}
      {sortedDates.length > 0 ? (
        <div className="space-y-4">
          {sortedDates.map((dateKey) => {
            const dayInsights = insightsByDate.get(dateKey) ?? []
            const dateLabel = (() => {
              try {
                return new Date(dateKey + "T12:00:00Z").toLocaleDateString("en-US", {
                  weekday: "long", month: "short", day: "numeric",
                })
              } catch { return dateKey }
            })()

            return (
              <div key={dateKey}>
                {/* Date separator */}
                <div className="mb-3 flex items-center gap-3">
                  <span className="text-xs font-semibold text-slate-400">{dateLabel}</span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>

                <div className="space-y-3">
                  {dayInsights.map((insight) => {
                    const isEvent = (insight.insight_type as string).startsWith("events.")
                    const isSeo = (insight.insight_type as string).startsWith("seo_")
                    const accent: "event" | "competitor" | "location" = isEvent
                      ? "event"
                      : isSeo
                        ? "location"
                        : insight.competitor_id
                          ? "competitor"
                          : "location"
                    const subjectLabel = isEvent
                      ? "Local events"
                      : isSeo
                        ? "Search visibility"
                        : insight.competitor_id
                        ? competitorNameMap.get(insight.competitor_id) ?? "Competitor"
                        : selectedLocation?.name ?? "Your location"

                    return (
                      <InsightCard
                        key={insight.id}
                        title={insight.title}
                        summary={insight.summary}
                        insightType={insight.insight_type as string}
                        confidence={insight.confidence}
                        severity={insight.severity}
                        status={insight.status}
                        evidence={insight.evidence as Record<string, unknown>}
                        recommendations={insight.recommendations as Array<Record<string, unknown>>}
                        subjectLabel={subjectLabel}
                        accent={accent}
                        actions={
                          <>
                            <form action={markInsightReadAction}>
                              <input type="hidden" name="insight_id" value={insight.id} />
                              <button
                                type="submit"
                                className="rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                                title="Mark read"
                              >
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                </svg>
                              </button>
                            </form>
                            <form action={dismissInsightAction}>
                              <input type="hidden" name="insight_id" value={insight.id} />
                              <button
                                type="submit"
                                className="rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                                title="Dismiss"
                              >
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </form>
                          </>
                        }
                      />
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm text-slate-500">
            No insights yet. Generate insights or fetch events to see changes and opportunities here.
          </p>
        </div>
      )}
    </section>
  )
}
