import { cacheTag, cacheLife } from "next/cache"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { loadLocationMenu, loadCompetitorMenu } from "@/lib/content/menu-history"

export type CachedContentResult = {
  siteContentSnap: { raw_data: unknown; date_key: string } | null
  menuSnap: { raw_data: unknown; date_key: string } | null
  competitors: Array<{ id: string; name: string; metadata: unknown }>
  competitorMenuSnaps: Array<{ competitor_id: string; raw_data: unknown }>
}

export async function fetchContentPageData(
  locationId: string,
): Promise<CachedContentResult> {
  "use cache"
  cacheTag("content-data")
  cacheLife({ revalidate: 604800 })

  const supabase = createAdminSupabaseClient()

  // ALT-740: the /content page was the FIFTH copy of "read the single latest raw menu scrape",
  // the one the ALT-363 union fix missed. On a day the scrape returned 3 items, this page showed a
  // 3-item menu for a menu we knew ran to 110, while every producer skill saw the union. Same
  // symptom, different surface. Both reads below now go through lib/content/menu-history, which is
  // the one place that unions the recent window and takes freshness from the newest RAW capture.
  const [{ data: siteSnap }, ownMenu, { data: comps }] = await Promise.all([
    supabase
      .from("location_snapshots")
      .select("raw_data, date_key")
      .eq("location_id", locationId)
      .eq("provider", "firecrawl_site_content")
      .order("date_key", { ascending: false })
      .limit(1)
      .maybeSingle(),
    loadLocationMenu(supabase, locationId),
    supabase
      .from("competitors")
      .select("id, name, metadata, is_active")
      .eq("location_id", locationId)
      .eq("is_active", true),
  ])

  const approved = (comps ?? []).filter(
    (c) => (c.metadata as Record<string, unknown>)?.status === "approved"
  )

  // ALT-740: competitor menus went through the same single-latest read. The dossier already
  // unions these (build.ts), so the page and the brief could disagree about the same competitor's
  // menu on the same day.
  const competitorMenuSnaps: Array<{ competitor_id: string; raw_data: unknown }> = []
  for (const comp of approved) {
    const read = await loadCompetitorMenu(supabase, comp.id)
    if (read.menu) {
      competitorMenuSnaps.push({ competitor_id: comp.id, raw_data: read.menu as unknown })
    }
  }

  return {
    siteContentSnap: siteSnap ? { raw_data: siteSnap.raw_data, date_key: siteSnap.date_key } : null,
    menuSnap: ownMenu.menu ? { raw_data: ownMenu.menu as unknown, date_key: ownMenu.dateKey ?? "" } : null,
    competitors: approved.map((c) => ({ id: c.id, name: c.name ?? "Competitor", metadata: c.metadata })),
    competitorMenuSnaps,
  }
}
