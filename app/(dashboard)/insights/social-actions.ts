"use server"

import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { requireUser } from "@/lib/auth/server"
import { enqueueAdhocPlatform } from "@/lib/jobs/queue"
import type { SocialSnapshotData, SocialPlatform, NormalizedSocialPost, EntityVisualProfile } from "@/lib/social/types"
import { generateSocialInsights } from "@/lib/social/insights"
import { generateVisualInsights } from "@/lib/social/visual-insights"
import { aggregateVisualMetrics } from "@/lib/social/visual-analysis"

// ALT-260: the brief/insights read own-location social ONLY from `social_snapshots`.
// Setting or verifying a handle writes `social_profiles` but, without a data pull,
// no snapshot is ever collected — so insights show "no account" indefinitely. Kick a
// forced adhoc pull (+ delayed insights build) for the platform, exactly as
// setOwnSocialNetwork does for the network-choice path. Best-effort: never fail the
// user's save because a background enqueue hiccuped.
async function enqueueOwnSocialPull(organizationId: string, locationId: string, platform: string) {
  try {
    const admin = createAdminSupabaseClient()
    await enqueueAdhocPlatform(admin, { organizationId, locationId, platforms: [platform] })
  } catch (err) {
    console.warn("enqueueOwnSocialPull: adhoc enqueue failed", err)
  }
}

// ---------------------------------------------------------------------------
// Social Profile CRUD
// ---------------------------------------------------------------------------

export async function saveSocialProfileAction(data: {
  entityType: "location" | "competitor"
  entityId: string
  platform: string
  handle: string
}): Promise<{ error?: string }> {
  await requireUser()
  const supabase = await createServerSupabaseClient()

  let ownOrganizationId: string | null = null
  if (data.entityType === "location") {
    const { data: loc } = await supabase
      .from("locations")
      .select("id, organization_id")
      .eq("id", data.entityId)
      .maybeSingle()
    if (!loc) return { error: "Location not found or access denied." }
    ownOrganizationId = loc.organization_id
  } else {
    const { data: comp } = await supabase
      .from("competitors")
      .select("id, location_id")
      .eq("id", data.entityId)
      .maybeSingle()
    if (!comp) return { error: "Competitor not found or access denied." }
  }

  const cleanHandle = extractHandle(data.platform as SocialPlatform, data.handle)
  const profileUrl = buildProfileUrl(data.platform as SocialPlatform, cleanHandle)

  const { error } = await supabase.from("social_profiles").upsert(
    {
      entity_type: data.entityType,
      entity_id: data.entityId,
      platform: data.platform,
      handle: cleanHandle,
      profile_url: profileUrl,
      discovery_method: "manual",
      is_verified: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "entity_type,entity_id,platform" }
  )

  if (error) return { error: error.message }

  // ALT-260: a manually set own-location handle must trigger a pull, or the brief
  // shows "no account" until the next scheduled social run (never, for a demo/
  // cron-excluded org). Own-location only — competitor social populates via its
  // own discovery + daily flows.
  if (data.entityType === "location" && ownOrganizationId) {
    await enqueueOwnSocialPull(ownOrganizationId, data.entityId, data.platform)
  }
  return {}
}

export async function deleteSocialProfileAction(id: string): Promise<{ error?: string }> {
  await requireUser()
  const supabase = await createServerSupabaseClient()

  const { error } = await supabase.from("social_profiles").delete().eq("id", id)
  if (error) return { error: error.message }
  return {}
}

export async function verifySocialProfileAction(id: string): Promise<{ error?: string }> {
  await requireUser()
  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from("social_profiles")
    .select("entity_type, entity_id, platform")
    .eq("id", id)
    .maybeSingle()

  const { error } = await supabase
    .from("social_profiles")
    .update({ is_verified: true, updated_at: new Date().toISOString() })
    .eq("id", id)

  if (error) return { error: error.message }

  // ALT-260: confirming a DISCOVERED own-location handle is the other "I set my
  // handle" path — it must kick a pull too, else the brief keeps reading "no account".
  if (profile?.entity_type === "location") {
    const { data: loc } = await supabase
      .from("locations")
      .select("organization_id")
      .eq("id", profile.entity_id)
      .maybeSingle()
    if (loc?.organization_id) {
      await enqueueOwnSocialPull(loc.organization_id, profile.entity_id, profile.platform)
    }
  }
  return {}
}

