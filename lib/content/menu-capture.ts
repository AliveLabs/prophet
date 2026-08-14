// ---------------------------------------------------------------------------
// One menu capture: scrape each candidate URL, reject thin reads, report what happened.
//
// This existed four times, copy-pasted, across lib/jobs/pipelines/content.ts (location and
// competitor), lib/content/enrich.ts and app/(dashboard)/content/actions.ts. Thin-read
// rejection has to hold on every path or it holds on none, so the loop lives here now.
//
// The rule: a page yielding dramatically fewer items than that same URL's own recent history
// is a failed scrape (lib/content/menu-thin-read.ts). scrapeMenuPage re-reads it once with a
// hardened render; if it is still thin, the read is DROPPED rather than merged. Dropping
// costs one page of freshness, which unionRecentMenus already covers from prior weeks.
// Merging it would write a number nothing downstream can tell from truth.
// ---------------------------------------------------------------------------

import { scrapeMenuPage } from "@/lib/providers/firecrawl"
import { normalizeExtractedMenu } from "@/lib/content/menu-parse"
import type { NormalizedMenuResult } from "@/lib/content/menu-parse"
import { menuPageBaseline } from "@/lib/content/menu-thin-read"
import type { MenuStageObservation } from "@/lib/content/menu-telemetry"
import type { MenuPageRead } from "@/lib/content/types"

export type MenuCaptureResult = {
  /** Accepted per-page menus, ready for mergeExtractedMenus. */
  results: NormalizedMenuResult[]
  /** Every URL attempted, accepted or not. Stored on parseMeta.pages as next run's history. */
  pages: MenuPageRead[]
  screenshotPath: string | null
  screenshotSourceUrl: string | null
}

export type MenuCaptureParams = {
  urls: string[]
  /** Per-URL item counts from recent snapshots (collectPageHistory). */
  pageHistory: Map<string, number[]>
  /** ALT-363 observation, mutated in place. Observation only; never steers this function. */
  obs: MenuStageObservation
  /** Upload the first screenshot we get. Returns the stored path, or null. */
  uploadScreenshot?: (screenshot: string) => Promise<string | null>
  onWarning?: (message: string) => void
}

export async function captureMenuPages(params: MenuCaptureParams): Promise<MenuCaptureResult> {
  const { urls, pageHistory, obs, uploadScreenshot, onWarning } = params

  const results: NormalizedMenuResult[] = []
  const pages: MenuPageRead[] = []
  let screenshotPath: string | null = null
  let screenshotSourceUrl: string | null = null

  for (const url of urls) {
    obs.scrapeAttempts++
    try {
      const expectedItems = menuPageBaseline(pageHistory.get(url) ?? [])
      const read = await scrapeMenuPage(url, { expectedItems })
      if (!read) {
        obs.scrapeErrors++
        continue
      }

      obs.scrapeRetries += Math.max(0, read.attempts - 1)

      if (!screenshotPath && read.screenshot && uploadScreenshot) {
        screenshotPath = await uploadScreenshot(read.screenshot)
        if (screenshotPath) screenshotSourceUrl = url
      }

      pages.push({
        url,
        items: read.itemsTotal,
        extractor: read.extractor,
        thin: read.thin,
        attempts: read.attempts,
      })

      if (read.thin) {
        obs.thinRejected++
        onWarning?.(`Incomplete menu read for ${url}; kept the previous capture instead`)
        console.warn(`[Menu] Rejected thin read for ${url}: ${read.itemsTotal} items vs ${expectedItems} expected`)
        continue
      }

      if (read.extractor === "model") obs.modelExtractions++

      const parsed = normalizeExtractedMenu(read.menu, read.extractor)
      if (parsed.categories.length > 0) {
        results.push(parsed)
        obs.scrapesWithItems++
      }
    } catch (err) {
      obs.scrapeErrors++
      onWarning?.(`Could not scrape: ${url}`)
      console.warn(`[Menu] Scrape error for ${url}:`, err)
    }
  }

  return { results, pages, screenshotPath, screenshotSourceUrl }
}
