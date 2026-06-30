// ---------------------------------------------------------------------------
// Photos Pipeline – fetch, download, analyze competitor photos via Vision AI
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js"
import type { PipelineStepDef } from "../types"
import {
  fetchPhotoReferences,
  downloadPhoto,
  analyzePhoto,
  diffPhotos,
  type FetchedPhoto,
  type PhotoReference,
  type PhotoAnalysis,
} from "@/lib/providers/photos"
import { generatePhotoInsights } from "@/lib/insights/photo-insights"

export type PhotosPipelineCtx = {
  supabase: SupabaseClient
  locationId: string
  organizationId: string
  dateKey: string
  /** ALT-160: the operator's OWN listing. Its Google place id drives the own-photo
   *  pass that mirrors the competitor pass but writes to location_photos. */
  location: { id: string; name: string | null; placeId: string | null }
  competitors: Array<{
    id: string
    name: string | null
    provider_entity_id: string | null
  }>
  state: {
    photoRefs: Map<string, PhotoReference[]>
    downloads: Map<string, Array<FetchedPhoto & { competitorId: string }>>
    analyses: Map<string, Array<{ hash: string; analysis: PhotoAnalysis }>>
    // ALT-160: own-listing pass (single entity → plain arrays, not per-id Maps).
    ownPhotoRefs: PhotoReference[]
    ownDownloads: FetchedPhoto[]
    insightsPayload: Array<Record<string, unknown>>
    warnings: string[]
  }
}

