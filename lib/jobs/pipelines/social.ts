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
import {
  discoverFromWebsite,
  discoverFromSearch,
  selectDiscoveryTargets,
  extractHandlesFromText,
  extractAggregatorUrls,
  type DiscoveredHandle,
} from "@/lib/social/enrich"
import { discoverFromSerp } from "@/lib/social/discover-serp"
import {
  asSubscriptionTier,
  isSocialPlatform,
  resolveOwnSocialNetworks,
} from "@/lib/billing/tiers"
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
import { freshnessFields } from "@/lib/freshness/stamp"
import { ensureCompetitorWebsites } from "@/lib/places/ensure-website"
import { shouldPull, type PullMode } from "@/lib/jobs/cadence"
import { DATA365_POSTS_PER_PULL } from "@/lib/billing/cost-model"
import { classifyNow, isUsable } from "@/lib/freshness/contract"
import { socialContentAsOf } from "@/lib/freshness/extract"

// Per-run Gemini Vision budget for the scheduled path (mirrors photos'
// MAX_DOWNLOADS_PER_RUN): ~2-4s per image keeps the job well inside the 300s
// function budget; the backlog resumes next run since analyzed posts are skipped.
const MAX_VISION_POSTS_PER_RUN = 24

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
    city: string | null
  }
  approvedCompetitors: Array<{
    id: string
    name: string
    website: string | null
    city: string | null
  }>
  dateKey: string
  // Pull scope (set by the worker from the job): cadence mode, forced refresh, and an
  // optional platform filter (ad-hoc "refresh just Instagram"). Default = daily, no filter.
  mode?: PullMode
  force?: boolean
  platforms?: SocialPlatform[]
  // OWN-account networks this org's tier collects (Tier 1 = the customer's one
  // chosen network; mid/top = all three). Competitor profiles always pull every
  // network. Discovery still runs everywhere so non-collected own handles exist
  // as rows — that's the "found — tracked on Tier 2+" upsell seam.
  ownAllowedPlatforms: SocialPlatform[]
  state: {
    discoveredCount: number
    snapshotsCollected: number
    skippedByCadence: number
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
    // Step 1: Discover handles — website scrape + SERP, Data365 search as a
    // first_run/adhoc-only fallback (handle-completion · Batch 1).
    // Trust gate: own-site ≥0.8 and SERP ≥0.75 auto-verify; search finds NEVER
    // auto-verify (the gyukaku rule); the rest persist as candidates. A verified
    // row is never clobbered by a candidate.
    // ------------------------------------------------------------------
    {
      name: "discover_handles",
      label: "Discovering social media handles",
      run: async (c) => {
        type Entity = {
          type: "location" | "competitor"
          id: string
          website: string | null
          name: string | null
          city: string | null
        }
        const entities: Entity[] = [
          { type: "location", id: c.location.id, website: c.location.website, name: c.location.name, city: c.location.city },
          ...c.approvedCompetitors.map((comp) => ({
            type: "competitor" as const,
            id: comp.id,
            website: comp.website,
            name: comp.name,
            city: comp.city,
          })),
        ]

        const allEntityIds = entities.map((e) => e.id)
        const { data: existingProfiles } = await c.supabase
          .from("social_profiles")
          .select("entity_id, platform, is_verified")
          .in("entity_id", allEntityIds.length > 0 ? allEntityIds : ["__none__"])

        // Re-discover any entity lacking a VERIFIED handle on some tracked platform
        // (not merely "has a row"), so junk/dormant unverified handles stop blocking
        // re-discovery of the real one. Per-(entity, platform) verified rows — never
        // overwritten by new candidates, and (ALT-198) an entity verified on only
        // SOME platforms still gets re-scanned for the rest instead of being
        // excluded entirely once it has any one verified handle.
        const verifiedPlatformKeys = new Set(
          (existingProfiles ?? [])
            .filter((p) => p.is_verified === true)
            .map((p) => `${p.entity_id}:${p.platform}`)
        )

        const needsDiscovery = selectDiscoveryTargets(entities, verifiedPlatformKeys)
        // Data365 search is slow + historically junk-prone: fallback only, only when a
        // human is waiting on a first pull / explicit refresh, and candidates-only.
        const searchFallbackAllowed = c.mode === "first_run" || c.mode === "adhoc"

        const fullyVerifiedCount = entities.length - needsDiscovery.length
        console.log(
          `[Social Discovery] ${entities.length} entities total, ${fullyVerifiedCount} fully verified (all platforms), ${needsDiscovery.length} need (re)discovery (search fallback: ${searchFallbackAllowed})`
        )

        if (needsDiscovery.length === 0) {
          return {
            discoveredHandles: 0,
            skipped: entities.length,
            message: "All entities already have a verified handle",
          }
        }

        let verifiedCount = 0
        let candidateCount = 0

        const results = await Promise.allSettled(
          needsDiscovery.map(async (entity) => {
            const [site, serp] = await Promise.allSettled([
              entity.website ? withTimeout(discoverFromWebsite(entity.website), 30_000) : Promise.resolve([] as DiscoveredHandle[]),
              entity.name ? discoverFromSerp(entity.name, entity.city) : Promise.resolve([] as DiscoveredHandle[]),
            ])
            let found: DiscoveredHandle[] = [
              ...(site.status === "fulfilled" ? site.value : []),
              ...(serp.status === "fulfilled" ? serp.value : []),
            ]
            if (found.length === 0 && searchFallbackAllowed && entity.name) {
              found = await discoverFromSearch(entity.name)
            }
            console.log(
              `[Social Discovery] ${entity.type} ${entity.name ?? entity.id}: site=${site.status === "fulfilled" ? site.value.length : "err"} serp=${serp.status === "fulfilled" ? serp.value.length : "err"} total=${found.length}`
            )

            // Best per platform — own-site confidence (0.9) outranks SERP (≤0.85).
            const best = new Map<string, DiscoveredHandle>()
            for (const h of found) {
              const cur = best.get(h.platform)
              if (!cur || h.confidence > cur.confidence) best.set(h.platform, h)
            }

            let v = 0
            let cand = 0
            for (const h of best.values()) {
              if (verifiedPlatformKeys.has(`${entity.id}:${h.platform}`)) continue
              const autoVerify =
                (h.method === "auto_scrape" && h.confidence >= 0.8) ||
                (h.method === "serp" && h.confidence >= 0.75)
              const { error } = await c.supabase
                .from("social_profiles")
                .upsert(
                  {
                    entity_type: entity.type,
                    entity_id: entity.id,
                    platform: h.platform,
                    handle: h.handle,
                    profile_url: h.profileUrl,
                    // CHECK constraint allows auto_scrape|data365_search|manual; the
                    // true source rides in metadata until the Batch-2 migration.
                    discovery_method: h.method === "data365_search" ? "data365_search" : "auto_scrape",
                    is_verified: autoVerify,
                    metadata: { source: h.method, confidence: h.confidence, discovered_at: new Date().toISOString() },
                    updated_at: new Date().toISOString(),
                  },
                  { onConflict: "entity_type,entity_id,platform" }
                )
              if (!error) {
                if (autoVerify) v++
                else cand++
              }
            }
            return { v, cand }
          })
        )

        for (const r of results) {
          if (r.status === "fulfilled") {
            verifiedCount += r.value.v
            candidateCount += r.value.cand
          }
        }

        c.state.discoveredCount = verifiedCount + candidateCount
        return {
          discoveredHandles: verifiedCount + candidateCount,
          verified: verifiedCount,
          candidates: candidateCount,
          scraped: needsDiscovery.length,
          skipped: entities.length - needsDiscovery.length,
        }
      },
    },

    // ------------------------------------------------------------------
    // Step 2: Collect snapshots from Data365 for verified handles
    // ------------------------------------------------------------------
    {
      name: "collect_snapshots",
      label: "Collecting social media data",
      run: async (c) => {
        const compIds = c.approvedCompetitors.map((comp) => comp.id)
        const entityIds = [c.locationId, ...compIds]

        let { data: profiles } = await c.supabase
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

        // Ad-hoc "refresh just <network>" — restrict to the requested platforms.
        if (c.platforms && c.platforms.length > 0) {
          profiles = profiles.filter((p) => c.platforms!.includes(p.platform as SocialPlatform))
        }

        // TIER GATE (own account only): on Tier 1, collect just the customer's
        // chosen network — other own handles stay stored but un-pulled (no
        // Data365 spend). Competitor profiles are never gated.
        const beforeOwnGate = profiles.length
        profiles = profiles.filter(
          (p) =>
            p.entity_id !== c.locationId ||
            c.ownAllowedPlatforms.includes(p.platform as SocialPlatform)
        )
        const ownGateSkipped = beforeOwnGate - profiles.length
        if (ownGateSkipped > 0) {
          console.log(
            `[Social] tier gate: skipped ${ownGateSkipped} own profile(s) outside [${c.ownAllowedPlatforms.join(", ")}]`
          )
        }

        // BILLING: Data365 charges per profile pull. Load each profile's last pull
        // (captured_at + content_as_of) and skip those still within the cadence window;
        // dormant accounts re-check on a long cadence. Forced/first-run pull everything.
        const profileIds = profiles.map((p) => p.id)
        const { data: lastSnaps } = await c.supabase
          .from("social_snapshots")
          .select("social_profile_id, captured_at, content_as_of, date_key")
          .in("social_profile_id", profileIds.length > 0 ? profileIds : ["__none__"])
          .order("date_key", { ascending: false })
        const lastByProfile = new Map<string, { capturedAt: string | null; contentAsOf: string | null }>()
        for (const s of lastSnaps ?? []) {
          const pid = s.social_profile_id as string
          if (!lastByProfile.has(pid)) {
            lastByProfile.set(pid, {
              capturedAt: (s.captured_at as string) ?? (s.date_key as string) ?? null,
              contentAsOf: (s.content_as_of as string) ?? null,
            })
          }
        }

        const mode: PullMode = c.mode ?? "daily"
        const toPull = profiles.filter((p) => {
          const last = lastByProfile.get(p.id)
          const d = shouldPull({
            lastCapturedAt: last?.capturedAt ?? null,
            lastContentAsOf: last?.contentAsOf ?? null,
            mode,
            force: c.force,
          })
          if (!d.pull) console.log(`[Social] skip ${p.platform}/${p.handle}: ${d.reason}`)
          return d.pull
        })
        c.state.skippedByCadence = profiles.length - toPull.length

        let collected = 0
        const TIMEOUT_BY_PLATFORM: Record<string, number> = {
          instagram: 90_000,
          facebook: 90_000,
          tiktok: 150_000,
        }

        const results = await Promise.allSettled(
          toPull.map((profile) =>
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
        return { snapshots: collected, pulled: toPull.length, skippedByCadence: c.state.skippedByCadence, total: profiles.length }
      },
    },

    // ------------------------------------------------------------------
    // Step 2b: Expand handles from verified bios (handle-completion · Batch 1).
    // One verified account usually links its siblings: platform links straight
    // from the bio text auto-verify at 0.85; link-in-bio aggregators (linktree
    // etc.) get ONE Firecrawl scrape — first_run/adhoc only, to bound cost.
    // ------------------------------------------------------------------
    {
      name: "expand_handles",
      label: "Expanding handles from verified bios",
      run: async (c) => {
        const entityIds = [c.locationId, ...c.approvedCompetitors.map((x) => x.id)]
        const { data: profiles } = await c.supabase
          .from("social_profiles")
          .select("id, entity_id, entity_type, platform, is_verified")
          .in("entity_id", entityIds.length > 0 ? entityIds : ["__none__"])
        const rows = profiles ?? []

        const ALL_PLATFORMS: SocialPlatform[] = ["instagram", "facebook", "tiktok"]
        const byEntity = new Map<string, typeof rows>()
        for (const r of rows) {
          const list = byEntity.get(r.entity_id) ?? []
          list.push(r)
          byEntity.set(r.entity_id, list)
        }

        const aggregatorScrapesAllowed = c.mode === "first_run" || c.mode === "adhoc"
        let expanded = 0

        for (const [entityId, entityRows] of byEntity) {
          const verified = entityRows.filter((r) => r.is_verified)
          if (verified.length === 0) continue
          const missing = ALL_PLATFORMS.filter(
            (p) => !entityRows.some((r) => r.platform === p && r.is_verified)
          )
          if (missing.length === 0) continue

          // Latest snapshot bio per verified profile (just collected in step 2).
          const { data: snaps } = await c.supabase
            .from("social_snapshots")
            .select("social_profile_id, raw_data, date_key")
            .in("social_profile_id", verified.map((v) => v.id))
            .order("date_key", { ascending: false })
          const seenProfile = new Set<string>()
          const bios: string[] = []
          for (const s of snaps ?? []) {
            if (seenProfile.has(s.social_profile_id)) continue
            seenProfile.add(s.social_profile_id)
            const bio = (s.raw_data as unknown as SocialSnapshotData | null)?.profile?.bio
            if (bio) bios.push(bio)
          }
          if (bios.length === 0) continue

          const found: DiscoveredHandle[] = []
          for (const bio of bios) {
            found.push(...extractHandlesFromText(bio, "bio_expansion", 0.85))
            if (aggregatorScrapesAllowed) {
              for (const url of extractAggregatorUrls(bio)) {
                const viaAggregator = await withTimeout(discoverFromWebsite(url), 25_000).catch(() => [] as DiscoveredHandle[])
                found.push(...viaAggregator.map((h) => ({ ...h, method: "bio_expansion" as const, confidence: 0.85 })))
              }
            }
          }

          const entityType = entityRows[0].entity_type as "location" | "competitor"
          for (const platform of missing) {
            const h = found.find((f) => f.platform === platform)
            if (!h) continue
            const { error } = await c.supabase
              .from("social_profiles")
              .upsert(
                {
                  entity_type: entityType,
                  entity_id: entityId,
                  platform: h.platform,
                  handle: h.handle,
                  profile_url: h.profileUrl,
                  discovery_method: "auto_scrape",
                  is_verified: true, // a verified account's own bio is strong evidence
                  metadata: { source: "bio_expansion", confidence: h.confidence, discovered_at: new Date().toISOString() },
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "entity_type,entity_id,platform" }
              )
            if (!error) {
              expanded++
              console.log(`[Social Discovery] bio expansion: ${entityType} ${entityId} +${platform}/@${h.handle}`)
            }
          }
        }

        return { expanded }
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
        let capped = false
        const visualProfiles: EntityVisualProfile[] = []

        const VISION_TIMEOUT_PER_PROFILE = 60_000

        for (let pi = 0; pi < allProfiles.length; pi++) {
          const profile = allProfiles[pi]
          const snapEntry = latestSnapshots.get(profile.id)
          if (!snapEntry?.raw_data?.recentPosts?.length) continue

          const posts = snapEntry.raw_data.recentPosts
          // Per-run cap (photos pattern): bounds the scheduled job well under the 300s
          // function budget. Already-analyzed posts are filtered out, so a backlog
          // chunks naturally across runs with no cursor or rework.
          const needingAnalysis = posts.filter(
            (p) => !p.visualAnalysis && p.mediaUrl?.includes("supabase")
          )
          const budgetLeft = Math.max(0, MAX_VISION_POSTS_PER_RUN - totalAnalyzed)
          const postsNeedingAnalysis = needingAnalysis.slice(0, budgetLeft)
          if (needingAnalysis.length > postsNeedingAnalysis.length) capped = true

          console.log(
            `[SocialVision] Profile ${pi + 1}/${allProfiles.length}: ${profile.platform}/${profile.handle} — ${postsNeedingAnalysis.length}/${needingAnalysis.length} posts to analyze${capped ? " (run cap)" : ""}`
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

        if (capped) {
          console.log(
            `[SocialVision] Analysis capped at ${MAX_VISION_POSTS_PER_RUN}/run — remaining posts resume next run (already-analyzed posts are skipped)`
          )
        }
        console.log(
          `[SocialVision] Analyzed ${totalAnalyzed} post images, built ${visualProfiles.length} visual profiles`
        )

        return {
          analyzed: totalAnalyzed,
          visualProfiles: visualProfiles.length,
          capped,
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

        // Data-integrity: do NOT generate "recent activity" insights for DORMANT
        // competitors (newest post months/years old). Anand's generateSocialInsights
        // doesn't gate competitor recency, so we gate its INPUT here — mirroring the
        // dossier read-fix. Location snapshots are kept as-is so the honest own-account
        // inactivity insight still fires.
        const freshCompetitorSnapshots = competitorSnapshots.filter((s) => {
          const probe = socialContentAsOf(s.current as unknown as Record<string, unknown>)
          const status = classifyNow({
            contentAsOf: probe.contentAsOf,
            capturedAt: (s.current as { timestamp?: string })?.timestamp ?? c.dateKey,
            isEmpty: probe.isEmpty,
            kind: "social",
          })
          return isUsable(status)
        })
        const droppedDormant = competitorSnapshots.length - freshCompetitorSnapshots.length
        if (droppedDormant > 0) {
          console.log(`[Social Insights] skipped activity insights for ${droppedDormant} dormant competitor account(s)`)
        }

        const metricInsights = generateSocialInsights(
          locationSnapshots,
          freshCompetitorSnapshots
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
    .select("id, name, website, city, settings")
    .eq("id", locationId)
    .eq("organization_id", organizationId)
    .maybeSingle()

  if (!location) throw new Error("Location not found")

  // Own-account network allowance: Tier 1 collects only the customer's chosen
  // network (locations.settings.ownSocialNetwork, default instagram).
  const { data: orgRow } = await supabase
    .from("organizations")
    .select("subscription_tier")
    .eq("id", organizationId)
    .maybeSingle()
  const orgTier = asSubscriptionTier(orgRow?.subscription_tier)
  const locSettings = (location.settings as Record<string, unknown> | null) ?? {}
  const chosenNetwork = isSocialPlatform(locSettings.ownSocialNetwork)
    ? locSettings.ownSocialNetwork
    : null
  const ownAllowedPlatforms = [...resolveOwnSocialNetworks(orgTier, chosenNetwork)]

  const { data: competitors } = await supabase
    .from("competitors")
    .select("id, name, website, metadata, is_active, provider_entity_id")
    .eq("location_id", locationId)
    .eq("is_active", true)

  // Self-heal missing websites from Places (they starve discovery/menus/SEO silently).
  await ensureCompetitorWebsites(supabase, (competitors ?? []) as Array<{ id: string; website: string | null; provider_entity_id?: string | null }>)

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
        city: (typeof meta?.city === "string" ? meta.city : null) as string | null,
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
      city: location.city ?? null,
    },
    approvedCompetitors: approved,
    dateKey: new Date().toISOString().slice(0, 10),
    ownAllowedPlatforms,
    state: {
      discoveredCount: 0,
      snapshotsCollected: 0,
      skippedByCadence: 0,
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
        const rawPosts = await fetchInstagramPosts(handle, DATA365_POSTS_PER_PULL)
        console.log(`[Social] ${platform}/${handle}: profile OK, ${rawPosts.length} posts`)
        const profile = normalizeInstagramProfile(rawProfile, handle)
        const posts = rawPosts.map(normalizeInstagramPost)
        snapshot = buildSocialSnapshot(profile, posts)
        break
      }
      case "facebook": {
        const rawProfile = await fetchFacebookProfile(handle)
        if (!rawProfile) return false
        const rawPosts = await fetchFacebookPosts(handle, DATA365_POSTS_PER_PULL)
        console.log(`[Social] ${platform}/${handle}: profile OK, ${rawPosts.length} posts`)
        const profile = normalizeFacebookProfile(rawProfile, handle)
        const posts = rawPosts.map(normalizeFacebookPost)
        snapshot = buildSocialSnapshot(profile, posts)
        break
      }
      case "tiktok": {
        const rawProfile = await fetchTikTokProfile(handle)
        if (!rawProfile) return false
        const rawPosts = await fetchTikTokPosts(handle, DATA365_POSTS_PER_PULL)
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
    const capturedAt = new Date().toISOString()
    // Data-integrity contract: stamp the REAL content recency + freshness so a
    // dormant account (newest post years old) is never treated as current activity.
    const { content_as_of, freshness } = freshnessFields(
      "social",
      snapshot as unknown as Record<string, unknown>,
      capturedAt
    )

    await supabase.from("social_snapshots").upsert(
      {
        social_profile_id: profileId,
        date_key: dateKey,
        raw_data: snapshot as unknown as Record<string, unknown>,
        diff_hash: diffHash,
        captured_at: capturedAt,
        content_as_of,
        freshness,
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
