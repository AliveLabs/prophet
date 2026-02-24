import { Suspense } from "react"
import InsightsDashboard from "@/components/insights/insights-dashboard"
import InsightFeed, { type FeedInsight } from "@/components/insights/insight-feed"
import AutoFilterForm from "@/components/filters/auto-filter-form"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import { fetchPlaceDetails } from "@/lib/places/google"
import type { NormalizedSnapshot } from "@/lib/providers/types"
import JobRefreshButton from "@/components/ui/job-refresh-button"
import {
  scoreInsights,
  type InsightPreference,
} from "@/lib/insights/scoring"
import type { InsightForBriefing } from "@/lib/ai/prompts/priority-briefing"
import PriorityBriefingSection from "./priority-briefing-section"
import { BriefingSkeleton } from "@/components/insights/priority-briefing"

type InsightsPageProps = {
  searchParams?: Promise<{
    confidence?: string
    severity?: string
    range?: string
    error?: string
    location_id?: string
    status?: string
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
  if (!organizationId) return null

  const { data: locations } = await supabase
    .from("locations")
    .select("id, name, primary_place_id")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })

  const resolvedSearchParams = await Promise.resolve(searchParams)
  const selectedLocationId = resolvedSearchParams?.location_id ?? locations?.[0]?.id ?? null
  const startDate = getStartDate(resolvedSearchParams?.range)
  const statusFilter = resolvedSearchParams?.status ?? ""
  const selectedLocation = locations?.find((l) => l.id === selectedLocationId) ?? null

  // -------------------------------------------------------------------------
  // Build insight query (must be built before Promise.all)
  // -------------------------------------------------------------------------

  let insightQuery = supabase
    .from("insights")
    .select(
      "id, title, summary, confidence, severity, status, user_feedback, evidence, recommendations, date_key, competitor_id, insight_type"
    )
    .gte("date_key", startDate)
    .order("date_key", { ascending: false })

  if (selectedLocationId) insightQuery = insightQuery.eq("location_id", selectedLocationId)
  if (resolvedSearchParams?.confidence) insightQuery = insightQuery.eq("confidence", resolvedSearchParams.confidence)
  if (resolvedSearchParams?.severity) insightQuery = insightQuery.eq("severity", resolvedSearchParams.severity)

  if (statusFilter === "saved") insightQuery = insightQuery.eq("status", "read")
  else if (statusFilter === "dismissed") insightQuery = insightQuery.eq("status", "dismissed")
  else if (statusFilter === "new") insightQuery = insightQuery.eq("status", "new")
  else insightQuery = insightQuery.neq("status", "dismissed")

  // -------------------------------------------------------------------------
  // Parallel fetch: insights, preferences, place details, competitors
  // -------------------------------------------------------------------------

  const [
    { data: allInsightsRaw },
    { data: prefsRaw },
    placeDetails,
    { data: competitors },
  ] = await Promise.all([
    insightQuery,
    supabase
      .from("insight_preferences")
      .select("insight_type, weight, useful_count, dismissed_count")
      .eq("organization_id", organizationId),
    selectedLocation?.primary_place_id
      ? fetchPlaceDetails(selectedLocation.primary_place_id).catch(() => null)
      : Promise.resolve(null),
    selectedLocationId
      ? supabase.from("competitors").select("id, name, category, metadata").eq("location_id", selectedLocationId).eq("is_active", true)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string; category: string; metadata: unknown }> }),
  ])

  const allInsights = allInsightsRaw ?? []

  const preferences: InsightPreference[] = (prefsRaw ?? []).map((p) => ({
    insight_type: p.insight_type,
    weight: Number(p.weight),
    useful_count: p.useful_count,
    dismissed_count: p.dismissed_count,
  }))

  const locationRating = typeof placeDetails?.rating === "number" ? placeDetails.rating : null
  const locationReviewCount = typeof placeDetails?.userRatingCount === "number" ? placeDetails.userRatingCount : null

  // -------------------------------------------------------------------------
  // Score insights (CPU-only, instant)
  // -------------------------------------------------------------------------

  const scoredMap = new Map(
    scoreInsights(
      allInsights.map((i) => ({
        id: i.id,
        insight_type: i.insight_type as string,
        confidence: i.confidence,
        severity: i.severity,
      })),
      preferences
    ).map((s) => [s.id, s])
  )

  const error = resolvedSearchParams?.error

  // -------------------------------------------------------------------------
  // Snapshots (depends on competitors result)
  // -------------------------------------------------------------------------

  const competitorIds = competitors?.map((c) => c.id) ?? []
  const { data: snapshots } = competitorIds.length > 0
    ? await supabase.from("snapshots").select("competitor_id, date_key, raw_data").in("competitor_id", competitorIds).gte("date_key", startDate)
    : { data: [] }

  const snapshotRows = snapshots ?? []
  const latestByCompetitor = new Map<string, NormalizedSnapshot>()
  const latestDateByCompetitor = new Map<string, string>()
  for (const snap of snapshotRows) {
    const cur = latestDateByCompetitor.get(snap.competitor_id)
    if (!cur || snap.date_key > cur) {
      latestDateByCompetitor.set(snap.competitor_id, snap.date_key)
      latestByCompetitor.set(snap.competitor_id, snap.raw_data as NormalizedSnapshot)
    }
  }

  const ratingComparison = [
    ...(selectedLocation?.name ? [{ name: selectedLocation.name, rating: locationRating, reviewCount: locationReviewCount }] : []),
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

  const sentimentCounts = { positive: 0, negative: 0, mixed: 0 }
  const themeInsights = allInsights.filter((i) => i.insight_type === "review_themes")
  for (const ins of themeInsights) {
    const ev = ins.evidence as Record<string, unknown>
    const counts = ev?.sentimentCounts as { positive?: number; negative?: number; mixed?: number } | undefined
    if (counts) {
      sentimentCounts.positive += counts.positive ?? 0
      sentimentCounts.negative += counts.negative ?? 0
      sentimentCounts.mixed += counts.mixed ?? 0
    } else {
      for (const t of ((ev?.themes as Array<Record<string, unknown>>) ?? [])) {
        const s = t.sentiment as string | undefined
        if (s === "positive") sentimentCounts.positive += 1
        else if (s === "negative") sentimentCounts.negative += 1
        else sentimentCounts.mixed += 1
      }
    }
  }

  const avgCompetitorRating = (() => {
    const ratings = ratingComparison.filter((i) => i.name !== selectedLocation?.name).map((i) => i.rating).filter((v): v is number => typeof v === "number")
    if (!ratings.length) return null
    return Number((ratings.reduce((s, v) => s + v, 0) / ratings.length).toFixed(2))
  })()

  const compReviewTotal = ratingComparison.filter((i) => i.name !== selectedLocation?.name).map((i) => i.reviewCount).filter((v): v is number => typeof v === "number").reduce((s, v) => s + v, 0)
  const locReviewTotal = typeof locationReviewCount === "number" ? locationReviewCount : 0
  const reviewShare = locReviewTotal + compReviewTotal > 0
    ? Number(((locReviewTotal / (locReviewTotal + compReviewTotal)) * 100).toFixed(1)) : null

  const competitorNameMap = new Map<string, string>()
  for (const c of competitors ?? []) {
    competitorNameMap.set(c.id, c.name ?? "Competitor")
  }

  // -------------------------------------------------------------------------
  // Prepare briefing data (passed to Suspense-wrapped component)
  // -------------------------------------------------------------------------

  const insightsForBriefing: InsightForBriefing[] = allInsights.slice(0, 30).map((i) => ({
    insight_type: i.insight_type as string,
    title: i.title,
    summary: i.summary,
    severity: i.severity,
    confidence: i.confidence,
    competitorId: i.competitor_id,
    relevanceScore: scoredMap.get(i.id)?.relevanceScore ?? 0,
  }))

  // -------------------------------------------------------------------------
  // Serialize insights for client-side feed (sorted by relevance)
  // -------------------------------------------------------------------------

  const sortedInsights = [...allInsights].sort((a, b) => {
    const sa = scoredMap.get(a.id)?.relevanceScore ?? 0
    const sb = scoredMap.get(b.id)?.relevanceScore ?? 0
    return sb - sa
  })

  const feedInsights: FeedInsight[] = sortedInsights.map((insight) => {
    const scored = scoredMap.get(insight.id)
    const subjectLabel = (insight.insight_type as string).startsWith("events.")
      ? "Local events"
      : (insight.insight_type as string).startsWith("seo_")
        ? "Search visibility"
        : insight.competitor_id
          ? competitorNameMap.get(insight.competitor_id) ?? "Competitor"
          : selectedLocation?.name ?? "Your location"

    return {
      id: insight.id,
      title: insight.title,
      summary: insight.summary,
      insightType: insight.insight_type as string,
      competitorId: insight.competitor_id,
      confidence: insight.confidence,
      severity: insight.severity,
      status: insight.status,
      userFeedback: (insight.user_feedback as string | null) ?? null,
      relevanceScore: scored?.relevanceScore ?? 0,
      urgencyLevel: scored?.urgencyLevel ?? "info",
      suppressed: scored?.suppressed ?? false,
      evidence: insight.evidence as Record<string, unknown>,
      recommendations: insight.recommendations as Array<Record<string, unknown>>,
      subjectLabel,
      dateKey: insight.date_key as string,
    }
  })

  const baseParams: Record<string, string> = {}
  if (selectedLocationId) baseParams.location_id = selectedLocationId
  if (resolvedSearchParams?.range) baseParams.range = resolvedSearchParams.range
  if (resolvedSearchParams?.confidence) baseParams.confidence = resolvedSearchParams.confidence
  if (resolvedSearchParams?.severity) baseParams.severity = resolvedSearchParams.severity
  if (statusFilter) baseParams.status = statusFilter

  // Cache key components for the briefing
  const latestDateKey = allInsights[0]?.date_key as string | undefined
  const briefingCacheKey = selectedLocationId
    ? `${selectedLocationId}:${allInsights.length}:${latestDateKey ?? "none"}`
    : null

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <section className="space-y-6">
      {/* Hero Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-blue-600 to-cyan-600 p-6 text-white shadow-xl shadow-indigo-200/50">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-10 -left-10 h-40 w-40 rounded-full bg-white/5" />

        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                </svg>
              </div>
              <h1 className="text-xl font-bold tracking-tight">Insights</h1>
            </div>
            <p className="max-w-md text-sm text-white/70">
              Changes and opportunities across competitors, events, SEO, and content for{" "}
              <span className="font-medium text-white/90">{selectedLocation?.name ?? "your locations"}</span>.
            </p>
          </div>

          {selectedLocationId && (
            <JobRefreshButton
              type="insights"
              locationId={selectedLocationId}
              label="Generate insights"
              pendingLabel="Generating insights"
              className="!bg-white/15 !text-white backdrop-blur-sm hover:!bg-white/25"
            />
          )}
        </div>

        {/* Filters */}
        <div className="relative mt-5">
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
                name: "severity",
                defaultValue: resolvedSearchParams?.severity ?? "",
                options: [
                  { value: "", label: "All severity" },
                  { value: "critical", label: "Critical" },
                  { value: "warning", label: "Warning" },
                  { value: "info", label: "Info" },
                ],
              },
              {
                name: "status",
                defaultValue: statusFilter,
                options: [
                  { value: "", label: "New + Saved" },
                  { value: "new", label: "New only" },
                  { value: "saved", label: "Saved" },
                  { value: "dismissed", label: "Dismissed" },
                ],
              },
            ]}
          />
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {decodeURIComponent(error)}
        </div>
      )}

      {/* Priority Briefing -- streamed via Suspense, never blocks page */}
      {allInsights.length > 0 && (
        <Suspense fallback={<BriefingSkeleton />}>
          <PriorityBriefingSection
            insights={insightsForBriefing}
            preferences={preferences}
            locationName={selectedLocation?.name ?? "Your location"}
            cacheKey={briefingCacheKey}
          />
        </Suspense>
      )}

      {/* Charts Dashboard */}
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

      {/* Client-side tabs + insight feed (instant tab switching) */}
      <InsightFeed
        insights={feedInsights}
        baseParams={baseParams}
        statusFilter={statusFilter}
        preferencesCount={preferences.length}
      />
    </section>
  )
}
