// ---------------------------------------------------------------------------
// Content Competitor Enrichment – reusable pipeline for a single competitor
// Used by: approveCompetitorAction, refreshContentAction
// ---------------------------------------------------------------------------

import { discoverAllMenuUrls, scrapeMenuPage } from "@/lib/providers/firecrawl"
import { normalizeExtractedMenu, normalizeGoogleMenuData, mergeExtractedMenus } from "@/lib/content/menu-parse"
import type { NormalizedMenuResult } from "@/lib/content/menu-parse"
import { fetchGoogleMenuData } from "@/lib/ai/gemini"
import { buildMenuSnapshot, computeMenuDiffHash } from "@/lib/content/normalize"
import { uploadScreenshot, buildScreenshotPath } from "@/lib/content/storage"
import type { MenuSource } from "@/lib/content/types"
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

  try {
    const compUrl = ensureUrl(website)
    const sources: MenuSource[] = []

    // Discover menu URLs (cap at 2 for competitors)
    let compMenuUrls = await discoverAllMenuUrls(compUrl, 2)
    if (compMenuUrls.length === 0) {
      compMenuUrls = [compUrl]
    }

    // Scrape each URL and merge
    const compParsedResults: NormalizedMenuResult[] = []
    let compScreenshotPath: string | null = null
    let compScreenshotSourceUrl: string | null = null

    for (const targetUrl of compMenuUrls) {
      try {
        const menuResult = await scrapeMenuPage(targetUrl)
        if (menuResult) {
          if (!compScreenshotPath && menuResult.screenshot) {
            const path = buildScreenshotPath(organizationId, "competitors", competitorId, "menu.png")
            compScreenshotPath = await uploadScreenshot(menuResult.screenshot, path)
            compScreenshotSourceUrl = targetUrl
          }
          const parsed = normalizeExtractedMenu(menuResult.menu)
          if (parsed.categories.length > 0) {
            compParsedResults.push(parsed)
          }
        }
      } catch {
        // Continue to next URL
      }
    }

    if (compParsedResults.length > 0) sources.push("firecrawl")

    // Gemini + Google Search Grounding for richer menu data
    try {
      const googleMenu = await fetchGoogleMenuData(competitorName, competitorAddress ?? null)
      if (googleMenu && googleMenu.categories.length > 0) {
        compParsedResults.push(normalizeGoogleMenuData(googleMenu))
        sources.push("gemini_google_search")
      }
    } catch {
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
        merged.currency
      )
      compMenu.parseMeta.sources = sources

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
        console.warn(`[Content Enrich] Snapshot save failed for ${competitorName}:`, error.message)
        warnings.push(`Menu snapshot save failed for ${competitorName}`)
      } else {
        console.log(`[Content Enrich] Menu saved for ${competitorName}: ${compMenu.parseMeta.itemsTotal} items (sources: ${sources.join(" + ")})`)
      }
    } else {
      warnings.push(`No menu content found for ${competitorName}`)
    }
  } catch (err) {
    console.warn(`[Content Enrich] Failed for ${competitorName}:`, err)
    warnings.push(`Content scrape failed for ${competitorName}`)
  }

  return { warnings }
}
