import AutoFilterForm from "@/components/filters/auto-filter-form"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import { fetchPlaceDetails } from "@/lib/places/google"
import type { NormalizedSnapshot } from "@/lib/providers/types"
import {
  scoreInsights,
  type InsightPreference,
} from "@/lib/insights/scoring"
import { fetchSocialDashboardData } from "./social-actions"
import { fetchInsightsPageData } from "@/lib/insights/cached-data"
import { resolveDisplayName } from "../operator-data"
// ── The Pass — kit-rebuilt presentation (page-local; shared components untouched) ──
import { TkSoftPanel, TkTooltipLayer } from "@/components/ticket"
import InsightsPrioritySection from "./insights-priority-section"
import { pickPriorityInsights } from "./insight-row-adapter"
import InsightsGlance, { type GlanceData } from "./insights-glance"
import InsightsFeedKit, { type FeedInsight } from "./insights-feed-kit"
import { recentCutoffDateKey } from "./insights-reveal"
import "./insights.css"

type InsightsPageProps = {
  searchParams?: Promise<{
    confidence?: string
    severity?: string
    range?: string
    error?: string
    location_id?: string
    status?: string
    // ALT-230: opaque JSON viz context carried from a viz-card T-bubble's "Generate
    // insight". Forwarded as a raw string to the client feed; NEVER parsed into the
    // server briefing, so a generated insight can't reach the home/insights hero.
    generate?: string
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
        name: resolveDisplayName(c.display_label, c.name, "Competitor"),
        rating: snap?.profile?.rating ?? (pd?.rating as number | null) ?? (meta?.rating as number | null) ?? null,
        reviewCount: snap?.profile?.reviewCount ?? (pd?.reviewCount as number | null) ?? (meta?.reviewCount as number | null) ?? null,
        priceLevel: snap?.profile?.priceLevel ?? (pd?.priceLevel as string | null) ?? null,
        primaryType: (pd?.primaryType as string | null) ?? (c.category ?? null),
        hoursDays: snap?.hours ? Object.keys(snap.hours).length : pd?.regularOpeningHours ? Object.keys(pd.regularOpeningHours as Record<string, unknown>).length : null,
      }
    }),
  ]

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
    competitorNameMap.set(c.id, resolveDisplayName(c.display_label, c.name, "Competitor"))
  }

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

  // ALT-292: the feed defaults each category to a RECENT WINDOW rather than every
  // insight ever generated (a mature category was showing 6 of 70 behind one button
  // that dumped the other 64 at once). The boundary is resolved here, on the server, so
  // SSR and hydration agree on it and a day rollover can never split the two.
  const recentCutoff = recentCutoffDateKey(todayDate)

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
  // Fetch social media intelligence data
  // -------------------------------------------------------------------------
  const socialData = selectedLocationId
    ? await fetchSocialDashboardData(selectedLocationId)
    : { profiles: [], handles: [] }

  // -------------------------------------------------------------------------
  // Deterministic priority pick (zero model calls — replaces the Priority Briefing).
  // Composed from the SAME scored feed rows the page already has; the picker itself
  // guards the hero-equivalent rules (no user_viz, no suppressed, no cleared rows).
  // Only the default and "new" views carry a priority section: a cleared-status
  // review view should not re-pitch what the operator is reviewing.
  // -------------------------------------------------------------------------

  const priorityInsights =
    !statusFilter || statusFilter === "new" ? pickPriorityInsights(feedInsights) : []

  // -------------------------------------------------------------------------
  // At-a-glance data (HONEST: %-share / counts / "you vs competitor" only).
  // Derived from the same cached data — no invented POS / $ / covers.
  // -------------------------------------------------------------------------

  const newCount = feedInsights.filter((i) => i.status === "new").length

  const trafficPeak = (() => {
    if (trafficData.length === 0) return null
    const allDays = trafficData.flatMap((t) => t.days)
    if (allDays.length === 0) return null
    const peak = allDays.reduce((best, d) => (d.peak_score > best.peak_score ? d : best), allDays[0])
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    return { dayLabel: dayNames[peak.day_of_week] ?? "—", hour: peak.peak_hour }
  })()

  const glanceData: GlanceData = {
    insightCount: feedInsights.length,
    newCount,
    competitorCount: competitors.length,
    locationRating,
    avgCompetitorRating,
    reviewSharePct: reviewShare,
    sentiment:
      sentimentCounts.positive + sentimentCounts.negative + sentimentCounts.mixed > 0
        ? sentimentCounts
        : null,
    weather: weatherForBadge
      ? {
          condition: weatherForBadge.weather_condition,
          hi: weatherForBadge.temp_high_f,
          lo: weatherForBadge.temp_low_f,
          severe: weatherForBadge.is_severe,
        }
      : null,
    trafficPeak,
  }

  // "Still learning" ring: how many live signal streams returned data this sweep,
  // out of the streams we watch (honest coverage proxy, not a faked day-count).
  const streamsPresent = [
    allInsights.length > 0,
    snapshotRows.length > 0,
    cachedData.weather.length > 0,
    photoItems.length > 0,
    trafficData.length > 0,
    socialData.profiles.length > 0,
  ].filter(Boolean).length
  const streamsTotal = 6

  // -------------------------------------------------------------------------
  // Render — rebuilt to The Pass: page chrome → controls → priority briefing
  // (hero) → at-a-glance widgets → the kit insight feed. Social/photo signals
  // surface as feed insights; the dedicated dashboards retire.
  // -------------------------------------------------------------------------

  return (
    <div className="ticket-brief tk-kit">
      <TkTooltipLayer />
      <div className="pv-page">
        <div className="pv-page-head">
          <span className="pv-kicker">{selectedLocation?.name ?? "Your market"}</span>
          <h1 className="pv-h1">Insights</h1>
          <p className="pv-sub">
            Everything we&apos;re seeing across your reviews, competitors, search, social, and foot
            traffic — ranked by fit and grounded in real signal.
          </p>
        </div>

        <div className="ins-page">
          {/* Controls: filters + generate (data wiring unchanged) */}
          <TkSoftPanel className="ins-bar">
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
                  // Keep/Dismiss vocabulary (the Track menu's read/to-do/done/snoozed
                  // splits are retired): "Kept" spans every positive status, legacy
                  // Track-era rows included, so nothing an operator marked disappears.
                  name: "status",
                  defaultValue: statusFilter,
                  options: [
                    { value: "", label: "All active" },
                    { value: "new", label: "New" },
                    { value: "kept", label: "Kept" },
                    { value: "dismissed", label: "Dismissed" },
                    { value: "inaccurate", label: "Reported inaccurate" },
                  ],
                },
              ]}
            />
          </TkSoftPanel>

          {/* Error banner */}
          {error && <div className="ins-error">{decodeURIComponent(error)}</div>}

          {/* Priority — deterministic top picks, composed with zero model calls */}
          {priorityInsights.length > 0 && (
            <InsightsPrioritySection
              insights={priorityInsights}
              locationName={selectedLocation?.name ?? "your location"}
            />
          )}

          {/* At a glance — weighted widget grid (honest %/counts) */}
          {selectedLocationId && feedInsights.length > 0 && <InsightsGlance data={glanceData} />}

          {/* The feed — kit play cards, tabs, board, still-learning empty state */}
          <InsightsFeedKit
            insights={feedInsights}
            statusFilter={statusFilter}
            learningDays={streamsPresent}
            learningTarget={streamsTotal}
            generateRequest={resolvedSearchParams?.generate ?? null}
            recentCutoff={recentCutoff}
          />
        </div>
      </div>
    </div>
  )
}
