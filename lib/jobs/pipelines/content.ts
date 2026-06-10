// ---------------------------------------------------------------------------
// Content Pipeline – step definitions for the content refresh job
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js"
import type { PipelineStepDef } from "../types"
import { fetchPlaceDetails } from "@/lib/places/google"
import {
  discoverAllMenuUrls,
  detectPosOrderingUrls,
  scrapeMenuPage,
  scrapeHomepage,
} from "@/lib/providers/firecrawl"
import {
  normalizeSiteContentFromExtraction,
  buildMenuSnapshot,
  computeContentDiffHash,
  computeMenuDiffHash,
} from "@/lib/content/normalize"
import {
  normalizeExtractedMenu,
  normalizeGoogleMenuData,
  mergeExtractedMenus,
} from "@/lib/content/menu-parse"
import type { NormalizedMenuResult } from "@/lib/content/menu-parse"
import { fetchGoogleMenuData } from "@/lib/ai/gemini"
import { generateContentInsights } from "@/lib/content/insights"
import { uploadScreenshot, buildScreenshotPath } from "@/lib/content/storage"
import type {
  MenuSnapshot,
  SiteContentSnapshot,
  MenuSource,
} from "@/lib/content/types"
import { getVerticalConfig } from "@/lib/verticals"
import { ensureCompetitorWebsites } from "@/lib/places/ensure-website"

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export type ContentPipelineCtx = {
  supabase: SupabaseClient
  locationId: string
  organizationId: string
  location: {
    id: string
    name: string | null
    website: string | null
    primary_place_id: string | null
    address_line1: string | null
    city: string | null
    region: string | null
  }
  websiteUrl: string
  dateKey: string
  competitors: Array<{
    id: string
    name: string | null
    website: string | null
    metadata: Record<string, unknown> | null
  }>
  // Shared mutable state across steps
  state: {
    menuUrls: string[]
    homepageMarkdown: string | null
    homepageScreenshotPath: string | null
    locationSiteContent: SiteContentSnapshot | null
    locationMenu: MenuSnapshot | null
    allParsedResults: NormalizedMenuResult[]
    sources: MenuSource[]
    competitorMenus: Array<{
      competitorId: string
      competitorName: string
      menu: MenuSnapshot
      siteContent: SiteContentSnapshot | null
    }>
    warnings: string[]
  }
}

function ensureUrl(url: string): string {
  return url.startsWith("http") ? url : `https://${url}`
}

function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "")
  } catch {
    return null
  }
}

type CompetitorInput = { id: string; name: string | null; website: string | null; metadata: Record<string, unknown> | null }

/** Run an async fn over items with bounded concurrency (batches of `limit`). */
async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += limit) {
    await Promise.allSettled(items.slice(i, i + limit).map(fn))
  }
}

/**
 * Scrape one competitor's menu (Firecrawl + Gemini) and persist it. Extracted from the
 * old per-competitor step so competitors can be processed CONCURRENTLY in one step —
 * the sequential per-competitor loop was the content pipeline's main 300s-timeout driver.
 */
async function processCompetitorMenu(c: ContentPipelineCtx, comp: CompetitorInput): Promise<void> {
  const compWebsite =
    comp.website ??
    extractDomain((comp.metadata?.placeDetails as Record<string, unknown>)?.websiteUri as string)
  if (!compWebsite) return

  const compUrl = ensureUrl(compWebsite)
  const compSources: MenuSource[] = []

  let compMenuUrls = await discoverAllMenuUrls(compUrl, 2)
  if (compMenuUrls.length === 0) compMenuUrls = [compUrl]

  const compParsedResults: NormalizedMenuResult[] = []
  let compScreenshotPath: string | null = null
  let compScreenshotSourceUrl: string | null = null

  for (const compTargetUrl of compMenuUrls) {
    try {
      const compMenuResult = await scrapeMenuPage(compTargetUrl)
      if (compMenuResult) {
        if (!compScreenshotPath && compMenuResult.screenshot) {
          const path = buildScreenshotPath(c.organizationId, "competitors", comp.id, "menu.png")
          compScreenshotPath = await uploadScreenshot(compMenuResult.screenshot, path)
          compScreenshotSourceUrl = compTargetUrl
        }
        const parsed = normalizeExtractedMenu(compMenuResult.menu)
        if (parsed.categories.length > 0) compParsedResults.push(parsed)
      }
    } catch {
      /* continue */
    }
  }

  if (compParsedResults.length > 0) compSources.push("firecrawl")

  try {
    const compAddress =
      ((comp.metadata?.placeDetails as Record<string, unknown>)?.formattedAddress as string) ?? null
    const compFallback =
      process.env.VERTICALIZATION_ENABLED === "true"
        ? getVerticalConfig().labels.businessLabelCapitalized
        : "Restaurant"
    const googleCompMenu = await fetchGoogleMenuData(comp.name ?? compFallback, compAddress)
    if (googleCompMenu && googleCompMenu.categories.length > 0) {
      compParsedResults.push(normalizeGoogleMenuData(googleCompMenu))
      compSources.push("gemini_google_search")
    }
  } catch {
    /* non-fatal */
  }

  if (compParsedResults.length === 0) return

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
  compMenu.parseMeta.sources = compSources

  const compSiteContent = normalizeSiteContentFromExtraction(compUrl, null, null)
  const menuHash = computeMenuDiffHash(compMenu)
  await c.supabase.from("snapshots").upsert(
    {
      competitor_id: comp.id,
      date_key: c.dateKey,
      snapshot_type: "web_menu_weekly",
      captured_at: new Date().toISOString(),
      provider: "firecrawl_menu",
      raw_data: compMenu as unknown as Record<string, unknown>,
      diff_hash: menuHash,
    },
    { onConflict: "competitor_id,date_key,snapshot_type" }
  )

  c.state.competitorMenus.push({
    competitorId: comp.id,
    competitorName: comp.name ?? "Competitor",
    menu: compMenu,
    siteContent: compSiteContent,
  })
}

