import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import LocationFilter from "@/components/ui/location-filter"
import JobRefreshButton from "@/components/ui/job-refresh-button"
import { type FeedInsight } from "@/components/insights/insight-feed"
import { scoreInsights, type InsightPreference } from "@/lib/insights/scoring"
import { fetchSocialPageData } from "@/lib/cache/social"
import { fetchSocialDashboardData } from "./actions"
import SocialHandleSection from "./handle-section"
import {
  RevealOnView,
  TkSectionHead,
  TkSoftPanel,
  TkWidgetGrid,
  TkWidget,
  TkEmptyState,
  TkButton,
  TkTooltipLayer,
} from "@/components/ticket"
import SocialStandingPass from "./social-standing-pass"
import SocialPostsPass from "./social-posts-pass"
import SocialInsightsPass from "./social-insights-pass"
import "./social.css"

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
  // KPI calculations (honest: %/counts only — no invented $/covers)
  // -------------------------------------------------------------------------

  const locProfiles = socialData.profiles.filter((p) => p.entityType === "location")
  const compProfiles = socialData.profiles.filter((p) => p.entityType === "competitor")
  const totalFollowers = locProfiles.reduce((s, p) => s + p.followerCount, 0)
  const avgEngagement = locProfiles.length > 0
    ? locProfiles.reduce((s, p) => s + p.engagementRate, 0) / locProfiles.length
    : 0
  const platformCount = new Set(socialData.profiles.map((p) => p.platform)).size

  // -------------------------------------------------------------------------
  // Group handles by entity for the handle manager
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

  const hasProfiles = socialData.profiles.length > 0
  const visibleInsights = feedInsights.filter(
    (i) => !["dismissed", "snoozed", "inaccurate"].includes(i.status),
  )
  const hasInsights = visibleInsights.length > 0
  const hasPosts = (socialData.topPosts?.length ?? 0) > 0

  return (
    <div className="pv-page">
      <div className="pv-page-head">
        <span className="pv-kicker">Your market</span>
        <h1 className="pv-h1">Social</h1>
        <p className="pv-sub">
          How your accounts and your competitors&apos; show up — followers, engagement, and the posts
          driving it. We frame everything as percentages and &ldquo;you vs them&rdquo;, never guessed
          dollars or covers.
        </p>
      </div>
      <hr className="pv-rule" />

      <div className="sp-body tk-kit">
        <TkTooltipLayer />

        {/* ── Controls ── */}
        {selectedLocationId && (
          <RevealOnView>
            <TkSoftPanel className="sp-controls">
              <div className="sp-controls-left">
                {locations && locations.length > 1 && (
                  <LocationFilter
                    locations={(locations ?? []).map((l) => ({ id: l.id, name: l.name ?? "Location" }))}
                    selectedLocationId={selectedLocationId}
                  />
                )}
              </div>
              <JobRefreshButton
                type="social"
                locationId={selectedLocationId}
                label="Fetch social data"
                pendingLabel="Fetching social data"
              />
            </TkSoftPanel>
          </RevealOnView>
        )}

        {/* ── At a glance (honest widgets) ── */}
        {hasProfiles && (
          <>
            <TkSectionHead
              title="At a glance"
              sub="Your footprint · this week"
              className="sp-sec"
            />
            <RevealOnView>
              <TkWidgetGrid>
                <TkWidget
                  tone="rust"
                  size="wide"
                  label="Your followers"
                  value={formatNumber(totalFollowers)}
                  sub={`across ${locProfiles.length} of your profile${locProfiles.length === 1 ? "" : "s"}`}
                  data-tip="Total followers across the social profiles we track for you"
                  data-tipv={`${formatNumber(totalFollowers)} followers`}
                />
                <TkWidget
                  tone="teal"
                  label="Engagement / post"
                  value={avgEngagement > 0 ? `${avgEngagement.toFixed(1)}%` : "—"}
                  sub={avgEngagement > 0 ? "when you post, on average" : "no posts read yet"}
                  data-tip="Average interactions per post ÷ followers, when you post — not how often you post"
                  data-tipv={avgEngagement > 0 ? `${avgEngagement.toFixed(1)}% engagement` : "not enough data"}
                />
                <TkWidget
                  tone="gold"
                  label="Platforms"
                  value={String(platformCount)}
                  sub="tracked across the set"
                  data-tip="Distinct platforms we read for you and your competitors"
                  data-tipv={`${platformCount} platform${platformCount === 1 ? "" : "s"}`}
                />
                <TkWidget
                  tone="slate"
                  label="Competitors"
                  value={String(compProfiles.length)}
                  sub={compProfiles.length > 0 ? "profiles being watched" : "none watched yet"}
                  data-tip="Competitor social profiles in your watched set"
                  data-tipv={`${compProfiles.length} watched`}
                />
              </TkWidgetGrid>
            </RevealOnView>
          </>
        )}

        {/* ── Standing: platform presence + you vs the set ── */}
        {hasProfiles && (
          <>
            <TkSectionHead
              title="Where you stand"
              sub="Platform presence · you vs your set"
              className="sp-sec"
            />
            <SocialStandingPass profiles={socialData.profiles} />
          </>
        )}

        {/* ── Recent posts (the centerpiece — TkSocialEmbed grid) ── */}
        {hasPosts && (
          <>
            <TkSectionHead
              title="Recent posts"
              sub="Yours and competitors' · engagement as a share of peak"
              className="sp-sec"
            />
            <SocialPostsPass posts={socialData.topPosts ?? []} />
          </>
        )}

        {/* ── Social intelligence (kit cards, learning loop preserved) ── */}
        {hasProfiles && (
          <>
            <TkSectionHead
              title="What it means"
              sub="AI reads of your social presence vs competitors"
              className="sp-sec"
            />
            {hasInsights ? (
              <SocialInsightsPass insights={feedInsights} />
            ) : (
              <TkEmptyState
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <path d="M12 18v-5.25M12 12.75a6 6 0 0 0 1.5-.19m-1.5.19a6 6 0 0 1-1.5-.19m3.75 7.48a12 12 0 0 1-4.5 0m3.75 2.38a14.4 14.4 0 0 1-3 0M14.25 18v-.19c0-.98.66-1.82 1.51-2.32a7.5 7.5 0 1 0-7.52 0c.85.49 1.51 1.33 1.51 2.32V18" />
                  </svg>
                }
                title="No reads yet"
                description="Insights land automatically after a social-data fetch — we line your posts and engagement up against competitors and surface what's worth acting on."
              />
            )}
          </>
        )}

        {/* ── Watched accounts (handle manager) ── */}
        {selectedLocationId && (
          <>
            <TkSectionHead
              id="watched-accounts"
              title="Watched accounts"
              sub="The handles we read for you and your competitors"
              className="sp-sec"
            />
            <RevealOnView>
              <SocialHandleSection
                locationId={selectedLocationId}
                locationName={selectedLocation?.name ?? "Your location"}
                locationHandles={locationHandles}
                competitorHandleGroups={competitorHandleGroups}
              />
            </RevealOnView>
          </>
        )}

        {/* ── First-run: nothing connected yet ── */}
        {selectedLocationId && !hasProfiles && (
          <RevealOnView>
            <TkEmptyState
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path d="M7.22 10.91a2.25 2.25 0 1 0 0 2.18m0-2.18c.18.32.28.7.28 1.09s-.1.77-.28 1.09m0-2.18l9.56-5.31m-9.56 7.5l9.56 5.31m0 0a2.25 2.25 0 1 0 3.94 2.19 2.25 2.25 0 0 0-3.94-2.19zm0-12.81a2.25 2.25 0 1 0 3.93-2.19 2.25 2.25 0 0 0-3.93 2.19z" />
                </svg>
              }
              title="No social accounts connected yet"
              description="Add the handles you want us to read — your own accounts and the competitors you measure against. Then run a fetch to pull posts and engagement."
              action={
                <div className="sp-cta">
                  <a href="#watched-accounts">
                    <TkButton variant="add">Add handles below</TkButton>
                  </a>
                  <a href="/competitors">
                    <TkButton variant="keep">Manage competitors</TkButton>
                  </a>
                </div>
              }
            />
          </RevealOnView>
        )}
      </div>
    </div>
  )
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