// ---------------------------------------------------------------------------
// Social Discovery (run for a location)
// ---------------------------------------------------------------------------

export async function runSocialDiscoveryAction(locationId: string): Promise<{
  discovered: number
  error?: string
}> {
  await requireUser()
  const supabase = await createServerSupabaseClient()

  const { data: location } = await supabase
    .from("locations")
    .select("id, name, website")
    .eq("id", locationId)
    .single()

  if (!location) return { discovered: 0, error: "Location not found" }

  const { discoverSocialHandles } = await import("@/lib/social/enrich")

  const { data: competitors } = await supabase
    .from("competitors")
    .select("id, name, website, metadata, is_active")
    .eq("location_id", locationId)
    .eq("is_active", true)

  const approved = (competitors ?? []).filter((c) => {
    const meta = c.metadata as Record<string, unknown> | null
    return meta?.status === "approved"
  })

  let totalDiscovered = 0

  async function upsertHandles(
    entityType: "location" | "competitor",
    entityId: string,
    handles: Awaited<ReturnType<typeof discoverSocialHandles>>
  ): Promise<number> {
    let count = 0
    for (const h of handles) {
      const { error } = await supabase.from("social_profiles").upsert(
        {
          entity_type: entityType,
          entity_id: entityId,
          platform: h.platform,
          handle: h.handle,
          profile_url: h.profileUrl,
          discovery_method: h.method,
          is_verified: false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "entity_type,entity_id,platform" }
      )
      if (!error) count++
    }
    return count
  }

  // Discover for the location + all competitors in parallel
  const allEntities = [
    { type: "location" as const, id: location.id, name: location.name, website: location.website as string | null },
    ...approved.map((comp) => {
      const compMeta = comp.metadata as Record<string, unknown> | null
      return {
        type: "competitor" as const,
        id: comp.id,
        name: comp.name,
        website: (comp.website ?? compMeta?.website ?? null) as string | null,
      }
    }),
  ]

  const results = await Promise.allSettled(
    allEntities.map(async (entity) => {
      const handles = await discoverSocialHandles(entity.name, entity.website)
      return upsertHandles(entity.type, entity.id, handles)
    })
  )

  for (const r of results) {
    if (r.status === "fulfilled") totalDiscovered += r.value
  }

  return { discovered: totalDiscovered }
}

// ---------------------------------------------------------------------------
// ALT-190 — discovery scoped to ONE competitor.
//
// The set-wide runSocialDiscoveryAction sweeps the location + EVERY approved
// competitor, which is slow and surfaces accounts for rivals the operator isn't
// looking at. On a single competitor's watched-accounts the operator only wants
// THAT competitor's handles, so this resolves + searches exactly one competitor.
// Same upsert path / provenance (is_verified:false ⇒ "Discovering"), RLS enforced
// via the user-scoped client + an org-membership check on the competitor's location.
// ---------------------------------------------------------------------------
export async function runCompetitorSocialDiscoveryAction(
  competitorId: string
): Promise<{ discovered: number; error?: string }> {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  // Resolve the competitor THROUGH the user's org membership so a foreign id can't
  // be probed (RLS + an explicit membership check on the owning location's org).
  const { data: competitor } = await supabase
    .from("competitors")
    .select("id, name, website, metadata, location_id, locations (organization_id)")
    .eq("id", competitorId)
    .maybeSingle()
  if (!competitor) return { discovered: 0, error: "Competitor not found" }

  const locationRecord = Array.isArray(competitor.locations)
    ? competitor.locations[0]
    : competitor.locations
  const organizationId = (locationRecord as { organization_id?: string } | null)?.organization_id
  if (!organizationId) return { discovered: 0, error: "Competitor not found" }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle()
  if (!membership) return { discovered: 0, error: "You don't have access to this competitor" }

  const { discoverSocialHandles } = await import("@/lib/social/enrich")
  const compMeta = competitor.metadata as Record<string, unknown> | null
  const website = (competitor.website ?? (compMeta?.website as string | null) ?? null) as string | null

  const handles = await discoverSocialHandles(competitor.name, website)
  let discovered = 0
  for (const h of handles) {
    const { error } = await supabase.from("social_profiles").upsert(
      {
        entity_type: "competitor",
        entity_id: competitor.id,
        platform: h.platform,
        handle: h.handle,
        profile_url: h.profileUrl,
        discovery_method: h.method,
        is_verified: false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "entity_type,entity_id,platform" }
    )
    if (!error) discovered++
  }

  return { discovered }
}

