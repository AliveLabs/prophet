// ---------------------------------------------------------------------------
// Auto-trigger helpers for location/competitor lifecycle events
// All functions are non-blocking (fire-and-forget with try/catch)
// so they never fail the parent action.
// ---------------------------------------------------------------------------

import { createClient } from "@supabase/supabase-js"
import { fetchHistoricalWeather } from "@/lib/providers/openweathermap"
import {
  scrapeHomepage,
  discoverAllMenuUrls,
  scrapeMenuPage,
} from "@/lib/providers/firecrawl"
import {
  normalizeSiteContentFromExtraction,
  buildMenuSnapshot,
  computeContentDiffHash,
  computeMenuDiffHash,
} from "@/lib/content/normalize"
import { normalizeExtractedMenu, mergeExtractedMenus } from "@/lib/content/menu-parse"
import type { NormalizedMenuResult } from "@/lib/content/menu-parse"
import { uploadScreenshot, buildScreenshotPath } from "@/lib/content/storage"

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  return createClient(url, serviceKey, { auth: { persistSession: false } })
}

/**
 * Kicks off lightweight initial data collection for a newly created location.
 * Runs content scrape (if website available) and weather fetch in parallel.
 * Non-blocking: failures are logged, never thrown.
 */
export async function triggerInitialLocationData(
  locationId: string,
  organizationId: string,
  opts: {
    website?: string | null
    geoLat?: number | null
    geoLng?: number | null
  }
) {
  const tasks: Promise<void>[] = []

  if (opts.website) {
    tasks.push(
      triggerInitialContentScrape(locationId, organizationId, opts.website)
        .catch((err) => console.warn("[Trigger] Content scrape failed:", err))
    )
  }

  if (opts.geoLat != null && opts.geoLng != null) {
    tasks.push(
      triggerInitialWeather(locationId, opts.geoLat, opts.geoLng)
        .catch((err) => console.warn("[Trigger] Weather fetch failed:", err))
    )
  }

  await Promise.allSettled(tasks)
}

async function triggerInitialContentScrape(
  locationId: string,
  organizationId: string,
  website: string
) {
  const supabase = admin()
  const dateKey = new Date().toISOString().slice(0, 10)
  const websiteUrl = website.startsWith("http") ? website : `https://${website}`

  const homepageResult = await scrapeHomepage(websiteUrl)
  if (!homepageResult) return

  let screenshotRef: { storagePath: string; sourceUrl: string } | null = null
  if (homepageResult.screenshot) {
    const path = buildScreenshotPath(organizationId, "locations", locationId, "site.png")
    try {
      const storagePath = await uploadScreenshot(homepageResult.screenshot, path)
      if (storagePath) {
        screenshotRef = { storagePath, sourceUrl: websiteUrl }
      }
    } catch { /* non-fatal */ }
  }

  const siteContent = normalizeSiteContentFromExtraction(
    websiteUrl,
    homepageResult.features ?? null,
    screenshotRef
  )
  const siteHash = computeContentDiffHash(siteContent)

  await supabase.from("location_snapshots").upsert(
    {
      location_id: locationId,
      provider: "firecrawl_site_content",
      date_key: dateKey,
      captured_at: new Date().toISOString(),
      raw_data: siteContent,
      diff_hash: siteHash,
    },
    { onConflict: "location_id,provider,date_key" }
  )

  // Try to scrape menu
  try {
    const menuUrls = await discoverAllMenuUrls(websiteUrl, 2)
    if (menuUrls.length === 0) return

    const allParsed: NormalizedMenuResult[] = []
    for (const url of menuUrls.slice(0, 2)) {
      try {
        const scraped = await scrapeMenuPage(url)
        if (scraped?.menu) {
          const parsed = normalizeExtractedMenu(scraped.menu)
          if (parsed) allParsed.push(parsed)
        }
      } catch { /* skip single URL */ }
    }

    if (allParsed.length === 0) return

    const merged = mergeExtractedMenus(allParsed)
    const menuSnapshot = buildMenuSnapshot(
      menuUrls[0],
      merged.categories,
      merged.confidence,
      merged.notes,
      null,
      merged.currency
    )
    const menuHash = computeMenuDiffHash(menuSnapshot)

    await supabase.from("location_snapshots").upsert(
      {
        location_id: locationId,
        provider: "firecrawl_menu",
        date_key: dateKey,
        captured_at: new Date().toISOString(),
        raw_data: menuSnapshot,
        diff_hash: menuHash,
      },
      { onConflict: "location_id,provider,date_key" }
    )
  } catch {
    // Menu scrape is best-effort
  }
}

async function triggerInitialWeather(
  locationId: string,
  lat: number,
  lng: number
) {
  const supabase = admin()
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)

  const weather = await fetchHistoricalWeather(lat, lng, yesterday)

  await supabase.from("location_weather").upsert(
    {
      location_id: locationId,
      date: weather.date,
      temp_high_f: weather.temp_high_f,
      temp_low_f: weather.temp_low_f,
      feels_like_high_f: weather.feels_like_high_f,
      humidity_avg: weather.humidity_avg,
      wind_speed_max_mph: weather.wind_speed_max_mph,
      weather_condition: weather.weather_condition,
      weather_description: weather.weather_description,
      weather_icon: weather.weather_icon,
      precipitation_in: weather.precipitation_in,
      is_severe: weather.is_severe,
      raw_data: weather,
    },
    { onConflict: "location_id,date" }
  )
}