export function buildPhotosSteps(): PipelineStepDef<PhotosPipelineCtx>[] {
  // Own-listing photos get a dedicated, modest per-run budget INDEPENDENT of the
  // competitor cap, and the own pass runs FIRST — the operator's own storefront is
  // the highest-value surface, so it should never be starved by a large competitor set.
  const MAX_OWN_DOWNLOADS_PER_RUN = 16
  return [
    // ── OWN LISTING (ALT-160) — mirror of the competitor pass, keyed on location ──
    {
      name: "fetch_own_photo_refs",
      label: "Fetching your listing photos from Google",
      run: async (ctx) => {
        const placeId = ctx.location.placeId
        if (!placeId) return { own_references: 0, skipped: "no primary_place_id" }
        try {
          const refs = await fetchPhotoReferences(placeId)
          ctx.state.ownPhotoRefs = refs
          return { own_references: refs.length }
        } catch (err) {
          ctx.state.warnings.push(`Own photo refs: ${err instanceof Error ? err.message : "failed"}`)
          return { own_references: 0 }
        }
      },
    },
    {
      name: "download_own_photos",
      label: "Downloading your listing photos",
      run: async (ctx) => {
        const refs = ctx.state.ownPhotoRefs
        if (!refs.length) return { downloaded: 0 }

        const { data: existing } = await ctx.supabase
          .from("location_photos")
          .select("image_hash")
          .eq("location_id", ctx.location.id)
        const existingHashes = new Set((existing ?? []).map((r) => r.image_hash))

        let downloaded = 0
        let skipped = 0
        let capped = false
        for (const ref of refs.slice(0, 30)) {
          if (downloaded >= MAX_OWN_DOWNLOADS_PER_RUN) { capped = true; break }
          try {
            await sleep(250)
            const photo = await downloadPhoto(ref.name)
            photo.reference = { ...photo.reference, widthPx: ref.widthPx, heightPx: ref.heightPx, authorAttributions: ref.authorAttributions }
            if (existingHashes.has(photo.hash)) { skipped++; continue }
            const storagePath = `${ctx.location.id}/${photo.hash}.jpg`
            await ctx.supabase.storage
              .from("location-photos")
              .upload(storagePath, photo.buffer, { contentType: photo.mimeType, upsert: true })
            ctx.state.ownDownloads.push(photo)
            downloaded++
          } catch (err) {
            ctx.state.warnings.push(`Own download: ${err instanceof Error ? err.message : "failed"}`)
          }
        }
        if (capped) {
          const msg = `Own-listing photo download capped at ${MAX_OWN_DOWNLOADS_PER_RUN}/run — resumes next run (dedup skips completed)`
          ctx.state.warnings.push(msg)
          console.log(`[Photos] ${msg}`)
        }
        return { downloaded, skipped, capped }
      },
    },
    {
      name: "analyze_own_vision",
      label: "Analyzing your listing photos with Gemini Vision",
      run: async (ctx) => {
        let analyzed = 0
        for (const photo of ctx.state.ownDownloads) {
          try {
            await sleep(300)
            const analysis = await analyzePhoto(photo.buffer, photo.mimeType)
            const storagePath = `${ctx.location.id}/${photo.hash}.jpg`
            const { data: urlData } = ctx.supabase.storage
              .from("location-photos")
              .getPublicUrl(storagePath)

            await ctx.supabase.from("location_photos").insert({
              location_id: ctx.location.id,
              place_photo_name: photo.reference.name,
              image_hash: photo.hash,
              image_url: urlData.publicUrl,
              width_px: photo.reference.widthPx,
              height_px: photo.reference.heightPx,
              author_attribution: photo.reference.authorAttributions as unknown as Record<string, unknown>,
              analysis_result: analysis as unknown as Record<string, unknown>,
              last_seen_at: new Date().toISOString(),
            })
            analyzed++
          } catch (err) {
            ctx.state.warnings.push(`Own vision analysis: ${err instanceof Error ? err.message : "failed"}`)
          }
        }
        return { own_analyzed: analyzed }
      },
    },
    {
      name: "load_competitors",
      label: "Loading competitors",
      run: async (ctx) => {
        return {
          competitor_count: ctx.competitors.length,
          names: ctx.competitors.map((c) => c.name).filter(Boolean),
        }
      },
    },
    {
      name: "fetch_photo_refs",
      label: "Fetching photo references from Google",
      run: async (ctx) => {
        let totalRefs = 0
        for (const comp of ctx.competitors) {
          if (!comp.provider_entity_id) continue
          try {
            const refs = await fetchPhotoReferences(comp.provider_entity_id)
            ctx.state.photoRefs.set(comp.id, refs)
            totalRefs += refs.length
          } catch (err) {
            ctx.state.warnings.push(`Photo refs for ${comp.name}: ${err instanceof Error ? err.message : "failed"}`)
          }
        }
        return { total_references: totalRefs }
      },
    },
    {
      name: "download_photos",
      label: "Downloading and hashing photos",
      run: async (ctx) => {
        let downloaded = 0
        let skipped = 0
        // Per-run cap so a single (weekly) photos job can't exceed the 300s function
        // limit on a first run with many photos. Gemini-Vision per photo is slow +
        // rate-limited. Hash dedup means the NEXT run skips what's done and continues,
        // so this chunks naturally across runs with no rework. Logged when it bites.
        const MAX_DOWNLOADS_PER_RUN = 24
        let capped = false
        for (const comp of ctx.competitors) {
          if (downloaded >= MAX_DOWNLOADS_PER_RUN) { capped = true; break }
          const refs = ctx.state.photoRefs.get(comp.id)
          if (!refs?.length) continue

          const { data: existing } = await ctx.supabase
            .from("competitor_photos")
            .select("image_hash")
            .eq("competitor_id", comp.id)
          const existingHashes = new Set((existing ?? []).map((r) => r.image_hash))

          const compDownloads: Array<FetchedPhoto & { competitorId: string }> = []
          for (const ref of refs.slice(0, 30)) {
            if (downloaded >= MAX_DOWNLOADS_PER_RUN) { capped = true; break }
            try {
              await sleep(250)
              const photo = await downloadPhoto(ref.name)
              // Overwrite the placeholder reference with the richer one from fetchPhotoReferences
              photo.reference = { ...photo.reference, widthPx: ref.widthPx, heightPx: ref.heightPx, authorAttributions: ref.authorAttributions }
              if (existingHashes.has(photo.hash)) {
                skipped++
                continue
              }
              const storagePath = `${comp.id}/${photo.hash}.jpg`
              await ctx.supabase.storage
                .from("competitor-photos")
                .upload(storagePath, photo.buffer, { contentType: photo.mimeType, upsert: true })

              compDownloads.push({ ...photo, competitorId: comp.id })
              downloaded++
            } catch (err) {
              ctx.state.warnings.push(`Download for ${comp.name}: ${err instanceof Error ? err.message : "failed"}`)
            }
          }
          ctx.state.downloads.set(comp.id, compDownloads)
        }
        if (capped) {
          const msg = `Photo download capped at ${MAX_DOWNLOADS_PER_RUN}/run — remaining photos resume next run (dedup skips completed)`
          ctx.state.warnings.push(msg)
          console.log(`[Photos] ${msg}`)
        }
        return { downloaded, skipped, capped }
      },
    },
    {
      name: "analyze_vision",
      label: "Analyzing photos with Gemini Vision",
      run: async (ctx) => {
        let analyzed = 0
        for (const [compId, photos] of ctx.state.downloads) {
          const results: Array<{ hash: string; analysis: PhotoAnalysis }> = []
          for (const photo of photos) {
            try {
              await sleep(300)
              const analysis = await analyzePhoto(photo.buffer, photo.mimeType)
              results.push({ hash: photo.hash, analysis })

              const storagePath = `${compId}/${photo.hash}.jpg`
              const { data: urlData } = ctx.supabase.storage
                .from("competitor-photos")
                .getPublicUrl(storagePath)

              await ctx.supabase.from("competitor_photos").upsert({
                competitor_id: compId,
                place_photo_name: photo.reference.name,
                image_hash: photo.hash,
                image_url: urlData.publicUrl,
                width_px: photo.reference.widthPx,
                height_px: photo.reference.heightPx,
                author_attribution: photo.reference.authorAttributions as unknown as Record<string, unknown>,
                analysis_result: analysis as unknown as Record<string, unknown>,
                last_seen_at: new Date().toISOString(),
              }, { onConflict: "id" })

              analyzed++
            } catch (err) {
              ctx.state.warnings.push(`Vision analysis: ${err instanceof Error ? err.message : "failed"}`)
            }
          }
          ctx.state.analyses.set(compId, results)
        }
        return { analyzed }
      },
    },
    {
      name: "generate_photo_insights",
      label: "Generating photo insights",
      run: async (ctx) => {
        for (const comp of ctx.competitors) {
          const currentAnalyses = ctx.state.analyses.get(comp.id)
          if (!currentAnalyses?.length) continue

          const { data: allPhotos } = await ctx.supabase
            .from("competitor_photos")
            .select("image_hash, analysis_result")
            .eq("competitor_id", comp.id)

          const allCurrent = (allPhotos ?? []).map((p) => ({
            hash: p.image_hash,
            analysis: p.analysis_result as PhotoAnalysis | null,
          }))

          const diff = diffPhotos(allCurrent, new Set(), {})
          const insights = generatePhotoInsights({
            competitorName: comp.name ?? "Competitor",
            competitorId: comp.id,
            diff,
            currentPhotos: allCurrent,
          })

          for (const ins of insights) {
            ctx.state.insightsPayload.push({
              location_id: ctx.locationId,
              competitor_id: comp.id,
              date_key: ctx.dateKey,
              ...ins,
              status: "new",
            })
          }
        }

        if (ctx.state.insightsPayload.length > 0) {
          await ctx.supabase.from("insights").upsert(ctx.state.insightsPayload, {
            onConflict: "location_id,competitor_id,date_key,insight_type",
          })
        }

        return {
          insights_generated: ctx.state.insightsPayload.length,
          warnings: ctx.state.warnings,
        }
      },
    },
  ]
}

