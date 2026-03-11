import { unstable_cache } from "next/cache"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

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

async function fetchPhotosPageDataRaw(
  locationId: string,
  competitorIds: string[],
): Promise<CachedPhotosResult> {
  const supabase = createAdminSupabaseClient()

  const [{ data: photosRaw }, { data: insightsRaw }] = await Promise.all([
    competitorIds.length > 0
      ? supabase
          .from("competitor_photos")
          .select("id, competitor_id, image_url, image_hash, analysis_result, first_seen_at, created_at")
          .in("competitor_id", competitorIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
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
    insights: (insightsRaw ?? []) as CachedPhotosResult["insights"],
  }
}

export const fetchPhotosPageData = unstable_cache(
  fetchPhotosPageDataRaw,
  ["photos-page-data"],
  { revalidate: 604800, tags: ["photos-data"] }
)
