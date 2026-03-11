import { unstable_cache } from "next/cache"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

export type CachedContentResult = {
  siteContentSnap: { raw_data: unknown; date_key: string } | null
  menuSnap: { raw_data: unknown; date_key: string } | null
  competitors: Array<{ id: string; name: string; metadata: unknown }>
  competitorMenuSnaps: Array<{ competitor_id: string; raw_data: unknown }>
}

async function fetchContentPageDataRaw(
  locationId: string,
): Promise<CachedContentResult> {
  const supabase = createAdminSupabaseClient()

  const [{ data: siteSnap }, { data: menuSnapRow }, { data: comps }] = await Promise.all([
    supabase
      .from("location_snapshots")
      .select("raw_data, date_key")
      .eq("location_id", locationId)
      .eq("provider", "firecrawl_site_content")
      .order("date_key", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("location_snapshots")
      .select("raw_data, date_key")
      .eq("location_id", locationId)
      .eq("provider", "firecrawl_menu")
      .order("date_key", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("competitors")
      .select("id, name, metadata, is_active")
      .eq("location_id", locationId)
      .eq("is_active", true),
  ])

  const approved = (comps ?? []).filter(
    (c) => (c.metadata as Record<string, unknown>)?.status === "approved"
  )

  const competitorMenuSnaps: Array<{ competitor_id: string; raw_data: unknown }> = []
  for (const comp of approved) {
    const { data: compMenuSnap } = await supabase
      .from("snapshots")
      .select("raw_data")
      .eq("competitor_id", comp.id)
      .eq("snapshot_type", "web_menu_weekly")
      .order("date_key", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (compMenuSnap) {
      competitorMenuSnaps.push({ competitor_id: comp.id, raw_data: compMenuSnap.raw_data })
    }
  }

  return {
    siteContentSnap: siteSnap ? { raw_data: siteSnap.raw_data, date_key: siteSnap.date_key } : null,
    menuSnap: menuSnapRow ? { raw_data: menuSnapRow.raw_data, date_key: menuSnapRow.date_key } : null,
    competitors: approved.map((c) => ({ id: c.id, name: c.name ?? "Competitor", metadata: c.metadata })),
    competitorMenuSnaps,
  }
}

export const fetchContentPageData = unstable_cache(
  fetchContentPageDataRaw,
  ["content-page-data"],
  { revalidate: 604800, tags: ["content-data"] }
)
