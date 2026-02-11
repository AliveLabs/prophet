"use server"

import { redirect } from "next/navigation"
import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { fetchPlaceDetails } from "@/lib/places/google"
import { mapSite, scrapePage, scrapeMenuPage } from "@/lib/providers/firecrawl"
import { normalizeSiteContent, buildMenuSnapshot, computeContentDiffHash, computeMenuDiffHash } from "@/lib/content/normalize"
import { parseMenuFromMarkdown } from "@/lib/content/menu-parse"
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
  // STEP 1: Map the website to find the menu page
  // =========================================================================
  let menuUrl: string | null = null
  try {
    const mapResult = await mapSite(websiteUrl, "menu", 10)
    if (mapResult?.links?.length) {
      // Pick the most relevant link (first result from search-ranked map)
      const menuLink = mapResult.links.find(
        (l) =>
          /menu/i.test(l.url) ||
          /menu/i.test(l.title ?? "") ||
          /food/i.test(l.url) ||
          /drink/i.test(l.url)
      )
      menuUrl = menuLink?.url ?? mapResult.links[0]?.url ?? null
    }
  } catch {
    warnings.push("Could not map website for menu discovery")
  }

  // =========================================================================
  // STEP 2: Scrape homepage for screenshot + site content signals
  // =========================================================================
  let homepageScreenshotPath: string | null = null
  try {
    const homeResult = await scrapePage(websiteUrl)
    if (homeResult) {
      // Upload screenshot
      if (homeResult.screenshot) {
        const path = buildScreenshotPath(organizationId, "locations", locationId, "site.png")
        homepageScreenshotPath = await uploadScreenshot(homeResult.screenshot, path)
      }

      locationSiteContent = normalizeSiteContent(
        websiteUrl,
        homeResult.markdown,
        homepageScreenshotPath
          ? { storagePath: homepageScreenshotPath, sourceUrl: websiteUrl }
          : null
      )

      // Upsert location_snapshots for site content
      const contentHash = computeContentDiffHash(locationSiteContent)
      await supabase.from("location_snapshots").upsert(
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
    }
  } catch {
    warnings.push("Could not scrape homepage")
  }

  // =========================================================================
  // STEP 3: Scrape menu page for structured menu extraction
  // =========================================================================
  try {
    const targetUrl = menuUrl ?? websiteUrl
    const menuResult = await scrapeMenuPage(targetUrl)
    if (menuResult?.markdown) {
      // Upload menu screenshot
      let menuScreenshotPath: string | null = null
      if (menuResult.screenshot) {
        const path = buildScreenshotPath(organizationId, "locations", locationId, "menu.png")
        menuScreenshotPath = await uploadScreenshot(menuResult.screenshot, path)
      }

      // Parse menu
      const parsed = await parseMenuFromMarkdown(menuResult.markdown)
      locationMenu = buildMenuSnapshot(
        menuUrl,
        parsed.categories,
        parsed.confidence,
        parsed.notes,
        menuScreenshotPath
          ? { storagePath: menuScreenshotPath, sourceUrl: targetUrl }
          : null,
        parsed.currency
      )

      // Upsert location_snapshots for menu
      const menuHash = computeMenuDiffHash(locationMenu)
      await supabase.from("location_snapshots").upsert(
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
    } else {
      warnings.push("No menu content found")
    }
  } catch {
    warnings.push("Could not scrape menu page")
  }

  // =========================================================================
  // STEP 4: Scrape competitor menus
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

      // Map for menu
      let compMenuUrl: string | null = null
      const compMap = await mapSite(compUrl, "menu", 5)
      if (compMap?.links?.length) {
        const menuLink = compMap.links.find(
          (l) => /menu/i.test(l.url) || /menu/i.test(l.title ?? "")
        )
        compMenuUrl = menuLink?.url ?? compMap.links[0]?.url ?? null
      }

      // Scrape menu
      const compMenuResult = await scrapeMenuPage(compMenuUrl ?? compUrl)
      let compMenu: MenuSnapshot | null = null
      let compSiteContent: SiteContentSnapshot | null = null

      if (compMenuResult?.markdown) {
        // Upload competitor screenshot
        let compScreenshotPath: string | null = null
        if (compMenuResult.screenshot) {
          const path = buildScreenshotPath(organizationId, "competitors", comp.id, "menu.png")
          compScreenshotPath = await uploadScreenshot(compMenuResult.screenshot, path)
        }

        const parsed = await parseMenuFromMarkdown(compMenuResult.markdown)
        compMenu = buildMenuSnapshot(
          compMenuUrl,
          parsed.categories,
          parsed.confidence,
          parsed.notes,
          compScreenshotPath
            ? { storagePath: compScreenshotPath, sourceUrl: compMenuUrl ?? compUrl }
            : null,
          parsed.currency
        )

        // Also detect site features from menu page text
        compSiteContent = normalizeSiteContent(
          compUrl,
          compMenuResult.markdown,
          null
        )

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

      // Set competitor_id on insights that reference a specific competitor
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
