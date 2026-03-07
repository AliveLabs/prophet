// ---------------------------------------------------------------------------
// Social Pipeline – step definitions
//
// 1. Discover handles        – Firecrawl website scraping only (fast, ~5-15s)
// 2. Collect snapshots        – Data365 fetchProfile/fetchPosts for verified handles
// 3. Analyze social visuals   – Gemini Vision on post images (NEW)
// 4. Generate insights        – deterministic comparison rules + visual insights
//
// Data365 search is deliberately excluded from discovery: it uses a slow
// POST-poll-GET pattern (up to 5 min per entity) and produces lower-quality
// results than extracting social links directly from business websites.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js"
import type { PipelineStepDef } from "../types"
import type {
  SocialPlatform,
  SocialSnapshotData,
  EntityVisualProfile,
  NormalizedSocialPost,
} from "@/lib/social/types"
import { discoverFromWebsite } from "@/lib/social/enrich"
import {
  normalizeInstagramProfile,
  normalizeInstagramPost,
  normalizeFacebookProfile,
  normalizeFacebookPost,
  normalizeTikTokProfile,
  normalizeTikTokPost,
  buildSocialSnapshot,
} from "@/lib/social/normalize"
import { generateSocialInsights } from "@/lib/social/insights"
import { generateVisualInsights } from "@/lib/social/visual-insights"
import { analyzePostImages, aggregateVisualMetrics } from "@/lib/social/visual-analysis"
import { persistPostImages } from "@/lib/social/storage"
import { fetchInstagramProfile, fetchInstagramPosts } from "@/lib/providers/data365/instagram"
import { fetchFacebookProfile, fetchFacebookPosts } from "@/lib/providers/data365/facebook"
import { fetchTikTokProfile, fetchTikTokPosts } from "@/lib/providers/data365/tiktok"

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export type SocialPipelineCtx = {
  supabase: SupabaseClient
  locationId: string
  organizationId: string
  location: {
    id: string
    name: string | null
    website: string | null
  }
  approvedCompetitors: Array<{
    id: string
    name: string
    website: string | null
  }>
  dateKey: string
  state: {
    discoveredCount: number
    snapshotsCollected: number
    postsAnalyzed: number
    insightsGenerated: number
    visualProfiles: EntityVisualProfile[]
    warnings: string[]
  }
}

// ---------------------------------------------------------------------------
// Step builders
// ---------------------------------------------------------------------------

