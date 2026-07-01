// Server helper: load the resolved hero-photo covers for a location — the operator's
// own-listing cover + one picked cover per approved competitor. Used by the play-detail
// page so its hero matches the brief's subject-matched imagery. The home brief computes
// the same covers inline from photo data it already fetches (no double query).
//
// pickCoverPhoto is a pure ranking over rows the /photos page already caches, so this
// adds no new Places calls — only the cached photo read + the competitor list.

import { createServerSupabaseClient } from "@/lib/supabase/server"
import { fetchPhotosPageData } from "@/lib/cache/photos"
import { pickCoverPhotoWithFocal, type PhotoRow } from "@/lib/places/listing-audit"
import type { FocalPoint } from "@/lib/providers/photos"

export type HeroCovers = {
  /** the operator's own-listing photo rows — the resolver category-matches within these */
  ownPhotos: PhotoRow[]
  /** one picked cover per competitor that has a usable photo (url + focal for crop anchoring) */
  competitorCovers: Array<{ name: string; url: string; focal: FocalPoint }>
}

export async function loadHeroCovers(locationId: string): Promise<HeroCovers> {
  const supabase = await createServerSupabaseClient()
  const { data: comps } = await supabase
    .from("competitors")
    .select("id, name, metadata")
    .eq("location_id", locationId)
    .eq("is_active", true)

  const approved = (comps ?? [])
    .filter((c) => (c.metadata as Record<string, unknown> | null)?.status === "approved")
    .map((c) => ({ id: (c as { id: string }).id, name: ((c.name as string) ?? "Competitor") }))

  const photos = await fetchPhotosPageData(locationId, approved.map((c) => c.id))

  const ownPhotos = photos.ownPhotos.map((p): PhotoRow => ({ analysis_result: p.analysis_result, image_url: p.image_url }))
  return { ownPhotos, competitorCovers: competitorCoversFrom(photos.photos, new Map(approved.map((c) => [c.id, c.name]))) }
}

/** Pure: pick one cover per competitor from their photo rows. Shared by the brief page
 *  (which passes photo data it already has) and loadHeroCovers. */
export function competitorCoversFrom(
  photos: Array<{ competitor_id: string; analysis_result: unknown; image_url: string | null }>,
  nameById: Map<string, string>,
): Array<{ name: string; url: string; focal: FocalPoint }> {
  const rowsById = new Map<string, PhotoRow[]>()
  for (const p of photos) {
    const arr = rowsById.get(p.competitor_id) ?? []
    arr.push({ analysis_result: p.analysis_result, image_url: p.image_url })
    rowsById.set(p.competitor_id, arr)
  }
  const out: Array<{ name: string; url: string; focal: FocalPoint }> = []
  for (const [id, rows] of rowsById) {
    const picked = pickCoverPhotoWithFocal(rows)
    if (picked) out.push({ name: nameById.get(id) ?? "Competitor", url: picked.url, focal: picked.focal })
  }
  return out
}
