// ---------------------------------------------------------------------------
// Menu history access: ONE place that knows how to read a location's recent menu
// captures and turn them into the menu the rest of the product is allowed to reason over.
//
// WHY THIS FILE EXISTS
//
// A single weekly scrape of the same restaurant is wildly unstable. Measured in prod on
// 2026-08-14 across 21 weekly reads of one location: itemsTotal ran 12, 30, 49, 49, 54, 62,
// 69, 70, 71, 81, 81, 89, 96, 98, 104, 112, 135, 137, 147, 149, 169. That is site and vendor
// reality, not a scraper bug. `unionRecentMenus` is the defense, and the insights pipeline
// used it, but `buildDossier` did not: it read the single latest RAW snapshot, so on the week
// the scrape returned 12 items every producer skill was handed a 12-item menu as ground truth
// and wrote confident claims about it.
//
// The query itself was duplicated in four places, which is how the dossier drifted away from
// the pipelines in the first place. Every caller now goes through here, so the window
// constant, the ordering, and the union cannot diverge again.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js"
import type { MenuSnapshot } from "@/lib/content/types"
import { unionRecentMenus, MENU_HISTORY_WINDOW } from "@/lib/content/menu-parse"

export const MENU_SNAPSHOT_PROVIDER = "firecrawl_menu"
export const COMPETITOR_MENU_SNAPSHOT_TYPE = "web_menu_weekly"

export type LocationMenuHistory = {
  /** Raw per-run snapshots, NEWEST-FIRST, up to MENU_HISTORY_WINDOW. */
  history: MenuSnapshot[]
  /** date_key of the newest raw capture, for freshness reporting. Null when there are none. */
  latestDateKey: string | null
}

export type UnionedLocationMenu = LocationMenuHistory & {
  /**
   * The cross-run union of the recent window, coverage-stamped. This is what any consumer
   * making CLAIMS about the menu should use. Null when the location has no captures at all.
   */
  menu: MenuSnapshot | null
}

/**
 * A location's recent raw menu captures, newest-first.
 *
 * Callers that need the true per-run series (sustained-change detection, diff hashing) want
 * THIS, not the union: the change detector's thin-read and one-run-blip guards are meaningless
 * against a smoothed union.
 */
export async function loadRecentLocationMenus(
  supabase: SupabaseClient,
  locationId: string,
): Promise<LocationMenuHistory> {
  const { data, error } = await supabase
    .from("location_snapshots")
    .select("raw_data, date_key")
    .eq("location_id", locationId)
    .eq("provider", MENU_SNAPSHOT_PROVIDER)
    .order("date_key", { ascending: false })
    .limit(MENU_HISTORY_WINDOW)

  if (error) {
    // Loud: a read failure and "this location has no menu yet" are both an empty history to
    // the caller, and silently collapsing them is how a degraded dossier hides.
    console.warn(`[menu-history] menu snapshot read failed (location ${locationId}): ${error.message}`)
    return { history: [], latestDateKey: null }
  }

  const rows = data ?? []
  return {
    history: rows.map((r) => r.raw_data as MenuSnapshot),
    latestDateKey: (rows[0]?.date_key as string) ?? null,
  }
}

/**
 * The menu a consumer is allowed to make claims about: the union of the recent window, with
 * `coverageRatio` / `historicalHighItems` / a coverage-derived `confidence` stamped on.
 *
 * The raw history rides along so a caller that also needs the per-run series (the content and
 * insights pipelines both do) still issues exactly one query.
 */
export async function loadUnionedLocationMenu(
  supabase: SupabaseClient,
  locationId: string,
): Promise<UnionedLocationMenu> {
  const { history, latestDateKey } = await loadRecentLocationMenus(supabase, locationId)
  return { menu: unionRecentMenus(history), history, latestDateKey }
}

/** Which entity's prior menu reads to count. Exactly one field is set. */
export type MenuCountTarget = { locationId: string } | { competitorId: string }

/**
 * Item counts of an entity's PRIOR menu reads, for coverage-stamping a read at write time.
 *
 * Only the counts are needed, so this projects `parseMeta.itemsTotal` out of the jsonb rather
 * than dragging back a dozen full menus per entity per run (the content job already fights a
 * 300s ceiling). If the projection is rejected, it falls back to reading the rows whole:
 * losing coverage stamping is a real regression, and it is cheap to not risk it.
 */
export async function loadPriorMenuItemCounts(
  supabase: SupabaseClient,
  target: MenuCountTarget,
): Promise<number[]> {
  const label = "locationId" in target ? `location ${target.locationId}` : `competitor ${target.competitorId}`

  const base = () =>
    "locationId" in target
      ? supabase
          .from("location_snapshots")
          .select("items:raw_data->parseMeta->>itemsTotal")
          .eq("location_id", target.locationId)
          .eq("provider", MENU_SNAPSHOT_PROVIDER)
      : supabase
          .from("snapshots")
          .select("items:raw_data->parseMeta->>itemsTotal")
          .eq("competitor_id", target.competitorId)
          .eq("snapshot_type", COMPETITOR_MENU_SNAPSHOT_TYPE)

  const { data, error } = await base().order("date_key", { ascending: false }).limit(MENU_HISTORY_WINDOW)
  if (!error) return toCounts((data ?? []) as Array<{ items: unknown }>, (r) => r.items)

  console.warn(`[menu-history] item-count projection failed (${label}): ${error.message}; re-reading rows whole`)

  const whole =
    "locationId" in target
      ? supabase
          .from("location_snapshots")
          .select("raw_data")
          .eq("location_id", target.locationId)
          .eq("provider", MENU_SNAPSHOT_PROVIDER)
      : supabase
          .from("snapshots")
          .select("raw_data")
          .eq("competitor_id", target.competitorId)
          .eq("snapshot_type", COMPETITOR_MENU_SNAPSHOT_TYPE)

  const { data: rows, error: fallbackError } = await whole.order("date_key", { ascending: false }).limit(MENU_HISTORY_WINDOW)
  if (fallbackError) {
    console.warn(`[menu-history] menu item-count read failed (${label}): ${fallbackError.message}`)
    return []
  }
  return toCounts((rows ?? []) as Array<{ raw_data: unknown }>, (r) => (r.raw_data as MenuSnapshot | null)?.parseMeta?.itemsTotal)
}

/** Coerce projected/extracted counts to finite positive numbers; anything else is dropped,
 *  matching menuCoverage's own "usable read" rule. */
function toCounts<T>(rows: T[], pick: (row: T) => unknown): number[] {
  const counts: number[] = []
  for (const row of rows) {
    const n = Number(pick(row))
    if (Number.isFinite(n) && n > 0) counts.push(n)
  }
  return counts
}