export function buildSocialSteps(): PipelineStepDef<SocialPipelineCtx>[] {
  return [
    // ------------------------------------------------------------------
    // Step 1: Discover handles via Firecrawl website scraping
    // Skips entities that already have social profiles in the DB.
    // ------------------------------------------------------------------
    {
      name: "discover_handles",
      label: "Discovering social media handles",
      run: async (c) => {
        type Entity = {
          type: "location" | "competitor"
          id: string
          website: string | null
        }
        const entities: Entity[] = [
          { type: "location", id: c.location.id, website: c.location.website },
          ...c.approvedCompetitors.map((comp) => ({
            type: "competitor" as const,
            id: comp.id,
            website: comp.website,
          })),
        ]

        const allEntityIds = entities.map((e) => e.id)
        const { data: existingProfiles } = await c.supabase
          .from("social_profiles")
          .select("entity_id")
          .in("entity_id", allEntityIds.length > 0 ? allEntityIds : ["__none__"])

        const hasProfiles = new Set(
          (existingProfiles ?? []).map((p) => p.entity_id as string)
        )

        const needsDiscovery = entities.filter(
          (e) => !hasProfiles.has(e.id) && e.website
        )

        console.log(
          `[Social Discovery] ${entities.length} entities total, ${hasProfiles.size} already have profiles, ${needsDiscovery.length} need discovery`
        )

        if (needsDiscovery.length === 0) {
          return {
            discoveredHandles: 0,
            skipped: entities.length,
            message: "All entities already have profiles or no websites to scrape",
          }
        }

        let total = 0

        const results = await Promise.allSettled(
          needsDiscovery.map(async (entity) => {
            console.log(
              `[Social Discovery] Discovering handles for ${entity.type}: ${entity.id} (${entity.website})`
            )
            const handles = await withTimeout(
              discoverFromWebsite(entity.website!),
              30_000
            )
            console.log(
              `[Social Discovery] Found ${handles.length} handles for ${entity.type}: ${entity.id}`
            )
            let count = 0
            for (const h of handles) {
              const autoVerify = h.method === "auto_scrape" && h.confidence >= 0.8
              const { error } = await c.supabase
                .from("social_profiles")
                .upsert(
                  {
                    entity_type: entity.type,
                    entity_id: entity.id,
                    platform: h.platform,
                    handle: h.handle,
                    profile_url: h.profileUrl,
                    discovery_method: h.method,
                    is_verified: autoVerify,
                    updated_at: new Date().toISOString(),
                  },
                  { onConflict: "entity_type,entity_id,platform" }
                )
              if (!error) count++
            }
            return count
          })
        )

        for (const r of results) {
          if (r.status === "fulfilled") total += r.value
        }

        c.state.discoveredCount = total
        return {
          discoveredHandles: total,
          scraped: needsDiscovery.length,
          skipped: hasProfiles.size,
        }
      },
    },

    // ------------------------------------------------------------------
    // Step 2: Collect snapshots from Data365 for verified handles
    // ------------------------------------------------------------------
    {
      name: "collect_snapshots",
      label: "Collecting social media data from Data365",
      run: async (c) => {
        const compIds = c.approvedCompetitors.map((comp) => comp.id)
        const entityIds = [c.locationId, ...compIds]

        const { data: profiles } = await c.supabase
          .from("social_profiles")
          .select("*")
          .in("entity_id", entityIds.length > 0 ? entityIds : ["__none__"])
          .eq("is_verified", true)

        if (!profiles || profiles.length === 0) {
          c.state.warnings.push(
            "No verified social profiles found. Verify handles first to collect data."
          )
          return { snapshots: 0, message: "No verified profiles" }
        }

        let collected = 0

        const TIMEOUT_BY_PLATFORM: Record<string, number> = {
          instagram: 90_000,
          facebook: 90_000,
          tiktok: 150_000,
        }

        const results = await Promise.allSettled(
          profiles.map((profile) =>
            withTimeout(
              collectSingleProfile(
                profile.platform as SocialPlatform,
                profile.handle,
                profile.id,
                c.dateKey,
                c.supabase
              ),
              TIMEOUT_BY_PLATFORM[profile.platform] ?? 90_000
            )
          )
        )

        for (const r of results) {
          if (r.status === "fulfilled" && r.value) collected++
          if (r.status === "rejected") {
            const msg =
              r.reason instanceof Error ? r.reason.message : String(r.reason)
            c.state.warnings.push(msg)
            console.warn("[Social Pipeline]", msg)
          }
        }

        c.state.snapshotsCollected = collected
        return { snapshots: collected, total: profiles.length }
      },
    },

    // ------------------------------------------------------------------
    // Step 3: Analyze social post images via Gemini Vision
    // ------------------------------------------------------------------
    {
      name: "analyze_social_visuals",
      label: "Analyzing social media visuals with AI",
      run: async (c) => {
        const compIds = c.approvedCompetitors.map((comp) => comp.id)
        const entityIds = [c.locationId, ...compIds]

        const { data: allProfiles } = await c.supabase
          .from("social_profiles")
          .select("*")
          .in("entity_id", entityIds.length > 0 ? entityIds : ["__none__"])
          .eq("is_verified", true)

        if (!allProfiles || allProfiles.length === 0) {
          return { analyzed: 0, message: "No profiles to analyze" }
        }

        const profileIds = allProfiles.map((p) => p.id)
        const { data: snapshots } = await c.supabase
          .from("social_snapshots")
          .select("*")
          .in("social_profile_id", profileIds)
          .order("date_key", { ascending: false })

        const latestSnapshots = new Map<string, { id: string; raw_data: SocialSnapshotData }>()
        for (const snap of snapshots ?? []) {
          if (!latestSnapshots.has(snap.social_profile_id)) {
            latestSnapshots.set(snap.social_profile_id, {
              id: snap.id,
              raw_data: snap.raw_data as SocialSnapshotData,
            })
          }
        }

        const nameMap = new Map<string, string>()
        nameMap.set(c.location.id, c.location.name ?? "Your location")
        for (const comp of c.approvedCompetitors) nameMap.set(comp.id, comp.name)

        let totalAnalyzed = 0
        const visualProfiles: EntityVisualProfile[] = []

        const VISION_TIMEOUT_PER_PROFILE = 60_000

        for (let pi = 0; pi < allProfiles.length; pi++) {
          const profile = allProfiles[pi]
          const snapEntry = latestSnapshots.get(profile.id)
          if (!snapEntry?.raw_data?.recentPosts?.length) continue

          const posts = snapEntry.raw_data.recentPosts
          const postsNeedingAnalysis = posts.filter(
            (p) => !p.visualAnalysis && p.mediaUrl?.includes("supabase")
          )

          console.log(
            `[SocialVision] Profile ${pi + 1}/${allProfiles.length}: ${profile.platform}/${profile.handle} — ${postsNeedingAnalysis.length} posts to analyze`
          )

          if (postsNeedingAnalysis.length === 0 && posts.some((p) => p.visualAnalysis)) {
            const existingMap = new Map(
              posts
                .filter((p) => p.visualAnalysis)
                .map((p) => [p.platformPostId, p.visualAnalysis!])
            )
            const vp = aggregateVisualMetrics(
              profile.entity_type as "location" | "competitor",
              profile.entity_id,
              nameMap.get(profile.entity_id) ?? "Unknown",
              profile.platform as SocialPlatform,
              posts,
              existingMap
            )
            if (vp) visualProfiles.push(vp)
            continue
          }

          try {
            const analysisMap = await withTimeout(
              analyzePostImages(postsNeedingAnalysis),
              VISION_TIMEOUT_PER_PROFILE
            )
            totalAnalyzed += analysisMap.size

            if (analysisMap.size > 0) {
              const updatedPosts: NormalizedSocialPost[] = posts.map((p) => {
                const analysis = analysisMap.get(p.platformPostId)
                return analysis ? { ...p, visualAnalysis: analysis } : p
              })

              const updatedSnapshot: SocialSnapshotData = {
                ...snapEntry.raw_data,
                recentPosts: updatedPosts,
              }

              await c.supabase
                .from("social_snapshots")
                .update({
                  raw_data: updatedSnapshot as unknown as Record<string, unknown>,
                })
                .eq("id", snapEntry.id)
            }

            // Build aggregated map including both new and existing analyses
            const fullMap = new Map(
              posts
                .filter((p) => p.visualAnalysis)
                .map((p) => [p.platformPostId, p.visualAnalysis!])
            )
            for (const [postId, analysis] of analysisMap) {
              fullMap.set(postId, analysis)
            }

            const vp = aggregateVisualMetrics(
              profile.entity_type as "location" | "competitor",
              profile.entity_id,
              nameMap.get(profile.entity_id) ?? "Unknown",
              profile.platform as SocialPlatform,
              posts,
              fullMap
            )
            if (vp) visualProfiles.push(vp)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            c.state.warnings.push(`Visual analysis failed for ${profile.platform}/${profile.handle}: ${msg}`)
            console.warn(`[SocialVision] Failed for ${profile.platform}/${profile.handle}:`, msg)
          }
        }

        c.state.postsAnalyzed = totalAnalyzed
        c.state.visualProfiles = visualProfiles

        console.log(
          `[SocialVision] Analyzed ${totalAnalyzed} post images, built ${visualProfiles.length} visual profiles`
        )

        return {
          analyzed: totalAnalyzed,
          visualProfiles: visualProfiles.length,
        }
      },
    },

    // ------------------------------------------------------------------
    // Step 4: Generate deterministic social insights (metric + visual)
    // ------------------------------------------------------------------
    {
      name: "generate_social_insights",
      label: "Generating social intelligence insights",
      run: async (c) => {
        const compIds = c.approvedCompetitors.map((comp) => comp.id)

        const { data: allProfiles } = await c.supabase
          .from("social_profiles")
          .select("*")
          .or(
            `and(entity_type.eq.location,entity_id.eq.${c.locationId}),` +
              (compIds.length > 0
                ? `and(entity_type.eq.competitor,entity_id.in.(${compIds.join(",")}))`
                : "entity_type.eq.__none__")
          )

        if (!allProfiles || allProfiles.length === 0) {
          return { insights: 0 }
        }

        const profileIds = allProfiles.map((p) => p.id)
        const { data: snapshots } = await c.supabase
          .from("social_snapshots")
          .select("*")
          .in("social_profile_id", profileIds)
          .order("date_key", { ascending: false })

        const snapshotsByProfile = new Map<
          string,
          Array<Record<string, unknown>>
        >()
        for (const s of snapshots ?? []) {
          const arr = snapshotsByProfile.get(s.social_profile_id) ?? []
          arr.push(s)
          snapshotsByProfile.set(s.social_profile_id, arr)
        }

        const nameMap = new Map<string, string>()
        nameMap.set(c.location.id, c.location.name ?? "Your location")
        for (const comp of c.approvedCompetitors) {
          nameMap.set(comp.id, comp.name)
        }

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
          const previous =
            snaps.length > 1
              ? (snaps[1].raw_data as SocialSnapshotData)
              : null

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

        const metricInsights = generateSocialInsights(
          locationSnapshots,
          competitorSnapshots
        )

        // Generate visual intelligence insights from aggregated visual profiles
        const locVisualProfiles = c.state.visualProfiles.filter(
          (vp) => vp.entityType === "location"
        )
        const compVisualProfiles = c.state.visualProfiles.filter(
          (vp) => vp.entityType === "competitor"
        )
        const visualInsights = generateVisualInsights(
          locVisualProfiles,
          compVisualProfiles
        )

        const insights = [...metricInsights, ...visualInsights]

        console.log(
          `[Social Insights] Generated ${insights.length} insights (${metricInsights.length} metric, ${visualInsights.length} visual) for ${locationSnapshots.length} location + ${competitorSnapshots.length} competitor snapshots`
        )

        if (insights.length > 0) {
          const payload = insights.map((ins) => ({
            location_id: c.locationId,
            competitor_id: null,
            date_key: c.dateKey,
            insight_type: ins.insight_type,
            title: ins.title,
            summary: ins.summary,
            confidence: ins.confidence,
            severity: ins.severity,
            evidence: ins.evidence,
            recommendations: ins.recommendations,
            status: "new",
          }))

          const { error } = await c.supabase.from("insights").upsert(payload, {
            onConflict: "location_id,competitor_id,date_key,insight_type",
            ignoreDuplicates: false,
          })

          if (error) {
            console.error("[Social Insights] Upsert error:", error.message)
            // Fallback: try individual inserts for rows that failed upsert
            let inserted = 0
            for (const row of payload) {
              const { error: insertErr } = await c.supabase
                .from("insights")
                .insert(row)
              if (!insertErr) inserted++
            }
            console.log(`[Social Insights] Fallback insert: ${inserted}/${payload.length} succeeded`)
          } else {
            console.log(`[Social Insights] Upserted ${payload.length} insights to DB`)
          }
        }

        c.state.insightsGenerated = insights.length
        return { insights: insights.length, metric: metricInsights.length, visual: visualInsights.length }
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

export async function buildSocialContext(
  supabase: SupabaseClient,
  locationId: string,
  organizationId: string
): Promise<SocialPipelineCtx> {
  const { data: location } = await supabase
    .from("locations")
    .select("id, name, website")
    .eq("id", locationId)
    .eq("organization_id", organizationId)
    .maybeSingle()

  if (!location) throw new Error("Location not found")

  const { data: competitors } = await supabase
    .from("competitors")
    .select("id, name, website, metadata, is_active")
    .eq("location_id", locationId)
    .eq("is_active", true)

  const approved = (competitors ?? [])
    .filter((c) => {
      const meta = c.metadata as Record<string, unknown> | null
      return meta?.status === "approved"
    })
    .map((c) => {
      const meta = c.metadata as Record<string, unknown> | null
      return {
        id: c.id,
        name: c.name,
        website: (c.website ?? (meta?.website as string) ?? null) as
          | string
          | null,
      }
    })

  return {
    supabase,
    locationId,
    organizationId,
    location: {
      id: location.id,
      name: location.name,
      website: location.website,
    },
    approvedCompetitors: approved,
    dateKey: new Date().toISOString().slice(0, 10),
    state: {
      discoveredCount: 0,
      snapshotsCollected: 0,
      postsAnalyzed: 0,
      insightsGenerated: 0,
      visualProfiles: [],
      warnings: [],
    },
  }
}

// ---------------------------------------------------------------------------
// Single profile collection helper
// ---------------------------------------------------------------------------

async function collectSingleProfile(
  platform: SocialPlatform,
  handle: string,
  profileId: string,
  dateKey: string,
  supabase: SupabaseClient
): Promise<boolean> {
  try {
    let snapshot: SocialSnapshotData

    switch (platform) {
      case "instagram": {
        const rawProfile = await fetchInstagramProfile(handle)
        if (!rawProfile) return false
        const rawPosts = await fetchInstagramPosts(handle, 20)
        console.log(`[Social] ${platform}/${handle}: profile OK, ${rawPosts.length} posts`)
        const profile = normalizeInstagramProfile(rawProfile, handle)
        const posts = rawPosts.map(normalizeInstagramPost)
        snapshot = buildSocialSnapshot(profile, posts)
        break
      }
      case "facebook": {
        const rawProfile = await fetchFacebookProfile(handle)
        if (!rawProfile) return false
        const rawPosts = await fetchFacebookPosts(handle, 20)
        console.log(`[Social] ${platform}/${handle}: profile OK, ${rawPosts.length} posts`)
        const profile = normalizeFacebookProfile(rawProfile, handle)
        const posts = rawPosts.map(normalizeFacebookPost)
        snapshot = buildSocialSnapshot(profile, posts)
        break
      }
      case "tiktok": {
        const rawProfile = await fetchTikTokProfile(handle)
        if (!rawProfile) return false
        const rawPosts = await fetchTikTokPosts(handle, 20)
        console.log(`[Social] ${platform}/${handle}: profile OK, ${rawPosts.length} posts`)
        const profile = normalizeTikTokProfile(rawProfile, handle)
        const posts = rawPosts.map(normalizeTikTokPost)
        snapshot = buildSocialSnapshot(profile, posts)
        break
      }
    }

    // Download post images and replace expiring CDN URLs with permanent Storage URLs
    if (snapshot.recentPosts.length > 0) {
      const originalPosts = snapshot.recentPosts
      const persisted = await persistPostImages(originalPosts, handle, platform)
      const savedCount = persisted.filter((p) => p.mediaUrl?.includes("supabase")).length
      console.log(`[Social] ${platform}/${handle}: persisted ${savedCount}/${persisted.length} post images to storage`)
      snapshot = { ...snapshot, recentPosts: persisted }
    }

    const diffHash = computeSnapshotHash(snapshot)

    await supabase.from("social_snapshots").upsert(
      {
        social_profile_id: profileId,
        date_key: dateKey,
        raw_data: snapshot as unknown as Record<string, unknown>,
        diff_hash: diffHash,
        captured_at: new Date().toISOString(),
      },
      { onConflict: "social_profile_id,date_key" }
    )

    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const detail = (err as { apiError?: string }).apiError
    console.warn(
      `[Social Pipeline] Failed to collect ${platform}/${handle}: ${msg}`,
      detail ? `\n  Response body: ${detail.slice(0, 500)}` : ""
    )
    return false
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeSnapshotHash(snapshot: SocialSnapshotData): string {
  const key = [
    snapshot.profile.followerCount,
    snapshot.profile.postCount,
    snapshot.aggregateMetrics.engagementRate,
    snapshot.recentPosts.length,
    snapshot.recentPosts[0]?.platformPostId ?? "",
  ].join("|")
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0
  }
  return `social_${Math.abs(hash).toString(36)}`
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Operation timed out after ${ms / 1000}s`)),
      ms
    )
    promise
      .then((v) => {
        clearTimeout(timer)
        resolve(v)
      })
      .catch((e) => {
        clearTimeout(timer)
        reject(e)
      })
  })
}
