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
import type { InsightForBriefing, BusinessContext } from "@/lib/ai/prompts/priority-briefing"
import PriorityBriefingSection from "./priority-briefing-section"
import { BriefingSkeleton } from "@/components/insights/priority-briefing"
import WeatherBadge from "@/components/insights/weather-badge"
import PhotoGallery from "@/components/insights/photo-gallery"
import TrafficChart from "@/components/insights/traffic-chart"
import SocialDashboard from "@/components/insights/social-dashboard"
import { fetchSocialDashboardData } from "./social-actions"
import { fetchInsightsPageData } from "@/lib/insights/cached-data"

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
  const requestedLocationId = resolvedSearchParams?.location_id ?? null
  const selectedLocationId = (requestedLocationId && locations?.some((l: { id: string }) => l.id === requestedLocationId))
    ? requestedLocationId
    : locations?.[0]?.id ?? null
  const startDate = getStartDate(resolvedSearchParams?.range)
  const statusFilter = resolvedSearchParams?.status ?? ""
  const selectedLocation = locations?.find((l) => l.id === selectedLocationId) ?? null

  // -------------------------------------------------------------------------
  // Fetch cached data (insights, preferences, competitors, snapshots, etc.)
  // -------------------------------------------------------------------------

  const [cachedData, placeDetails] = await Promise.all([
    selectedLocationId
      ? fetchInsightsPageData(
          organizationId,
          selectedLocationId,
          startDate,
          statusFilter,
          resolvedSearchParams?.confidence ?? "",
          resolvedSearchParams?.severity ?? "",
        )
      : Promise.resolve({ insights: [], preferences: [], competitors: [], snapshots: [], weather: [], photos: [], busyTimes: [] }),
    selectedLocation?.primary_place_id
      ? fetchPlaceDetails(selectedLocation.primary_place_id).catch(() => null)
      : Promise.resolve(null),
  ])

  const allInsights = cachedData.insights
  const competitors = cachedData.competitors

  const preferences: InsightPreference[] = cachedData.preferences

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
  // Snapshots (from cached data)
  // -------------------------------------------------------------------------

  const snapshotRows = cachedData.snapshots
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
    ...competitors.map((c) => {
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

  const reviewGrowthDelta = competitors.map((c) => {
    const latest = latestByCompetitor.get(c.id)
    const baseline = baselineByCompetitor.get(c.id)
    const delta = typeof latest?.profile?.reviewCount === "number" && typeof baseline?.profile?.reviewCount === "number"
      ? latest.profile.reviewCount - baseline.profile.reviewCount : null
    return { name: c.name ?? "Competitor", delta }
  })

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
  for (const c of competitors) {
    competitorNameMap.set(c.id, c.name ?? "Competitor")
  }

  // -------------------------------------------------------------------------
  // Prepare briefing data (passed to Suspense-wrapped component)
  // -------------------------------------------------------------------------

  function extractEvidenceHighlights(evidence: Record<string, unknown>, insightType: string): string {
    const parts: string[] = []
    try {
      if (insightType.startsWith("menu.") || insightType.startsWith("content.")) {
        if (evidence.locationAvgPrice) parts.push(`Your avg: $${evidence.locationAvgPrice}`)
        if (evidence.competitorAvgPrice) parts.push(`Competitor avg: $${evidence.competitorAvgPrice}`)
        if (evidence.missingCategory) parts.push(`Missing: ${evidence.missingCategory}`)
        if (evidence.competitor) parts.push(`vs ${evidence.competitor}`)
      } else if (insightType.startsWith("seo_") || insightType.startsWith("cross_")) {
        if (evidence.keyword_gain) parts.push(`+${evidence.keyword_gain} keywords`)
        if (evidence.traffic_growth_pct) parts.push(`+${evidence.traffic_growth_pct}% traffic`)
        if (evidence.current_keywords) parts.push(`${evidence.current_keywords} total keywords`)
        if (evidence.review_count) parts.push(`${evidence.review_count} reviews`)
      } else if (insightType.includes("weather")) {
        if (evidence.condition) parts.push(`${evidence.condition}`)
        if (evidence.temp_high_f) parts.push(`${evidence.temp_high_f}°F`)
      } else if (insightType.includes("traffic")) {
        if (evidence.peak_hour != null) parts.push(`Peak: ${evidence.peak_hour}:00`)
        if (evidence.peak_score) parts.push(`Score: ${evidence.peak_score}`)
      } else {
        if (evidence.competitor_name || evidence.competitor) parts.push(`${evidence.competitor_name ?? evidence.competitor}`)
        if (typeof evidence.rating === "number") parts.push(`Rating: ${evidence.rating}`)
        if (typeof evidence.reviewCount === "number") parts.push(`${evidence.reviewCount} reviews`)
      }
    } catch { /* non-fatal */ }
    return parts.join(", ").slice(0, 200)
  }

  const insightsForBriefing: InsightForBriefing[] = allInsights.slice(0, 30).map((i) => ({
    insight_type: i.insight_type as string,
    title: i.title,
    summary: i.summary,
    severity: i.severity,
    confidence: i.confidence,
    competitorId: i.competitor_id,
    relevanceScore: scoredMap.get(i.id)?.relevanceScore ?? 0,
    evidenceHighlights: extractEvidenceHighlights(
      (i.evidence as Record<string, unknown>) ?? {},
      i.insight_type as string
    ),
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

  // -------------------------------------------------------------------------
  // Signal data from cached result: weather, photos, busy times
  // -------------------------------------------------------------------------

  const todayDate = new Date().toISOString().slice(0, 10)

  const latestWeather = cachedData.weather.find(w => w.date === todayDate) ?? cachedData.weather[0] ?? null
  const weatherForBadge = latestWeather ? {
    date: latestWeather.date,
    temp_high_f: latestWeather.temp_high_f ?? 0,
    temp_low_f: latestWeather.temp_low_f ?? 0,
    weather_condition: latestWeather.weather_condition ?? "Unknown",
    weather_icon: latestWeather.weather_icon ?? "01d",
    precipitation_in: latestWeather.precipitation_in ?? 0,
    is_severe: latestWeather.is_severe,
  } : null

  const photoItems = cachedData.photos.map(p => {
    const analysis = p.analysis_result as Record<string, unknown> | null
    return {
      id: p.id,
      image_url: p.image_url,
      category: (analysis?.category as string) ?? "other",
      subcategory: (analysis?.subcategory as string) ?? "",
      tags: (analysis?.tags as string[]) ?? [],
      extracted_text: (analysis?.extracted_text as string) ?? "",
      promotional_content: (analysis?.promotional_content as boolean) ?? false,
      confidence: (analysis?.confidence as number) ?? 0,
      competitor_name: competitorNameMap.get(p.competitor_id) ?? "Competitor",
    }
  })

  const trafficByCompetitor = new Map<string, Array<{ day_of_week: number; hourly_scores: number[]; peak_hour: number; peak_score: number; typical_time_spent: string | null }>>()
  for (const bt of cachedData.busyTimes) {
    const arr = trafficByCompetitor.get(bt.competitor_id) ?? []
    arr.push({
      day_of_week: bt.day_of_week,
      hourly_scores: bt.hourly_scores,
      peak_hour: bt.peak_hour ?? 0,
      peak_score: bt.peak_score ?? 0,
      typical_time_spent: bt.typical_time_spent,
    })
    trafficByCompetitor.set(bt.competitor_id, arr)
  }

  const trafficData = [...trafficByCompetitor.entries()].map(([compId, days]) => ({
    competitor_id: compId,
    competitor_name: competitorNameMap.get(compId) ?? "Competitor",
    days,
  }))

  // -------------------------------------------------------------------------
  // Extract review excerpts from review_themes insights
  // -------------------------------------------------------------------------

  const recentReviews: Array<{
    rating?: number
    text?: string
    author?: string
    date?: string
    competitorName?: string
  }> = []

  for (const ins of themeInsights) {
    const ev = ins.evidence as Record<string, unknown>
    const samples = ev?.sampleReviews as Array<{ rating?: number; text?: string; author?: string; date?: string }> | undefined
    const compName = ins.competitor_id ? competitorNameMap.get(ins.competitor_id) : undefined
    if (samples) {
      for (const review of samples) {
        if (review.text) {
          recentReviews.push({ ...review, competitorName: compName })
        }
      }
    }
  }

  const baseParams: Record<string, string> = {}
  if (selectedLocationId) baseParams.location_id = selectedLocationId
  if (resolvedSearchParams?.range) baseParams.range = resolvedSearchParams.range
  if (resolvedSearchParams?.confidence) baseParams.confidence = resolvedSearchParams.confidence
  if (resolvedSearchParams?.severity) baseParams.severity = resolvedSearchParams.severity
  if (statusFilter) baseParams.status = statusFilter

  // -------------------------------------------------------------------------
  // Fetch social media intelligence data
  // -------------------------------------------------------------------------
  const socialData = selectedLocationId
    ? await fetchSocialDashboardData(selectedLocationId)
    : { profiles: [], handles: [] }

  // Cache key components for the briefing
  const latestDateKey = allInsights[0]?.date_key as string | undefined
  const briefingCacheKey = selectedLocationId
    ? `${selectedLocationId}:${allInsights.length}:${latestDateKey ?? "none"}`
    : null

  // Build rich business context for the priority briefing
  const briefingContext: BusinessContext = {
    locationRating: locationRating,
    locationReviewCount: locationReviewCount,
    competitorCount: competitors.length,
    weatherSummary: weatherForBadge
      ? `${weatherForBadge.weather_condition}, High ${Math.round(weatherForBadge.temp_high_f)}°F / Low ${Math.round(weatherForBadge.temp_low_f)}°F${weatherForBadge.precipitation_in > 0 ? `, ${weatherForBadge.precipitation_in.toFixed(2)}" precipitation` : ""}${weatherForBadge.is_severe ? " (SEVERE)" : ""}`
      : null,
    trafficSummary: (() => {
      if (trafficData.length === 0) return null
      const allDays = trafficData.flatMap((t) => t.days)
      if (allDays.length === 0) return null
      const peakDay = allDays.reduce((best, d) => (d.peak_score > best.peak_score ? d : best), allDays[0])
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
      return `Peak traffic: ${dayNames[peakDay.day_of_week]} at ${peakDay.peak_hour}:00 (score: ${peakDay.peak_score}/100). Tracking ${trafficData.length} competitor(s).`
    })(),
    photoSummary: photoItems.length > 0
      ? `${photoItems.length} photos analyzed. Categories: ${[...new Set(photoItems.map((p) => p.category))].slice(0, 4).join(", ")}. ${photoItems.filter((p) => p.promotional_content).length} promotional.`
      : null,
    socialSummary: socialData.profiles.length > 0
      ? (() => {
          const locProfiles = socialData.profiles.filter((p) => p.entityType === "location")
          const compProfiles = socialData.profiles.filter((p) => p.entityType === "competitor")
          const platforms = [...new Set(socialData.profiles.map((p) => p.platform))].join(", ")
          const locFollowers = locProfiles.reduce((s, p) => s + p.followerCount, 0)
          return `Tracking ${socialData.profiles.length} profiles on ${platforms}. Your followers: ${locFollowers.toLocaleString()}. ${compProfiles.length} competitor profiles tracked.`
        })()
      : null,
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <section className="space-y-5">
      {/* Filters + Actions Bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
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
                { value: "", label: "All active" },
                { value: "new", label: "New" },
                { value: "read", label: "Read" },
                { value: "todo", label: "To-Do" },
                { value: "actioned", label: "Done" },
                { value: "snoozed", label: "Snoozed" },
                { value: "dismissed", label: "Dismissed" },
              ],
            },
          ]}
        />
        {selectedLocationId && (
          <JobRefreshButton
            type="insights"
            locationId={selectedLocationId}
            label="Generate insights"
            pendingLabel="Generating insights"
          />
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
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
            context={briefingContext}
          />
        </Suspense>
      )}

      {/* Weather Context Badge */}
      {weatherForBadge && (
        <WeatherBadge weather={weatherForBadge} />
      )}

      {/* Charts Dashboard (competitor analytics) */}
      {selectedLocationId && (
        <InsightsDashboard
          ratingComparison={ratingComparison}
          reviewGrowthDelta={reviewGrowthDelta}
          sentimentCounts={sentimentCounts}
          avgCompetitorRating={avgCompetitorRating}
          locationRating={locationRating}
          reviewShare={reviewShare}
          recentReviews={recentReviews}
        />
      )}

      {/* Social Media Intelligence Dashboard */}
      {socialData.profiles.length > 0 && (
        <SocialDashboard profiles={socialData.profiles} />
      )}

      {/* Busy Times Traffic Chart */}
      {trafficData.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-card p-5">
          <TrafficChart data={trafficData} />
        </div>
      )}

      {/* Client-side tabs + insight feed (instant tab switching) */}
      <InsightFeed
        insights={feedInsights}
        baseParams={baseParams}
        statusFilter={statusFilter}
      />

      {/* Photo Gallery */}
      {photoItems.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-card p-5">
          <PhotoGallery photos={photoItems} />
        </div>
      )}
    </section>
  )
}
