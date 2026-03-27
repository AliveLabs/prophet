import { cacheTag, cacheLife } from "next/cache"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

export type CachedVisibilityResult = {
  snapshots: Record<string, { raw_data: unknown; date_key: string } | null>
  trackedKwCount: number
  competitors: Array<{ id: string; name: string; website: string | null }>
  intersectionSnaps: Array<{ raw_data: unknown }>
}

const SEO_PROVIDERS = [
  "seo_domain_rank_overview",
  "seo_ranked_keywords",
  "seo_serp_keywords",
  "seo_competitors_domain",
  "seo_relevant_pages",
  "seo_subdomains",
  "seo_historical_rank",
  "seo_ads_search",
] as const

export async function fetchVisibilityPageData(
  locationId: string,
): Promise<CachedVisibilityResult> {
  "use cache"
  cacheTag("visibility-data")
  cacheLife({ revalidate: 604800 })

  const supabase = createAdminSupabaseClient()

  const snapResults = await Promise.all(
    SEO_PROVIDERS.map(async (provider) => {
      const { data } = await supabase
        .from("location_snapshots")
        .select("raw_data, date_key")
        .eq("location_id", locationId)
        .eq("provider", provider)
        .order("date_key", { ascending: false })
        .limit(1)
        .maybeSingle()
      return [provider, data] as const
    })
  )

  const snapshots: Record<string, { raw_data: unknown; date_key: string } | null> = {}
  for (const [provider, data] of snapResults) {
    snapshots[provider] = data ? { raw_data: data.raw_data, date_key: data.date_key } : null
  }

  const { count } = await supabase
    .from("tracked_keywords")
    .select("id", { count: "exact", head: true })
    .eq("location_id", locationId)
    .eq("is_active", true)

  const { data: comps } = await supabase
    .from("competitors")
    .select("id, name, website")
    .eq("location_id", locationId)
    .eq("is_active", true)

  const competitors = (comps ?? []) as CachedVisibilityResult["competitors"]
  const compIds = competitors.map((c) => c.id)

  let intersectionSnaps: Array<{ raw_data: unknown }> = []
  if (compIds.length > 0) {
    const { data } = await supabase
      .from("snapshots")
      .select("raw_data")
      .in("competitor_id", compIds)
      .eq("snapshot_type", "seo_domain_intersection_weekly")
      .order("date_key", { ascending: false })
      .limit(5)
    intersectionSnaps = (data ?? []) as Array<{ raw_data: unknown }>
  }

  return {
    snapshots,
    trackedKwCount: count ?? 0,
    competitors,
    intersectionSnaps,
  }
}
