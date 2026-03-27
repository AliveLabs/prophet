import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import LocationFilter from "@/components/ui/location-filter"
import JobRefreshButton from "@/components/ui/job-refresh-button"
import SocialDashboard from "@/components/insights/social-dashboard"
import SocialPostsGrid from "@/components/insights/social-posts-grid"
import InsightFeed, { type FeedInsight } from "@/components/insights/insight-feed"
import { scoreInsights, type InsightPreference } from "@/lib/insights/scoring"
import { fetchSocialPageData } from "@/lib/cache/social"
import { fetchSocialDashboardData } from "./actions"
import SocialHandleSection from "./handle-section"

type SocialPageProps = {
  searchParams?: Promise<{
    location_id?: string
    error?: string
  }>
}

export default async function SocialPage({ searchParams }: SocialPageProps) {
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
    .select("id, name")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })

  const resolvedParams = await Promise.resolve(searchParams)
  const requestedLocationId = resolvedParams?.location_id ?? null
  const selectedLocationId = (requestedLocationId && locations?.some((l: { id: string }) => l.id === requestedLocationId))
    ? requestedLocationId
    : locations?.[0]?.id ?? null
  const selectedLocation = locations?.find((l) => l.id === selectedLocationId) ?? null

  // -------------------------------------------------------------------------
  // Parallel fetch: social dashboard data + cached insights/preferences
  // -------------------------------------------------------------------------

  const [socialData, cached] = await Promise.all([
    selectedLocationId
      ? fetchSocialDashboardData(selectedLocationId)
      : Promise.resolve({ profiles: [], handles: [], topPosts: [] }),
    selectedLocationId
      ? fetchSocialPageData(organizationId, selectedLocationId)
      : Promise.resolve({ insights: [], preferences: [] }),
  ])

  const allInsights = cached.insights
  const preferences: InsightPreference[] = cached.preferences

  // -------------------------------------------------------------------------
  // Score insights
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

  const sortedInsights = [...allInsights].sort((a, b) => {
    const sa = scoredMap.get(a.id)?.relevanceScore ?? 0
    const sb = scoredMap.get(b.id)?.relevanceScore ?? 0
    return sb - sa
  })

  const feedInsights: FeedInsight[] = sortedInsights.map((insight) => {
    const scored = scoredMap.get(insight.id)
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
      subjectLabel: selectedLocation?.name ?? "Your location",
      dateKey: insight.date_key as string,
    }
  })

  // -------------------------------------------------------------------------
  // KPI calculations
  // -------------------------------------------------------------------------

  const locProfiles = socialData.profiles.filter((p) => p.entityType === "location")
  const compProfiles = socialData.profiles.filter((p) => p.entityType === "competitor")
  const totalFollowers = locProfiles.reduce((s, p) => s + p.followerCount, 0)
  const avgEngagement = locProfiles.length > 0
    ? locProfiles.reduce((s, p) => s + p.engagementRate, 0) / locProfiles.length
    : 0
  const platformCount = new Set(socialData.profiles.map((p) => p.platform)).size

  const baseParams: Record<string, string> = {}
  if (selectedLocationId) baseParams.location_id = selectedLocationId

  // -------------------------------------------------------------------------
  // Group handles by entity for HandleManager
  // -------------------------------------------------------------------------

  const handlesByEntity = new Map<string, typeof socialData.handles>()
  for (const h of socialData.handles) {
    const key = `${h.entityType}:${h.entityId}`
    const arr = handlesByEntity.get(key) ?? []
    arr.push(h)
    handlesByEntity.set(key, arr)
  }

  const locationHandles = socialData.handles.filter((h) => h.entityType === "location")
  const competitorHandleGroups = Array.from(handlesByEntity.entries())
    .filter(([key]) => key.startsWith("competitor:"))
    .map(([, handles]) => handles)

  return (
    <section className="space-y-5">
      {/* Filter + Actions Bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
        {locations && locations.length > 1 && selectedLocationId && (
          <LocationFilter
            locations={(locations ?? []).map((l) => ({ id: l.id, name: l.name ?? "Location" }))}
            selectedLocationId={selectedLocationId}
          />
        )}
        {selectedLocationId && (
          <JobRefreshButton
            type="social"
            locationId={selectedLocationId}
            label="Fetch Social Data"
            pendingLabel="Fetching social data"
          />
        )}
      </div>

      {/* KPI Cards */}
      {socialData.profiles.length > 0 && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-lg border border-border bg-card px-5 py-4">
            <p className="text-[11.5px] font-medium text-muted-foreground">Total Followers</p>
            <p className="mt-2 font-display text-[34px] font-semibold leading-none tracking-tight text-foreground">{formatNumber(totalFollowers)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{locProfiles.length} profile{locProfiles.length !== 1 ? "s" : ""}</p>
          </div>
          <div className="rounded-lg border border-border bg-card px-5 py-4">
            <p className="text-[11.5px] font-medium text-muted-foreground">Avg Engagement Rate</p>
            <p className="mt-2 font-display text-[34px] font-semibold leading-none tracking-tight text-primary">{avgEngagement.toFixed(1)}%</p>
            <p className="mt-1 text-[11px] text-muted-foreground">across your profiles</p>
          </div>
          <div className="rounded-lg border border-border bg-card px-5 py-4">
            <p className="text-[11.5px] font-medium text-muted-foreground">Platforms Tracked</p>
            <p className="mt-2 font-display text-[34px] font-semibold leading-none tracking-tight text-foreground">{platformCount}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Instagram, Facebook, TikTok</p>
          </div>
          <div className="rounded-lg border border-border bg-card px-5 py-4">
            <p className="text-[11.5px] font-medium text-muted-foreground">Competitor Profiles</p>
            <p className="mt-2 font-display text-[34px] font-semibold leading-none tracking-tight text-foreground">{compProfiles.length}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">being monitored</p>
          </div>
        </div>
      )}

      {/* Handle Management Section */}
      {selectedLocationId && (
        <SocialHandleSection
          locationId={selectedLocationId}
          locationName={selectedLocation?.name ?? "Your location"}
          locationHandles={locationHandles}
          competitorHandleGroups={competitorHandleGroups}
        />
      )}

      {/* Social Dashboard Charts */}
      {socialData.profiles.length > 0 && (
        <SocialDashboard profiles={socialData.profiles} />
      )}

      {/* Top Recent Posts */}
      {socialData.topPosts && socialData.topPosts.length > 0 && (
        <SocialPostsGrid posts={socialData.topPosts} />
      )}

      {/* Social Intelligence Insights */}
      <div className="space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-signal-gold/20 to-signal-gold/10 text-signal-gold">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
            </svg>
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Social Intelligence Insights</h2>
            <p className="text-xs text-muted-foreground">AI-powered analysis of your social presence vs competitors</p>
          </div>
        </div>

        {feedInsights.length > 0 ? (
          <InsightFeed
            insights={feedInsights}
            baseParams={baseParams}
            statusFilter=""
          />
        ) : socialData.profiles.length > 0 ? (
          <div className="rounded-2xl border border-dashed border-signal-gold/30 bg-gradient-to-br from-signal-gold/10 to-signal-gold/5 py-12 text-center">
            <svg className="mx-auto h-10 w-10 text-signal-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
            </svg>
            <p className="mt-3 text-sm font-medium text-foreground">No insights generated yet</p>
            <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
              Insights are generated automatically when you run &quot;Fetch Social Data&quot;.
              The AI analyzes your posts, engagement, and visual content against competitors to surface actionable recommendations.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center">
            <svg className="mx-auto h-12 w-12 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
            </svg>
            <p className="mt-3 text-sm font-medium text-muted-foreground">No social profiles connected yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add your social media handles above or click &quot;Discover Handles&quot; to automatically find profiles
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