// ---------------------------------------------------------------------------
// Step builders
// ---------------------------------------------------------------------------

export async function shouldSkipContentPipeline(
  supabase: SupabaseClient,
  locationId: string
): Promise<{ skip: boolean; reason?: string }> {
  if (process.env.VERTICALIZATION_ENABLED !== "true") {
    return { skip: false }
  }

  const { data: loc } = await supabase
    .from("locations")
    .select("organization_id")
    .eq("id", locationId)
    .single()

  if (!loc) return { skip: false }

  const { data: org } = await supabase
    .from("organizations")
    .select("industry_type")
    .eq("id", loc.organization_id)
    .single()

  if (!org) return { skip: false }

  const config = getVerticalConfig(org.industry_type)
  if (!config.signals.content) {
    return {
      skip: true,
      reason: `content signal disabled for ${org.industry_type}`,
    }
  }

  return { skip: false }
}

export function buildContentSteps(
  ctx: ContentPipelineCtx
): PipelineStepDef<ContentPipelineCtx>[] {
  const steps: PipelineStepDef<ContentPipelineCtx>[] = [
    {
      name: "map_website",
      label: "Mapping website pages",
      run: async (c) => {
        c.state.menuUrls = await discoverAllMenuUrls(c.websiteUrl, 4)
        return { urlsFound: c.state.menuUrls.length }
      },
    },
    {
      name: "scrape_homepage",
      label: "Scraping homepage & capturing screenshot",
      run: async (c) => {
        const homeResult = await scrapeHomepage(c.websiteUrl)
        if (!homeResult) return { status: "no data" }

        c.state.homepageMarkdown = homeResult.markdown

        if (homeResult.screenshot) {
          const path = buildScreenshotPath(
            c.organizationId,
            "locations",
            c.locationId,
            "site.png"
          )
          c.state.homepageScreenshotPath = await uploadScreenshot(
            homeResult.screenshot,
            path
          )
        }

        c.state.locationSiteContent = normalizeSiteContentFromExtraction(
          c.websiteUrl,
          homeResult.features,
          c.state.homepageScreenshotPath
            ? {
                storagePath: c.state.homepageScreenshotPath,
                sourceUrl: c.websiteUrl,
              }
            : null
        )

        const contentHash = computeContentDiffHash(c.state.locationSiteContent)
        await c.supabase.from("location_snapshots").upsert(
          {
            location_id: c.locationId,
            provider: "firecrawl_site_content",
            date_key: c.dateKey,
            captured_at: new Date().toISOString(),
            raw_data: c.state.locationSiteContent as unknown as Record<
              string,
              unknown
            >,
            diff_hash: contentHash,
          },
          { onConflict: "location_id,provider,date_key" }
        )

        return {
          screenshot: c.state.homepageScreenshotPath ? "captured" : "none",
          features: c.state.locationSiteContent?.detected
            ? Object.values(c.state.locationSiteContent.detected).filter(Boolean)
                .length
            : 0,
        }
      },
    },
    {
      name: "extract_menu",
      label: "Extracting menu items from website",
      run: async (c) => {
        // Detect POS links from homepage
        const posUrls = detectPosOrderingUrls(c.state.homepageMarkdown)
        for (const posUrl of posUrls) {
          if (!c.state.menuUrls.includes(posUrl)) {
            c.state.menuUrls.push(posUrl)
          }
        }
        if (c.state.menuUrls.length === 0) {
          c.state.menuUrls.push(c.websiteUrl)
        }
        c.state.menuUrls = c.state.menuUrls.slice(0, 4)

        let firstScreenshotPath: string | null = null
        let firstScreenshotSourceUrl: string | null = null

        for (const targetUrl of c.state.menuUrls) {
          try {
            const menuResult = await scrapeMenuPage(targetUrl)
            if (menuResult) {
              if (!firstScreenshotPath && menuResult.screenshot) {
                const path = buildScreenshotPath(
                  c.organizationId,
                  "locations",
                  c.locationId,
                  "menu.png"
                )
                firstScreenshotPath = await uploadScreenshot(
                  menuResult.screenshot,
                  path
                )
                firstScreenshotSourceUrl = targetUrl
              }
              const parsed = normalizeExtractedMenu(menuResult.menu)
              if (parsed.categories.length > 0) {
                c.state.allParsedResults.push(parsed)
              }
            }
          } catch (err) {
            c.state.warnings.push(`Could not scrape: ${targetUrl}`)
            console.warn(`[Content] Menu scrape error for ${targetUrl}:`, err)
          }
        }

        if (c.state.allParsedResults.length > 0) {
          c.state.sources.push("firecrawl")
        }

        // Store first screenshot path for later use in building the menu snapshot
        ;(c.state as Record<string, unknown>)._menuScreenshotPath =
          firstScreenshotPath
        ;(c.state as Record<string, unknown>)._menuScreenshotSourceUrl =
          firstScreenshotSourceUrl

        const totalItems = c.state.allParsedResults.reduce(
          (s, p) => s + p.categories.reduce((s2, cat) => s2 + cat.items.length, 0),
          0
        )
        return {
          pagesScraped: c.state.menuUrls.length,
          itemsFound: totalItems,
        }
      },
    },
    {
      name: "google_enrichment",
      label: "Enriching with Google Search data",
      run: async (c) => {
        const addressParts = [
          c.location.address_line1,
          c.location.city,
          c.location.region,
        ].filter(Boolean)
        const locationAddress =
          addressParts.length > 0 ? addressParts.join(", ") : null

        const businessFallback = process.env.VERTICALIZATION_ENABLED === "true"
          ? getVerticalConfig().labels.businessLabelCapitalized
          : "Restaurant"

        const googleMenu = await fetchGoogleMenuData(
          c.location.name ?? businessFallback,
          locationAddress
        )

        if (googleMenu && googleMenu.categories.length > 0) {
          const normalizedGoogle = normalizeGoogleMenuData(googleMenu)
          c.state.allParsedResults.push(normalizedGoogle)
          c.state.sources.push("gemini_google_search")
          const itemCount = normalizedGoogle.categories.reduce(
            (s, cat) => s + cat.items.length,
            0
          )
          return { additionalItems: itemCount }
        }
        return { additionalItems: 0 }
      },
    },
    {
      name: "merge_save_menu",
      label: "Merging & saving menu data",
      run: async (c) => {
        if (c.state.allParsedResults.length === 0) {
          c.state.warnings.push("No menu content found")
          return { totalItems: 0 }
        }

        const merged = mergeExtractedMenus(c.state.allParsedResults)
        const primaryMenuUrl = c.state.menuUrls[0] ?? c.websiteUrl
        const screenshotPath = (c.state as Record<string, unknown>)
          ._menuScreenshotPath as string | null
        const screenshotSourceUrl = (c.state as Record<string, unknown>)
          ._menuScreenshotSourceUrl as string | null

        c.state.locationMenu = buildMenuSnapshot(
          primaryMenuUrl,
          merged.categories,
          merged.confidence,
          merged.notes,
          screenshotPath
            ? {
                storagePath: screenshotPath,
                sourceUrl: screenshotSourceUrl ?? primaryMenuUrl,
              }
            : null,
          merged.currency
        )
        c.state.locationMenu.parseMeta.sources = c.state.sources

        const menuHash = computeMenuDiffHash(c.state.locationMenu)
        await c.supabase.from("location_snapshots").upsert(
          {
            location_id: c.locationId,
            provider: "firecrawl_menu",
            date_key: c.dateKey,
            captured_at: new Date().toISOString(),
            raw_data: c.state.locationMenu as unknown as Record<string, unknown>,
            diff_hash: menuHash,
          },
          { onConflict: "location_id,provider,date_key" }
        )

        return {
          categories: merged.categories.length,
          totalItems: c.state.locationMenu.parseMeta.itemsTotal,
          sources: c.state.sources.join(", "),
        }
      },
    },
  ]

  // Competitor menus — processed CONCURRENTLY (bounded) in one step. The previous
  // one-step-per-competitor sequential design was the content pipeline's main 300s
  // timeout driver; batching keeps the whole job comfortably under budget.
  steps.push({
    name: "scrape_competitor_menus",
    label: "Fetching competitor menus",
    run: async (c) => {
      await mapWithConcurrency(c.competitors, 3, async (comp) => {
        try {
          await processCompetitorMenu(c, comp)
        } catch (err) {
          c.state.warnings.push(`${comp.name ?? "competitor"} menu: ${err instanceof Error ? err.message : "failed"}`)
        }
      })
      return { competitorMenus: c.state.competitorMenus.length, of: c.competitors.length }
    },
  })

  // Final step: generate insights
  steps.push({
    name: "generate_insights",
    label: "Generating content insights",
    run: async (c) => {
      const { data: prevMenuSnap } = await c.supabase
        .from("location_snapshots")
        .select("raw_data")
        .eq("location_id", c.locationId)
        .eq("provider", "firecrawl_menu")
        .order("date_key", { ascending: false })
        .range(1, 1)

      const previousMenu = prevMenuSnap?.[0]?.raw_data as MenuSnapshot | null

      const contentInsights = generateContentInsights(
        c.state.locationMenu,
        c.state.competitorMenus,
        c.state.locationSiteContent,
        previousMenu
      )

      if (contentInsights.length > 0) {
        const insightsPayload = contentInsights.map((insight) => ({
          location_id: c.locationId,
          competitor_id: null as string | null,
          date_key: c.dateKey,
          ...insight,
          status: "new",
        }))

        for (const payload of insightsPayload) {
          const evidence = payload.evidence as Record<string, unknown>
          const compName = evidence?.competitor as string | undefined
          if (compName) {
            const match = c.state.competitorMenus.find(
              (cm) => cm.competitorName === compName
            )
            if (match) payload.competitor_id = match.competitorId
          }
        }

        await c.supabase.from("insights").upsert(insightsPayload, {
          onConflict: "location_id,competitor_id,date_key,insight_type",
        })
      }

      return { insightsGenerated: contentInsights.length }
    },
  })

  return steps
}

