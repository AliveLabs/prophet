import type { ReactNode } from "react"
import Link from "next/link"
import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import LocationFilter from "@/components/ui/location-filter"
import { type FeedInsight } from "@/components/insights/insight-feed"
import { scoreInsights, type InsightPreference } from "@/lib/insights/scoring"
import { fetchSocialPageData } from "@/lib/cache/social"
import { fetchOwnPhotos } from "@/lib/cache/photos"
import { pickCoverPhoto } from "@/lib/places/listing-audit"
import { fetchSocialDashboardData } from "./actions"
import SocialWatchedAccounts from "./watched-accounts"
import {
  RevealOnView,
  TkSectionHead,
  TkSoftPanel,
  TkWidgetGrid,
  TkWidget,
  TkEmptyState,
  TkButton,
  TkTooltipLayer,
  TkRule,
} from "@/components/ticket"
import SocialStandingPass from "./social-standing-pass"
import SocialPostsPass from "./social-posts-pass"
import SocialInsightsPass from "./social-insights-pass"
import type { SocialPlatform } from "@/lib/social/types"
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

  const [socialData, cached, ownPhotos] = await Promise.all([
    selectedLocationId
      ? fetchSocialDashboardData(selectedLocationId)
      : Promise.resolve({ profiles: [], handles: [], topPosts: [] }),
    selectedLocationId
      ? fetchSocialPageData(organizationId, selectedLocationId)
      : Promise.resolve({ insights: [], preferences: [] }),
    selectedLocationId ? fetchOwnPhotos(selectedLocationId) : Promise.resolve([]),
  ])

  // ALT-152: when an own post has no usable social image, fall back to the
  // best photo from your Google listing (already fetched + graded by ALT-160)
  // instead of dropping straight to the neutral placeholder.
  const ownFallbackPhotoUrl = pickCoverPhoto(ownPhotos)

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

  // Per-network follower breakdown for your own profiles (ALT-202a) — shown
  // beneath the big total. Honest: only networks where we actually read a profile.
  const PLATFORM_ORDER: SocialPlatform[] = ["instagram", "facebook", "tiktok"]
  const followersByNetwork = PLATFORM_ORDER
    .map((platform) => ({
      platform,
      followers: locProfiles
        .filter((p) => p.platform === platform)
        .reduce((s, p) => s + p.followerCount, 0),
      present: locProfiles.some((p) => p.platform === platform),
    }))
    .filter((n) => n.present)

  // Split posts into yours vs competitors' (ALT-197) so each section is distinct.
  const allPosts = socialData.topPosts ?? []
  const ownPosts = allPosts.filter((p) => p.entityType === "location")
  const competitorPosts = allPosts.filter((p) => p.entityType === "competitor")

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
  const hasOwnProfiles = locProfiles.length > 0
  const hasCompetitorProfiles = compProfiles.length > 0
  const visibleInsights = feedInsights.filter(
    (i) => !["dismissed", "snoozed", "inaccurate"].includes(i.status),
  )
  const hasInsights = visibleInsights.length > 0
  const hasOwnPosts = ownPosts.length > 0
  const hasCompetitorPosts = competitorPosts.length > 0

  return (
    <div className="pv-page">
      <div className="pv-page-head">
        <span className="pv-kicker">Your market</span>
        <h1 className="pv-h1">Social</h1>
        <p className="pv-sub">
          How your accounts and your competitors&apos; show up — followers, engagement, and the posts
          driving it. We frame everything as percentages and &ldquo;you vs them&rdquo;, never guessed
          dollars or customer counts.
        </p>
      </div>
      <TkRule />

      <div className="sp-body tk-kit">
        <TkTooltipLayer />

        {/* ── Controls ── */}
        {selectedLocationId && locations && locations.length > 1 && (
          <RevealOnView>
            <TkSoftPanel className="sp-controls">
              <div className="sp-controls-left">
                <LocationFilter
                  locations={(locations ?? []).map((l) => ({ id: l.id, name: l.name ?? "Location" }))}
                  selectedLocationId={selectedLocationId}
                />
              </div>
            </TkSoftPanel>
          </RevealOnView>
        )}

        {/* ════════════════════════════════════════════════════════════════
            YOUR SOCIAL — lead the page with our own accounts (ALT-197).
            At-a-glance footprint (with per-network follower breakdown · ALT-202a),
            network coverage (where you stand · ALT-202c), then your recent posts.
            ════════════════════════════════════════════════════════════════ */}
        {hasProfiles && (
          <>
            <TkSectionHead
              title="Your social"
              sub="Your accounts — footprint, coverage, and recent posts"
              className="sp-sec sp-sec-own"
            />

            <RevealOnView>
              <TkWidgetGrid>
                <TkWidget
                  tone="rust"
                  size="wide"
                  className="tk-w-tall sp-w-followers"
                  label="Your followers"
                  data-tip="Total followers across the social profiles we track for you"
                  data-tipv={`${formatNumber(totalFollowers)} followers`}
                  data-tip-anchor=""
                >
                  <div>
                    <div className="tk-wval">{formatNumber(totalFollowers)}</div>
                    <div className="tk-wsub">
                      across {locProfiles.length} of your profile{locProfiles.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  {followersByNetwork.length > 0 && (
                    <div className="sp-foll-break" aria-label="Followers by network">
                      {followersByNetwork.map((n) => (
                        <span key={n.platform} className="sp-foll-net">
                          <span className="sp-foll-ic">{NET_ICON[n.platform]}</span>
                          <span className="sp-foll-n">{formatNumber(n.followers)}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </TkWidget>
                <TkWidget
                  tone={avgEngagement > 0 ? "teal" : "muted"}
                  label="Engagement / post"
                  value={avgEngagement > 0 ? `${avgEngagement.toFixed(1)}%` : "—"}
                  sub={avgEngagement > 0 ? "when you post, on average" : "no posts read yet"}
                  data-tip="Average interactions per post ÷ followers, when you post — not how often you post"
                  data-tipv={avgEngagement > 0 ? `${avgEngagement.toFixed(1)}% engagement` : "not enough data"}
                  data-tip-anchor=""
                />
                <TkWidget
                  tone="gold"
                  label="Your platforms"
                  value={String(new Set(locProfiles.map((p) => p.platform)).size)}
                  sub="networks we read for you"
                  data-tip="Distinct platforms where we read one of your profiles"
                  data-tipv={`${new Set(locProfiles.map((p) => p.platform)).size} of your platform${new Set(locProfiles.map((p) => p.platform)).size === 1 ? "" : "s"}`}
                  data-tip-anchor=""
                />
              </TkWidgetGrid>
            </RevealOnView>

            {/* Network coverage — where you stand, per network (ALT-202c) */}
            <SocialStandingPass profiles={socialData.profiles} section="presence" />

            {/* Your recent posts — fewer columns to give your own posts room (ALT-201) */}
            {hasOwnPosts ? (
              <SocialPostsPass posts={ownPosts} variant="own" fallbackPhotoUrl={ownFallbackPhotoUrl} />
            ) : hasOwnProfiles ? (
              <TkEmptyState
                title="No posts read yet"
                description="Run a social-data fetch and your recent posts will appear here."
              />
            ) : null}
          </>
        )}

        {/* ════════════════════════════════════════════════════════════════
            COMPETITORS — a distinct section, clearly separated from your own
            (ALT-197). You-vs-the-set head-to-head, then their recent posts.
            ════════════════════════════════════════════════════════════════ */}
        {hasCompetitorProfiles && (
          <>
            <TkSectionHead
              title="Competitors"
              sub="The accounts you measure against — you vs them, and their recent posts"
              className="sp-sec sp-sec-comp"
            />

            <RevealOnView>
              <TkWidgetGrid>
                <TkWidget
                  tone="slate"
                  label="Watched competitors"
                  value={String(compProfiles.length)}
                  sub={compProfiles.length === 1 ? "profile being watched" : "profiles being watched"}
                  data-tip="Competitor social profiles in your watched set"
                  data-tipv={`${compProfiles.length} watched`}
                  data-tip-anchor=""
                />
                <TkWidget
                  tone="gold"
                  label="Platforms"
                  value={String(new Set(compProfiles.map((p) => p.platform)).size)}
                  sub="networks they're on"
                  data-tip="Distinct platforms where we read a competitor profile"
                  data-tipv={`${new Set(compProfiles.map((p) => p.platform)).size} platform${new Set(compProfiles.map((p) => p.platform)).size === 1 ? "" : "s"}`}
                  data-tip-anchor=""
                />
              </TkWidgetGrid>
            </RevealOnView>

            {/* You vs the set — head-to-head on the honest signals */}
            <SocialStandingPass profiles={socialData.profiles} section="h2h" />

            {/* Their recent posts — more columns to scan the set (ALT-201) */}
            {hasCompetitorPosts && (
              <SocialPostsPass posts={competitorPosts} variant="competitors" />
            )}
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

        {/* ── Watched accounts (DISPLAY-ONLY · ALT-234) ── */}
        {selectedLocationId && (
          <>
            <TkSectionHead
              id="watched-accounts"
              title="Watched accounts"
              sub="The handles we read — manage your own in Settings, a competitor's on its page"
              className="sp-sec"
            />
            <RevealOnView>
              <SocialWatchedAccounts
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
                  <Link href="/settings#social-coverage">
                    <TkButton variant="add">Add your accounts</TkButton>
                  </Link>
                  <Link href="/competitors">
                    <TkButton variant="keep">Manage competitors</TkButton>
                  </Link>
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

// Inline network glyphs (the same filled set the rest of the page uses). Plain
// JSX in a Server Component — no client boundary crossed.
const NET_ICON: Record<SocialPlatform, ReactNode> = {
  instagram: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.16c3.2 0 3.58.01 4.85.07 3.25.15 4.77 1.69 4.92 4.92.06 1.27.07 1.64.07 4.85 0 3.2-.01 3.58-.07 4.85-.15 3.23-1.66 4.77-4.92 4.92-1.27.06-1.64.07-4.85.07-3.2 0-3.58-.01-4.85-.07-3.26-.15-4.77-1.7-4.92-4.92C2.17 15.58 2.16 15.2 2.16 12c0-3.2.01-3.58.07-4.85.15-3.23 1.66-4.77 4.92-4.92C8.42 2.17 8.8 2.16 12 2.16Zm0 3.68a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32Zm0 10.16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.41-11.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88Z" />
    </svg>
  ),
  facebook: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M24 12.07C24 5.44 18.63.07 12 .07S0 5.44 0 12.07c0 5.99 4.39 10.95 10.13 11.85v-8.38H7.08v-3.47h3.05V9.43c0-3.01 1.79-4.67 4.53-4.67 1.31 0 2.69.24 2.69.24v2.95h-1.51c-1.49 0-1.96.93-1.96 1.87v2.25h3.33l-.53 3.47h-2.8v8.38C19.61 23.02 24 18.06 24 12.07Z" />
    </svg>
  ),
  tiktok: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 1 1-2.1-2.79v-3.5a6.34 6.34 0 1 0 5.55 6.29V8.7a8.26 8.26 0 0 0 5.58 2.17V7.4a4.83 4.83 0 0 1-1.81-.71Z" />
    </svg>
  ),
}
