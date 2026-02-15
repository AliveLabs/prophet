"use server"

import { redirect } from "next/navigation"
import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { fetchPlaceDetails } from "@/lib/places/google"
import { discoverAllMenuUrls, detectPosOrderingUrls, scrapeMenuPage, scrapeHomepage } from "@/lib/providers/firecrawl"
import { normalizeSiteContentFromExtraction, buildMenuSnapshot, computeContentDiffHash, computeMenuDiffHash } from "@/lib/content/normalize"
import { normalizeExtractedMenu, mergeExtractedMenus } from "@/lib/content/menu-parse"
import type { NormalizedMenuResult } from "@/lib/content/menu-parse"
import { generateContentInsights } from "@/lib/content/insights"
import { uploadScreenshot, buildScreenshotPath } from "@/lib/content/storage"
import type { MenuSnapshot, SiteContentSnapshot } from "@/lib/content/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "")
  } catch {
    return null
  }
}

function getDateKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function ensureUrl(url: string): string {
  if (url.startsWith("http")) return url
  return `https://${url}`
}

// ---------------------------------------------------------------------------
// refreshContentAction – main server action for /content page
// ---------------------------------------------------------------------------

export async function refreshContentAction(formData: FormData) {
  const user = await requireUser()
  const locationId = String(formData.get("location_id") ?? "")
  if (!locationId) redirect("/content?error=No+location+selected")

  const supabase = await createServerSupabaseClient()
  const warnings: string[] = []

  // Auth & permission check
  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()
  const organizationId = profile?.current_organization_id
  if (!organizationId) redirect("/content?error=Organization+not+found")

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    redirect("/content?error=Only+admins+can+refresh+content")
  }

  const { data: location } = await supabase
    .from("locations")
    .select("id, name, website, primary_place_id, organization_id")
    .eq("id", locationId)
    .eq("organization_id", organizationId)
    .maybeSingle()

  if (!location) redirect("/content?error=Location+not+found")

  // Resolve website if missing
  let website = location.website
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
      warnings.push("Could not resolve website from Google Places")
    }
  }

  if (!website) {
    redirect(`/content?location_id=${locationId}&error=No+website+configured.+Add+a+website+URL+in+Locations.`)
  }

  const websiteUrl = ensureUrl(website)
  const dateKey = getDateKey()
  let locationSiteContent: SiteContentSnapshot | null = null
  let locationMenu: MenuSnapshot | null = null

  // =========================================================================
  // STEP 1: Discover ALL menu-related URLs (multi-search + POS detection)
  // =========================================================================
  let menuUrls: string[] = []
  try {
    menuUrls = await discoverAllMenuUrls(websiteUrl, 4)
    console.log(`[Content] Discovered ${menuUrls.length} menu URLs via mapSite`)
  } catch {
    warnings.push("Could not map website for menu discovery")
  }

  // =========================================================================
  // STEP 2: Scrape homepage – screenshot + site features + detect POS links
  // =========================================================================
  let homepageScreenshotPath: string | null = null
  let homepageMarkdown: string | null = null
  try {
    const homeResult = await scrapeHomepage(websiteUrl)
    if (homeResult) {
      homepageMarkdown = homeResult.markdown

      // Upload screenshot
      if (homeResult.screenshot) {
        const path = buildScreenshotPath(organizationId, "locations", locationId, "site.png")
        homepageScreenshotPath = await uploadScreenshot(homeResult.screenshot, path)
      }

      // Use Firecrawl's extracted features (preferred) with markdown fallback
      locationSiteContent = normalizeSiteContentFromExtraction(
        websiteUrl,
        homeResult.features,
        homepageScreenshotPath
          ? { storagePath: homepageScreenshotPath, sourceUrl: websiteUrl }
          : null
      )

      // Upsert location_snapshots for site content
      const contentHash = computeContentDiffHash(locationSiteContent)
      const { error: upsertErr } = await supabase.from("location_snapshots").upsert(
        {
          location_id: locationId,
          provider: "firecrawl_site_content",
          date_key: dateKey,
          captured_at: new Date().toISOString(),
          raw_data: locationSiteContent as unknown as Record<string, unknown>,
          diff_hash: contentHash,
        },
        { onConflict: "location_id,provider,date_key" }
      )
      if (upsertErr) {
        console.warn("[Content] Site content upsert error:", upsertErr.message)
        warnings.push("Failed to save site content snapshot")
      }
    }
  } catch (err) {
    console.warn("[Content] Homepage scrape error:", err)
    warnings.push("Could not scrape homepage")
  }

  // =========================================================================
  // STEP 2.5: Detect POS/ordering platform links and add to menu URLs
  // =========================================================================
  try {
    const posUrls = detectPosOrderingUrls(homepageMarkdown)
    for (const posUrl of posUrls) {
      if (!menuUrls.includes(posUrl)) {
        menuUrls.push(posUrl)
      }
    }
    // If we still have no menu URLs, fall back to the homepage itself
    if (menuUrls.length === 0) {
      menuUrls.push(websiteUrl)
    }
    // Cap at 4 total
    menuUrls = menuUrls.slice(0, 4)
    console.log(`[Content] Final menu URLs to scrape (${menuUrls.length}):`, menuUrls)
  } catch {
    if (menuUrls.length === 0) {
      menuUrls.push(websiteUrl)
    }
  }

  // =========================================================================
  // STEP 3: Scrape ALL menu URLs, merge results into one combined menu
  // =========================================================================
  try {
    const allParsedResults: NormalizedMenuResult[] = []
    let firstScreenshotPath: string | null = null
    let firstScreenshotSourceUrl: string | null = null
    const primaryMenuUrl = menuUrls[0] ?? websiteUrl

    for (const targetUrl of menuUrls) {
      try {
        console.log(`[Content] Scraping menu URL: ${targetUrl}`)
        const menuResult = await scrapeMenuPage(targetUrl)
        if (menuResult) {
          // Upload screenshot from the first successful scrape
          if (!firstScreenshotPath && menuResult.screenshot) {
            const path = buildScreenshotPath(organizationId, "locations", locationId, "menu.png")
            firstScreenshotPath = await uploadScreenshot(menuResult.screenshot, path)
            firstScreenshotSourceUrl = targetUrl
          }

          // Normalize this page's extracted menu
          const parsed = normalizeExtractedMenu(menuResult.menu)
          if (parsed.categories.length > 0) {
            allParsedResults.push(parsed)
            console.log(`[Content] URL ${targetUrl}: ${parsed.categories.length} categories, ${parsed.categories.reduce((s, c) => s + c.items.length, 0)} items`)
          }
        }
      } catch (err) {
        console.warn(`[Content] Menu scrape error for ${targetUrl}:`, err)
        warnings.push(`Could not scrape: ${targetUrl}`)
      }
    }

    if (allParsedResults.length > 0) {
      // Merge all results into one combined menu
      const merged = mergeExtractedMenus(allParsedResults)
      console.log(`[Content] Merged menu: ${merged.categories.length} categories, ${merged.categories.reduce((s, c) => s + c.items.length, 0)} items from ${allParsedResults.length} source(s)`)

      locationMenu = buildMenuSnapshot(
        primaryMenuUrl,
        merged.categories,
        merged.confidence,
        merged.notes,
        firstScreenshotPath
          ? { storagePath: firstScreenshotPath, sourceUrl: firstScreenshotSourceUrl ?? primaryMenuUrl }
          : null,
        merged.currency
      )

      // Upsert location_snapshots for menu
      const menuHash = computeMenuDiffHash(locationMenu)
      const { error: upsertErr } = await supabase.from("location_snapshots").upsert(
        {
          location_id: locationId,
          provider: "firecrawl_menu",
          date_key: dateKey,
          captured_at: new Date().toISOString(),
          raw_data: locationMenu as unknown as Record<string, unknown>,
          diff_hash: menuHash,
        },
        { onConflict: "location_id,provider,date_key" }
      )
      if (upsertErr) {
        console.warn("[Content] Menu upsert error:", upsertErr.message)
        warnings.push("Failed to save menu snapshot")
      } else {
        console.log(`[Content] Menu saved: ${locationMenu.parseMeta.itemsTotal} items`)
      }
    } else {
      warnings.push("No menu content found across any discovered URLs")
    }
  } catch (err) {
    console.warn("[Content] Menu scrape pipeline error:", err)
    warnings.push("Could not scrape menu pages")
  }

  // =========================================================================
  // STEP 4: Scrape competitor menus (also via Firecrawl JSON extraction)
  // =========================================================================
  const { data: competitors } = await supabase
    .from("competitors")
    .select("id, name, website, metadata, is_active")
    .eq("location_id", locationId)
    .eq("is_active", true)

  const approvedCompetitors = (competitors ?? []).filter(
    (c) => (c.metadata as Record<string, unknown>)?.status === "approved"
  )

  type CompetitorMenuResult = {
    competitorId: string
    competitorName: string
    menu: MenuSnapshot
    siteContent: SiteContentSnapshot | null
  }
  const competitorMenus: CompetitorMenuResult[] = []

  for (const comp of approvedCompetitors) {
    const compWebsite = comp.website ?? extractDomain(
      ((comp.metadata as Record<string, unknown>)?.placeDetails as Record<string, unknown>)?.websiteUri as string
    )
    if (!compWebsite) continue

    try {
      const compUrl = ensureUrl(compWebsite)

      // Discover menu URLs for this competitor (cap at 2)
      let compMenuUrls = await discoverAllMenuUrls(compUrl, 2)
      if (compMenuUrls.length === 0) {
        compMenuUrls = [compUrl]
      }

      // Scrape each URL and merge
      const compParsedResults: NormalizedMenuResult[] = []
      let compScreenshotPath: string | null = null
      let compScreenshotSourceUrl: string | null = null

      for (const compTargetUrl of compMenuUrls) {
        try {
          const compMenuResult = await scrapeMenuPage(compTargetUrl)
          if (compMenuResult) {
            if (!compScreenshotPath && compMenuResult.screenshot) {
              const path = buildScreenshotPath(organizationId, "competitors", comp.id, "menu.png")
              compScreenshotPath = await uploadScreenshot(compMenuResult.screenshot, path)
              compScreenshotSourceUrl = compTargetUrl
            }
            const parsed = normalizeExtractedMenu(compMenuResult.menu)
            if (parsed.categories.length > 0) {
              compParsedResults.push(parsed)
            }
          }
        } catch {
          // Continue to next URL
        }
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

        const compSiteContent: SiteContentSnapshot | null = normalizeSiteContentFromExtraction(compUrl, null, null)

        // Store in snapshots table (competitor-scoped)
        const menuHash = computeMenuDiffHash(compMenu)
        await supabase.from("snapshots").upsert(
          {
            competitor_id: comp.id,
            date_key: dateKey,
            snapshot_type: "web_menu_weekly",
            captured_at: new Date().toISOString(),
            provider: "firecrawl_menu",
            raw_data: compMenu as unknown as Record<string, unknown>,
            diff_hash: menuHash,
          },
          { onConflict: "competitor_id,date_key,snapshot_type" }
        )

        competitorMenus.push({
          competitorId: comp.id,
          competitorName: comp.name ?? "Competitor",
          menu: compMenu,
          siteContent: compSiteContent,
        })
        console.log(`[Content] Competitor ${comp.name}: ${compMenu.parseMeta.itemsTotal} items from ${compParsedResults.length} source(s)`)
      }
    } catch {
      warnings.push(`Could not scrape menu for ${comp.name ?? "competitor"}`)
    }
  }

  // =========================================================================
  // STEP 5: Generate content insights
  // =========================================================================
  try {
    // Fetch previous location menu for change detection
    const { data: prevMenuSnap } = await supabase
      .from("location_snapshots")
      .select("raw_data")
      .eq("location_id", locationId)
      .eq("provider", "firecrawl_menu")
      .order("date_key", { ascending: false })
      .range(1, 1)

    const previousMenu = prevMenuSnap?.[0]?.raw_data as MenuSnapshot | null

    const contentInsights = generateContentInsights(
      locationMenu,
      competitorMenus,
      locationSiteContent,
      previousMenu
    )

    if (contentInsights.length > 0) {
      const insightsPayload = contentInsights.map((insight) => ({
        location_id: locationId,
        competitor_id: null as string | null,
        date_key: dateKey,
        ...insight,
        status: "new",
      }))

      for (const payload of insightsPayload) {
        const evidence = payload.evidence as Record<string, unknown>
        const compName = evidence?.competitor as string | undefined
        if (compName) {
          const match = competitorMenus.find((c) => c.competitorName === compName)
          if (match) {
            payload.competitor_id = match.competitorId
          }
        }
      }

      await supabase.from("insights").upsert(insightsPayload, {
        onConflict: "location_id,competitor_id,date_key,insight_type",
      })
    }
  } catch {
    warnings.push("Content insight generation encountered an error")
  }

  // =========================================================================
  // REDIRECT
  // =========================================================================
  const successMsg = warnings.length
    ? `Content+refreshed+with+${warnings.length}+warning(s)`
    : "Content+refreshed+successfully"

  redirect(`/content?location_id=${locationId}&success=${successMsg}`)
}