// ---------------------------------------------------------------------------
// Fetch Social Dashboard Data
// ---------------------------------------------------------------------------

export async function fetchSocialDashboardData(locationId: string) {
  await requireUser()
  const supabase = await createServerSupabaseClient()

  // Get all social profiles for this location + its competitors
  const { data: competitors } = await supabase
    .from("competitors")
    .select("id, name, is_active, metadata")
    .eq("location_id", locationId)
    .eq("is_active", true)

  const approved = (competitors ?? []).filter((c) => {
    const meta = c.metadata as Record<string, unknown> | null
    return meta?.status === "approved"
  })

  const { data: location } = await supabase
    .from("locations")
    .select("id, name")
    .eq("id", locationId)
    .single()

  if (!location) return { profiles: [], handles: [] }

  // Fetch location social profiles
  const { data: locProfiles } = await supabase
    .from("social_profiles")
    .select("*")
    .eq("entity_type", "location")
    .eq("entity_id", locationId)

  // Fetch competitor social profiles
  const compIds = approved.map((c) => c.id)
  const { data: compProfiles } = await supabase
    .from("social_profiles")
    .select("*")
    .eq("entity_type", "competitor")
    .in("entity_id", compIds.length > 0 ? compIds : ["__none__"])

  const allProfiles = [...(locProfiles ?? []), ...(compProfiles ?? [])]

  // Fetch latest snapshots for all profiles
  const profileIds = allProfiles.map((p) => p.id)
  const { data: snapshots } = await supabase
    .from("social_snapshots")
    .select("*")
    .in("social_profile_id", profileIds.length > 0 ? profileIds : ["__none__"])
    .order("date_key", { ascending: false })

  // Get latest snapshot per profile
  const latestSnapshots = new Map<string, Record<string, unknown>>()
  for (const snap of snapshots ?? []) {
    if (!latestSnapshots.has(snap.social_profile_id)) {
      latestSnapshots.set(snap.social_profile_id, snap.raw_data as Record<string, unknown>)
    }
  }

  // Build dashboard data
  const nameMap = new Map<string, string>()
  nameMap.set(location.id, location.name)
  for (const comp of approved) {
    nameMap.set(comp.id, comp.name)
  }

  type ProfileData = {
    entityName: string
    entityType: "location" | "competitor"
    platform: string
    handle: string
    followerCount: number
    engagementRate: number
    postingFrequency: number
    postingWindowDays: number | null
    avgLikesPerPost: number
    avgCommentsPerPost: number
    topHashtags: string[]
  }

  const dashboardProfiles: ProfileData[] = []

  for (const profile of allProfiles) {
    const snap = latestSnapshots.get(profile.id) as SocialSnapshotData | undefined
    const entityName = nameMap.get(profile.entity_id) ?? "Unknown"

    dashboardProfiles.push({
      entityName,
      entityType: profile.entity_type as "location" | "competitor",
      platform: profile.platform,
      handle: profile.handle,
      followerCount: snap?.profile?.followerCount ?? snap?.aggregateMetrics?.avgLikesPerPost ?? 0,
      engagementRate: snap?.aggregateMetrics?.engagementRate ?? 0,
      postingFrequency: snap?.aggregateMetrics?.postingFrequencyPerWeek ?? 0,
      postingWindowDays: snap?.aggregateMetrics?.postingWindowDays ?? null,
      avgLikesPerPost: snap?.aggregateMetrics?.avgLikesPerPost ?? 0,
      avgCommentsPerPost: snap?.aggregateMetrics?.avgCommentsPerPost ?? 0,
      topHashtags: snap?.aggregateMetrics?.topHashtags ?? [],
    })
  }

  // Build handles list for HandleManager
  const handles = allProfiles.map((p) => ({
    id: p.id,
    entityType: p.entity_type as "location" | "competitor",
    entityId: p.entity_id,
    entityName: nameMap.get(p.entity_id) ?? "Unknown",
    platform: p.platform as "instagram" | "facebook" | "tiktok",
    handle: p.handle,
    profileUrl: p.profile_url,
    discoveryMethod: p.discovery_method as "auto_scrape" | "data365_search" | "manual",
    isVerified: p.is_verified,
  }))

  // Extract ALL recent posts from snapshots for client-side filtering
  // followerCount rides along so the card can show an honest per-post engagement
  // rate (interactions ÷ followers) instead of the misleading "% of peak" (ALT-274).
  type PostWithMeta = NormalizedSocialPost & { entityName: string; entityType: "location" | "competitor"; followerCount: number }
  const allPosts: PostWithMeta[] = []

  for (const profile of allProfiles) {
    const snap = latestSnapshots.get(profile.id) as SocialSnapshotData | undefined
    if (!snap?.recentPosts?.length) continue
    const entityName = nameMap.get(profile.entity_id) ?? "Unknown"
    const entityType = profile.entity_type as "location" | "competitor"
    const followerCount = snap.profile?.followerCount ?? 0
    for (const post of snap.recentPosts) {
      allPosts.push({ ...post, entityName, entityType, followerCount })
    }
  }

  allPosts.sort((a, b) => (b.likesCount + b.commentsCount) - (a.likesCount + a.commentsCount))

  return { profiles: dashboardProfiles, handles, topPosts: allPosts }
}