// ---------------------------------------------------------------------------
// Context builder (called by the API route before running the pipeline)
// ---------------------------------------------------------------------------

export async function buildContentContext(
  supabase: SupabaseClient,
  locationId: string,
  organizationId: string
): Promise<ContentPipelineCtx> {
  const { data: location } = await supabase
    .from("locations")
    .select(
      "id, name, website, primary_place_id, organization_id, address_line1, city, region"
    )
    .eq("id", locationId)
    .eq("organization_id", organizationId)
    .maybeSingle()

  if (!location) throw new Error("Location not found")

  let website = location.website as string | null
  if (!website && location.primary_place_id) {
    try {
      const details = await fetchPlaceDetails(location.primary_place_id)
      if (details?.websiteUri) {
        website = details.websiteUri
        await supabase
          .from("locations")
          .update({ website: details.websiteUri })
          .eq("id", locationId)
      }
    } catch {
      /* non-fatal */
    }
  }

  if (!website) throw new Error("No website configured for this location")

  const websiteUrl = website.startsWith("http") ? website : `https://${website}`

  const { data: comps } = await supabase
    .from("competitors")
    .select("id, name, website, metadata, is_active, provider_entity_id")
    .eq("location_id", locationId)
    .eq("is_active", true)

  // Self-heal missing websites from Places (they starve menus/discovery/SEO silently).
  await ensureCompetitorWebsites(supabase, (comps ?? []) as Array<{ id: string; website: string | null; provider_entity_id?: string | null }>)

  const competitors = (comps ?? [])
    .filter(
      (c) =>
        (c.metadata as Record<string, unknown> | null)?.status === "approved"
    )
    .map((c) => ({
      id: c.id,
      name: c.name,
      website: c.website,
      metadata: c.metadata as Record<string, unknown> | null,
    }))

  const dateKey = new Date().toISOString().slice(0, 10)

  const ctx: ContentPipelineCtx = {
    supabase,
    locationId,
    organizationId,
    location: {
      id: location.id,
      name: location.name,
      website,
      primary_place_id: location.primary_place_id,
      address_line1: location.address_line1,
      city: location.city,
      region: location.region,
    },
    websiteUrl,
    dateKey,
    competitors,
    state: {
      menuUrls: [],
      homepageMarkdown: null,
      homepageScreenshotPath: null,
      locationSiteContent: null,
      locationMenu: null,
      allParsedResults: [],
      sources: [],
      competitorMenus: [],
      warnings: [],
    },
  }

  return ctx
}
