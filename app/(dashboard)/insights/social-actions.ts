"use server"

import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import type { SocialSnapshotData, SocialPlatform, NormalizedSocialPost } from "@/lib/social/types"
import { generateSocialInsights } from "@/lib/social/insights"

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

  const { error } = await supabase
    .from("social_profiles")
    .update({ is_verified: true, updated_at: new Date().toISOString() })
    .eq("id", id)

  if (error) return { error: error.message }
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

  // Discover for the location itself
  const locHandles = await discoverSocialHandles(location.name, location.website)
  for (const h of locHandles) {
    const { error } = await supabase.from("social_profiles").upsert(
      {
        entity_type: "location" as const,
        entity_id: location.id,
        platform: h.platform,
        handle: h.handle,
        profile_url: h.profileUrl,
        discovery_method: h.method,
        is_verified: false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "entity_type,entity_id,platform" }
    )
    if (!error) totalDiscovered++
  }

  // Discover for each approved competitor
  for (const comp of approved) {
    const compMeta = comp.metadata as Record<string, unknown> | null
    const compWebsite = (comp.website ?? compMeta?.website ?? null) as string | null
    const compHandles = await discoverSocialHandles(comp.name, compWebsite)
    for (const h of compHandles) {
      const { error } = await supabase.from("social_profiles").upsert(
        {
          entity_type: "competitor" as const,
          entity_id: comp.id,
          platform: h.platform,
          handle: h.handle,
          profile_url: h.profileUrl,
          discovery_method: h.method,
          is_verified: false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "entity_type,entity_id,platform" }
      )
      if (!error) totalDiscovered++
    }
  }

  return { discovered: totalDiscovered }
}

// ---------------------------------------------------------------------------
// Fetch Social Dashboard Data
// ---------------------------------------------------------------------------

export async function fetchSocialDashboardData(locationId: string) {
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

  // Extract recent posts from snapshots, sorted by engagement (likes + comments)
  const recentPosts: Array<NormalizedSocialPost & { entityName: string; entityType: "location" | "competitor" }> = []
  for (const profile of allProfiles) {
    const snap = latestSnapshots.get(profile.id) as SocialSnapshotData | undefined
    if (!snap?.recentPosts?.length) continue
    const entityName = nameMap.get(profile.entity_id) ?? "Unknown"
    const entityType = profile.entity_type as "location" | "competitor"
    for (const post of snap.recentPosts) {
      recentPosts.push({ ...post, entityName, entityType })
    }
  }

  recentPosts.sort((a, b) => (b.likesCount + b.commentsCount) - (a.likesCount + a.commentsCount))
  const topPosts = recentPosts.slice(0, 10)

  return { profiles: dashboardProfiles, handles, topPosts }
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

  // Generate insights
  const insights = generateSocialInsights(locationSnapshots, competitorSnapshots)

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