// ---------------------------------------------------------------------------
// Generate Social Insights (called from the main generateInsightsAction)
// ---------------------------------------------------------------------------

export async function generateSocialInsightsForLocation(locationId: string, dateKey: string) {
  const supabase = await createServerSupabaseClient()

  const { data: location } = await supabase
    .from("locations")
    .select("id, name")
    .eq("id", locationId)
    .single()
  if (!location) return []

  const { data: competitors } = await supabase
    .from("competitors")
    .select("id, name, is_active, metadata")
    .eq("location_id", locationId)
    .eq("is_active", true)

  const approved = (competitors ?? []).filter((c) => {
    const meta = c.metadata as Record<string, unknown> | null
    return meta?.status === "approved"
  })

  // Fetch social profiles
  const compIds = approved.map((c) => c.id)
  const { data: allProfiles } = await supabase
    .from("social_profiles")
    .select("*")
    .or(
      `and(entity_type.eq.location,entity_id.eq.${locationId}),` +
      (compIds.length > 0
        ? `and(entity_type.eq.competitor,entity_id.in.(${compIds.join(",")}))`
        : "entity_type.eq.__none__")
    )

  if (!allProfiles || allProfiles.length === 0) return []

  // Fetch latest snapshots for each profile
  const profileIds = allProfiles.map((p) => p.id)
  const { data: snapshots } = await supabase
    .from("social_snapshots")
    .select("*")
    .in("social_profile_id", profileIds)
    .order("date_key", { ascending: false })

  // Group snapshots by profile
  const snapshotsByProfile = new Map<string, Array<Record<string, unknown>>>()
  for (const s of snapshots ?? []) {
    const arr = snapshotsByProfile.get(s.social_profile_id) ?? []
    arr.push(s)
    snapshotsByProfile.set(s.social_profile_id, arr)
  }

  // Build entity snapshots
  const nameMap = new Map<string, string>()
  nameMap.set(location.id, location.name)
  for (const comp of approved) nameMap.set(comp.id, comp.name)

  type EntitySnapshot = {
    entityType: "location" | "competitor"
    entityId: string
    entityName: string
    platform: SocialPlatform
    current: SocialSnapshotData
    previous: SocialSnapshotData | null
  }

  const locationSnapshots: EntitySnapshot[] = []
  const competitorSnapshots: EntitySnapshot[] = []

  for (const profile of allProfiles) {
    const snaps = snapshotsByProfile.get(profile.id) ?? []
    if (snaps.length === 0) continue

    const current = snaps[0].raw_data as SocialSnapshotData
    const previous = snaps.length > 1 ? (snaps[1].raw_data as SocialSnapshotData) : null

    const entitySnap: EntitySnapshot = {
      entityType: profile.entity_type as "location" | "competitor",
      entityId: profile.entity_id,
      entityName: nameMap.get(profile.entity_id) ?? "Unknown",
      platform: profile.platform as SocialPlatform,
      current,
      previous,
    }

    if (profile.entity_type === "location") {
      locationSnapshots.push(entitySnap)
    } else {
      competitorSnapshots.push(entitySnap)
    }
  }

  // Generate metric-based insights
  const metricInsights = generateSocialInsights(locationSnapshots, competitorSnapshots)

  // Generate visual intelligence insights from existing visual analysis data
  const locVisualProfiles: EntityVisualProfile[] = []
  const compVisualProfiles: EntityVisualProfile[] = []

  for (const profile of allProfiles) {
    const snaps = snapshotsByProfile.get(profile.id) ?? []
    if (snaps.length === 0) continue

    const current = snaps[0].raw_data as SocialSnapshotData
    const posts = current.recentPosts ?? []
    const analyzedPosts = posts.filter((p) => p.visualAnalysis)

    if (analyzedPosts.length === 0) continue

    const analysisMap = new Map(
      analyzedPosts.map((p) => [p.platformPostId, p.visualAnalysis!])
    )

    const vp = aggregateVisualMetrics(
      profile.entity_type as "location" | "competitor",
      profile.entity_id,
      nameMap.get(profile.entity_id) ?? "Unknown",
      profile.platform as SocialPlatform,
      posts,
      analysisMap
    )

    if (vp) {
      if (profile.entity_type === "location") {
        locVisualProfiles.push(vp)
      } else {
        compVisualProfiles.push(vp)
      }
    }
  }

  const visualInsights = generateVisualInsights(locVisualProfiles, compVisualProfiles)
  const insights = [...metricInsights, ...visualInsights]

  // Upsert insights into the database
  if (insights.length > 0) {
    const payload = insights.map((ins) => ({
      location_id: locationId,
      competitor_id: null,
      date_key: dateKey,
      insight_type: ins.insight_type,
      title: ins.title,
      summary: ins.summary,
      confidence: ins.confidence,
      severity: ins.severity,
      evidence: ins.evidence,
      recommendations: ins.recommendations,
      status: "new",
    }))

    await supabase.from("insights").upsert(payload, {
      onConflict: "location_id,competitor_id,date_key,insight_type",
    })
  }

  return insights
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractHandle(platform: SocialPlatform, input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "")

  const urlPatterns: Record<SocialPlatform, RegExp> = {
    instagram: /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)/,
    facebook: /(?:https?:\/\/)?(?:www\.)?(?:facebook|fb)\.com\/([a-zA-Z0-9.]+)/,
    tiktok: /(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@?([a-zA-Z0-9._]+)/,
  }

  const match = trimmed.match(urlPatterns[platform])
  if (match?.[1]) return match[1]

  return trimmed.replace(/^@/, "")
}

function buildProfileUrl(platform: SocialPlatform, handle: string): string {
  switch (platform) {
    case "instagram": return `https://instagram.com/${handle}`
    case "facebook": return `https://facebook.com/${handle}`
    case "tiktok": return `https://tiktok.com/@${handle}`
  }
}
