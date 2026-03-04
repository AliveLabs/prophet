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
  competitors: Array<{
    id: string
    name: string | null
    provider_entity_id: string | null
  }>
  state: {
    photoRefs: Map<string, PhotoReference[]>
    downloads: Map<string, Array<FetchedPhoto & { competitorId: string }>>
    analyses: Map<string, Array<{ hash: string; analysis: PhotoAnalysis }>>
    insightsPayload: Array<Record<string, unknown>>
    warnings: string[]
  }
}

export function buildPhotosSteps(): PipelineStepDef<PhotosPipelineCtx>[] {
  return [
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
        for (const comp of ctx.competitors) {
          const refs = ctx.state.photoRefs.get(comp.id)
          if (!refs?.length) continue

          const { data: existing } = await ctx.supabase
            .from("competitor_photos")
            .select("image_hash")
            .eq("competitor_id", comp.id)
          const existingHashes = new Set((existing ?? []).map((r) => r.image_hash))

          const compDownloads: Array<FetchedPhoto & { competitorId: string }> = []
          for (const ref of refs.slice(0, 5)) {
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
        return { downloaded, skipped }
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
    .select("id, name")
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
    competitors,
    state: {
      photoRefs: new Map(),
      downloads: new Map(),
      analyses: new Map(),
      insightsPayload: [],
      warnings: [],
    },
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
