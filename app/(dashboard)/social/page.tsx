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
  const selectedLocationId = resolvedParams?.location_id ?? locations?.[0]?.id ?? null
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
    <section className="space-y-6">
      {/* Hero Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-600 p-6 text-white shadow-xl shadow-indigo-200/50">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-10 -left-10 h-40 w-40 rounded-full bg-white/5" />

        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                </svg>
              </div>
              <h1 className="text-xl font-bold tracking-tight">Social Intelligence</h1>
            </div>
            <p className="max-w-md text-sm text-white/70">
              Track and compare social media presence across Instagram, Facebook &amp; TikTok for{" "}
              <span className="font-medium text-white/90">
                {selectedLocation?.name ?? "your locations"}
              </span>
            </p>
          </div>

          <div className="flex items-center gap-3">
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
                className="!bg-white/15 !text-white backdrop-blur-sm hover:!bg-white/25"
              />
            )}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      {socialData.profiles.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-slate-500">Total Followers</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{formatNumber(totalFollowers)}</p>
            <p className="mt-1 text-[11px] text-slate-400">{locProfiles.length} profile{locProfiles.length !== 1 ? "s" : ""}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-slate-500">Avg Engagement Rate</p>
            <p className="mt-2 text-3xl font-bold text-indigo-600">{avgEngagement.toFixed(1)}%</p>
            <p className="mt-1 text-[11px] text-slate-400">across your profiles</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-slate-500">Platforms Tracked</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{platformCount}</p>
            <p className="mt-1 text-[11px] text-slate-400">Instagram, Facebook, TikTok</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-slate-500">Competitor Profiles</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{compProfiles.length}</p>
            <p className="mt-1 text-[11px] text-slate-400">being monitored</p>
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

      {/* Social Insights Feed */}
      {feedInsights.length > 0 ? (
        <InsightFeed
          insights={feedInsights}
          baseParams={baseParams}
          statusFilter=""
          preferencesCount={preferences.length}
        />
      ) : socialData.profiles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center">
          <svg className="mx-auto h-12 w-12 text-indigo-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
          </svg>
          <p className="mt-3 text-sm font-medium text-slate-600">No social profiles connected yet</p>
          <p className="mt-1 text-xs text-slate-400">
            Add your social media handles above or click &quot;Discover Handles&quot; to automatically find profiles
          </p>
        </div>
      ) : null}
    </section>
  )
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
