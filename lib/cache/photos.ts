import { cacheTag, cacheLife } from "next/cache"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

// Loose read for location_photos — the table lands with the ALT-160 migration and
// isn't in the generated DB types yet (same pattern the page/lib layers use for
// not-yet-regenerated tables). Drop this cast once `supabase gen types` is re-run.
type LooseSelect = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (c: string, v: string) => {
        order: (c: string, o: { ascending: boolean }) => Promise<{ data: unknown[] | null }>
      }
    }
  }
}

export type CachedOwnPhoto = {
  id: string
  location_id: string
  image_url: string | null
  image_hash: string | null
  analysis_result: unknown
  /** ALT-160: drives the owner-vs-customer split (an attribution to the business
   *  vs a third-party reviewer). Best-estimate — the module hides the split when
   *  attribution is sparse rather than guessing. */
  author_attribution: unknown
  first_seen_at: string | null
  created_at: string
}

export type CachedPhotosResult = {
  photos: Array<{
    id: string
    competitor_id: string
    image_url: string | null
    image_hash: string | null
    analysis_result: unknown
    first_seen_at: string | null
    created_at: string
  }>
  /** ALT-160: the operator's OWN Google-listing photos (owner + customer uploads). */
  ownPhotos: CachedOwnPhoto[]
  insights: Array<{
    id: string
    title: string
    summary: string
    severity: string
    insight_type: string
    date_key: string
    evidence: unknown
    recommendations: unknown
  }>
}

/** ALT-160/ALT-152: the operator's own Google-listing photos, shared by the
 *  /photos page (full audit) and anywhere else that needs an own-location
 *  image fallback (e.g. social post cards with no usable photo of their own). */
export async function fetchOwnPhotos(locationId: string): Promise<CachedOwnPhoto[]> {
  "use cache"
  cacheTag("photos-data")
  cacheLife({ revalidate: 604800 })

  if (!locationId) return []
  const supabase = createAdminSupabaseClient()
  const { data } = await (supabase as unknown as LooseSelect)
    .from("location_photos")
    .select("id, location_id, image_url, image_hash, analysis_result, author_attribution, first_seen_at, created_at")
    .eq("location_id", locationId)
    .order("created_at", { ascending: false })
  return (data ?? []) as CachedOwnPhoto[]
}

export async function fetchPhotosPageData(
  locationId: string,
  competitorIds: string[],
): Promise<CachedPhotosResult> {
  "use cache"
  cacheTag("photos-data")
  cacheLife({ revalidate: 604800 })

  const supabase = createAdminSupabaseClient()

  const [{ data: photosRaw }, ownPhotos, { data: insightsRaw }] = await Promise.all([
    competitorIds.length > 0
      ? supabase
          .from("competitor_photos")
          .select("id, competitor_id, image_url, image_hash, analysis_result, first_seen_at, created_at")
          .in("competitor_id", competitorIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    fetchOwnPhotos(locationId),
    supabase
      .from("insights")
      .select("id, title, summary, severity, insight_type, date_key, evidence, recommendations")
      .eq("location_id", locationId)
      .or("insight_type.like.photo.%,insight_type.like.visual.%")
      .order("date_key", { ascending: false })
      .limit(8),
  ])

  return {
    photos: (photosRaw ?? []) as CachedPhotosResult["photos"],
    ownPhotos,
    insights: (insightsRaw ?? []) as CachedPhotosResult["insights"],
  }
}