export async function buildPhotosContext(
  supabase: SupabaseClient,
  locationId: string,
  organizationId: string
): Promise<PhotosPipelineCtx> {
  const { data: location } = await supabase
    .from("locations")
    .select("id, name, primary_place_id")
    .eq("id", locationId)
    .eq("organization_id", organizationId)
    .maybeSingle()
  if (!location) throw new Error("Location not found")

  const { data: comps } = await supabase
    .from("competitors")
    .select("id, name, provider_entity_id, metadata")
    .eq("location_id", locationId)
    .eq("is_active", true)

  const competitors = (comps ?? [])
    .filter((c) => c.provider_entity_id && !c.provider_entity_id.startsWith("unknown:"))
    .map((c) => ({
      id: c.id,
      name: c.name,
      provider_entity_id: c.provider_entity_id,
    }))

  return {
    supabase,
    locationId,
    organizationId,
    dateKey: new Date().toISOString().slice(0, 10),
    location: {
      id: location.id,
      name: location.name,
      placeId: (location as { primary_place_id?: string | null }).primary_place_id ?? null,
    },
    competitors,
    state: {
      photoRefs: new Map(),
      downloads: new Map(),
      analyses: new Map(),
      ownPhotoRefs: [],
      ownDownloads: [],
      insightsPayload: [],
      warnings: [],
    },
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
