// ---------------------------------------------------------------------------
// Content Competitor Enrichment – reusable pipeline for a single competitor
// Used by: approveCompetitorAction, refreshContentAction
// ---------------------------------------------------------------------------

import { discoverAllMenuUrls } from "@/lib/providers/firecrawl"
import {
  normalizeGoogleMenuData,
  mergeExtractedMenus,
  MENU_HISTORY_WINDOW,
} from "@/lib/content/menu-parse"
import type { NormalizedMenuResult } from "@/lib/content/menu-parse"
import { captureMenuPages } from "@/lib/content/menu-capture"
import { collectPageHistory } from "@/lib/content/menu-thin-read"
import { fetchGoogleMenuData } from "@/lib/ai/gemini"
import { buildMenuSnapshot, computeMenuDiffHash } from "@/lib/content/normalize"
import { uploadScreenshot, buildScreenshotPath } from "@/lib/content/storage"
import { newMenuObservation, recordMenuIngestEvent } from "@/lib/content/menu-telemetry"
import type { MenuSnapshot, MenuSource } from "@/lib/content/types"
import type { SupabaseClient } from "@supabase/supabase-js"

// ---------------------------------------------------------------------------
// enrichCompetitorContent – multi-URL scrape + Gemini Google + merge
// ---------------------------------------------------------------------------

function ensureUrl(url: string): string {
  if (url.startsWith("http")) return url
  return `https://${url}`
}

export async function enrichCompetitorContent(
  competitorId: string,
  competitorName: string,
  website: string,
  organizationId: string,
  dateKey: string,
  supabase: SupabaseClient,
  competitorAddress?: string | null
): Promise<{ warnings: string[] }> {
  const warnings: string[] = []

  // ALT-363 menu reliability telemetry: observation only, never influences this function's
  // behaviour. Mutated as stages complete, recorded once at the end (fire-and-forget).
  const obs = newMenuObservation()
  obs.hasWebsite = website.trim().length > 0
  const sources: MenuSource[] = []

  try {
    const compUrl = ensureUrl(website)

    // Discover menu URLs (cap at 2 for competitors)
    let compMenuUrls = await discoverAllMenuUrls(compUrl, 2)
    obs.urlsDiscovered = compMenuUrls.length
    if (compMenuUrls.length === 0) {
      compMenuUrls = [compUrl]
    }

    // Scrape each URL and merge. Thin reads are re-read once and then dropped rather than
    // stored (lib/content/menu-capture.ts).
    const { data: priorSnaps } = await supabase
      .from("snapshots")
      .select("raw_data")
      .eq("competitor_id", competitorId)
      .eq("snapshot_type", "web_menu_weekly")
      .order("date_key", { ascending: false })
      .limit(MENU_HISTORY_WINDOW)

    const capture = await captureMenuPages({
      urls: compMenuUrls,
      pageHistory: collectPageHistory((priorSnaps ?? []).map((r) => r.raw_data as MenuSnapshot)),
      obs,
      uploadScreenshot: (screenshot) =>
        uploadScreenshot(
          screenshot,
          buildScreenshotPath(organizationId, "competitors", competitorId, "menu.png")
        ),
      onWarning: (message) => warnings.push(message),
    })

    const compParsedResults: NormalizedMenuResult[] = [...capture.results]
    const compScreenshotPath = capture.screenshotPath
    const compScreenshotSourceUrl = capture.screenshotSourceUrl

    if (compParsedResults.length > 0) sources.push("firecrawl")

    // Gemini + Google Search Grounding for richer menu data
    try {
      const googleMenu = await fetchGoogleMenuData(competitorName, competitorAddress ?? null)
      if (googleMenu && googleMenu.categories.length > 0) {
        compParsedResults.push(normalizeGoogleMenuData(googleMenu))
        sources.push("gemini_google_search")
        obs.enrichment = "items"
      } else {
        // fetchGoogleMenuData returns null on any error (HTTP, unparseable JSON) and a
        // zero-category result when Google genuinely had nothing.
        obs.enrichment = googleMenu ? "empty" : "error"
      }
    } catch {
      obs.enrichment = "error"
      // Non-fatal
    }

    if (compParsedResults.length > 0) {
      const merged = mergeExtractedMenus(compParsedResults)
      const compMenu = buildMenuSnapshot(
        compMenuUrls[0],
        merged.categories,
        merged.confidence,
        merged.notes,
        compScreenshotPath
          ? { storagePath: compScreenshotPath, sourceUrl: compScreenshotSourceUrl ?? compUrl }
          : null,
        merged.currency,
        capture.pages
      )
      compMenu.parseMeta.sources = sources
      obs.mergedItems = compMenu.parseMeta.itemsTotal

      // Store in snapshots table (competitor-scoped)
      const menuHash = computeMenuDiffHash(compMenu)
      const { error } = await supabase.from("snapshots").upsert(
        {
          competitor_id: competitorId,
          date_key: dateKey,
          snapshot_type: "web_menu_weekly",
          captured_at: new Date().toISOString(),
          provider: "firecrawl_menu",
          raw_data: compMenu as unknown as Record<string, unknown>,
          diff_hash: menuHash,
        },
        { onConflict: "competitor_id,date_key,snapshot_type" }
      )

      if (error) {
        obs.saveError = error.message
        console.warn(`[Content Enrich] Snapshot save failed for ${competitorName}:`, error.message)
        warnings.push(`Menu snapshot save failed for ${competitorName}`)
      } else {
        console.log(`[Content Enrich] Menu saved for ${competitorName}: ${compMenu.parseMeta.itemsTotal} items (sources: ${sources.join(" + ")})`)
      }
    } else {
      warnings.push(`No menu content found for ${competitorName}`)
    }
  } catch (err) {
    obs.pipelineError = err instanceof Error ? err.message : String(err)
    console.warn(`[Content Enrich] Failed for ${competitorName}:`, err)
    warnings.push(`Content scrape failed for ${competitorName}`)
  }

  // Fire-and-forget (callers are user-facing server actions): never awaited, never throws.
  void recordMenuIngestEvent({
    runSource: "competitor_enrich",
    target: "competitor",
    competitorId,
    dateKey,
    observation: obs,
    sources,
  })

  return { warnings }
}
