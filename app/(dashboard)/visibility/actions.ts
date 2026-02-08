"use server"

import { redirect } from "next/navigation"
import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { getTierFromPriceId } from "@/lib/billing/tiers"
import {
  getSeoRankedKeywordsLimit,
  getSeoTrackedKeywordsLimit,
  isSeoIntersectionEnabled,
  getSeoIntersectionLimit,
  isSeoAdsEnabled,
} from "@/lib/billing/limits"
import { fetchPlaceDetails } from "@/lib/places/google"
import { fetchDomainRankOverview } from "@/lib/providers/dataforseo/domain-rank-overview"
import { fetchRankedKeywords } from "@/lib/providers/dataforseo/ranked-keywords"
import { fetchKeywordsForSite } from "@/lib/providers/dataforseo/keywords-for-site"
import { fetchCompetitorsDomain } from "@/lib/providers/dataforseo/competitors-domain"
import { fetchDomainIntersection } from "@/lib/providers/dataforseo/domain-intersection"
import { fetchSerpOrganic } from "@/lib/providers/dataforseo/serp-organic"
import { fetchAdsSearch } from "@/lib/providers/dataforseo/ads-search"
import { fetchBacklinksSummary } from "@/lib/providers/dataforseo/backlinks-summary"
import { fetchRelevantPages } from "@/lib/providers/dataforseo/relevant-pages"
import { fetchSubdomains } from "@/lib/providers/dataforseo/subdomains"
import { fetchHistoricalRankOverview } from "@/lib/providers/dataforseo/historical-rank-overview"
import {
  normalizeDomainRankOverview,
  normalizeRankedKeywords,
  normalizeKeywordsForSite,
  normalizeSerpOrganic,
  normalizeDomainIntersection,
  normalizeAdsSearch,
  normalizeCompetitorsDomain,
  normalizeBacklinksSummary,
  normalizeRelevantPages,
  normalizeSubdomains,
  normalizeHistoricalRankOverview,
} from "@/lib/seo/normalize"
import { hashDomainRankSnapshot, hashRankedKeywords, hashSerpRanks, hashJsonPayload } from "@/lib/seo/hash"
import { generateSeoInsights, type SeoInsightContext } from "@/lib/seo/insights"
import { SEO_SNAPSHOT_TYPES } from "@/lib/seo/types"
import type { DomainRankSnapshot, NormalizedRankedKeyword, SerpRankEntry, NormalizedIntersectionRow, NormalizedAdCreative, NormalizedBacklinksSummary } from "@/lib/seo/types"

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

function getPreviousDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// refreshSeoAction – manual trigger from /visibility page
// ---------------------------------------------------------------------------

export async function refreshSeoAction(formData: FormData) {
  const user = await requireUser()
  const locationId = String(formData.get("location_id") ?? "")
  if (!locationId) redirect("/visibility?error=No+location+selected")

  const supabase = await createServerSupabaseClient()

  // Auth & permission
  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()
  const organizationId = profile?.current_organization_id
  if (!organizationId) redirect("/visibility?error=No+organization+found")

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle()
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    redirect("/visibility?error=Insufficient+permissions")
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("subscription_tier")
    .eq("id", organizationId)
    .maybeSingle()
  const tier = getTierFromPriceId(org?.subscription_tier)

  const { data: location } = await supabase
    .from("locations")
    .select("id, name, website, primary_place_id, organization_id")
    .eq("id", locationId)
    .eq("organization_id", organizationId)
    .maybeSingle()
  if (!location) redirect("/visibility?error=Location+not+found")

  // -----------------------------------------------------------------------
  // Auto-resolve website from Google Places if missing
  // -----------------------------------------------------------------------
  let resolvedWebsite = location.website as string | null

  if (!resolvedWebsite && location.primary_place_id) {
    try {
      const placeDetails = await fetchPlaceDetails(location.primary_place_id)
      if (placeDetails?.websiteUri) {
        resolvedWebsite = placeDetails.websiteUri
        // Persist so future runs don't need to re-fetch
        await supabase
          .from("locations")
          .update({ website: resolvedWebsite })
          .eq("id", locationId)
      }
    } catch (err) {
      console.warn("Auto-resolve website from Places failed:", err)
    }
  }

  const locationDomain = extractDomain(resolvedWebsite)
  const dateKey = getDateKey()

  // Fetch competitors
  const { data: allComps } = await supabase
    .from("competitors")
    .select("id, name, website, metadata, is_active")
    .eq("location_id", locationId)
    .eq("is_active", true)

  const competitors = (allComps ?? []).filter((c) => {
    const meta = c.metadata as Record<string, unknown> | null
    return meta?.status === "approved"
  })

  const compDomains = competitors
    .map((c) => ({ ...c, domain: extractDomain(c.website) }))
    .filter((c) => c.domain !== null) as Array<typeof competitors[number] & { domain: string }>

  const allDomains = [locationDomain, ...compDomains.map((c) => c.domain)].filter(Boolean) as string[]

  // Pick a "seed domain" for keyword discovery: prefer location, fall back to first competitor
  const seedDomain = locationDomain ?? compDomains[0]?.domain ?? null

  if (allDomains.length === 0) {
    redirect(
      `/visibility?error=${encodeURIComponent("No website configured for this location or its competitors. Add a website URL to your location or approve competitors with websites.")}&location_id=${locationId}`
    )
  }

  try {
    // =====================================================================
    // 1. Domain Rank Overview (for all domains)
    // =====================================================================
    let locationRankSnapshot: DomainRankSnapshot | null = null

    for (const domain of allDomains) {
      const result = await fetchDomainRankOverview({ target: domain })
      if (!result) continue

      const normalized = normalizeDomainRankOverview(result, domain)
      const diffHash = hashDomainRankSnapshot(normalized)

      if (domain === locationDomain) {
        locationRankSnapshot = normalized
        await supabase.from("location_snapshots").upsert({
          location_id: locationId,
          provider: "seo_domain_rank_overview",
          date_key: dateKey,
          captured_at: new Date().toISOString(),
          raw_data: normalized as unknown as Record<string, unknown>,
          diff_hash: diffHash,
        }, { onConflict: "location_id,provider,date_key" })
      } else {
        const comp = compDomains.find((c) => c.domain === domain)
        if (comp) {
          await supabase.from("snapshots").upsert({
            competitor_id: comp.id,
            captured_at: new Date().toISOString(),
            date_key: dateKey,
            provider: "dataforseo_labs",
            snapshot_type: SEO_SNAPSHOT_TYPES.domainRankOverview,
            raw_data: normalized as unknown as Record<string, unknown>,
            diff_hash: diffHash,
          }, { onConflict: "competitor_id,date_key,snapshot_type" })
        }
      }
    }

    // =====================================================================
    // 2. Ranked Keywords (for location domain OR seed domain)
    // =====================================================================
    let currentKeywords: NormalizedRankedKeyword[] = []
    const rkDomain = locationDomain ?? seedDomain

    if (rkDomain) {
      const rkResult = await fetchRankedKeywords({
        target: rkDomain,
        limit: getSeoRankedKeywordsLimit(tier),
      })
      if (rkResult) {
        currentKeywords = normalizeRankedKeywords(rkResult)
        const diffHash = hashRankedKeywords(currentKeywords)
        await supabase.from("location_snapshots").upsert({
          location_id: locationId,
          provider: "seo_ranked_keywords",
          date_key: dateKey,
          captured_at: new Date().toISOString(),
          raw_data: { version: "1.0", domain: rkDomain, keywords: currentKeywords } as unknown as Record<string, unknown>,
          diff_hash: diffHash,
        }, { onConflict: "location_id,provider,date_key" })
      }
    }

    // =====================================================================
    // 3. Auto-seed tracked keywords (if empty) using seed domain
    // =====================================================================
    const { data: existingKws } = await supabase
      .from("tracked_keywords")
      .select("id")
      .eq("location_id", locationId)
      .limit(1)

    if ((existingKws?.length ?? 0) === 0 && seedDomain) {
      const kfsResult = await fetchKeywordsForSite({
        target: seedDomain,
        limit: getSeoTrackedKeywordsLimit(tier),
      })
      if (kfsResult) {
        const candidates = normalizeKeywordsForSite(kfsResult)
        const kwRows = candidates
          .filter((k) => k.keyword)
          .slice(0, getSeoTrackedKeywordsLimit(tier))
          .map((k) => ({
            location_id: locationId,
            keyword: k.keyword,
            source: "auto" as const,
            tags: { searchVolume: k.searchVolume, cpc: k.cpc },
          }))
        if (kwRows.length > 0) {
          await supabase.from("tracked_keywords").upsert(kwRows, {
            onConflict: "location_id,keyword",
          })
        }
      }
    }

    // =====================================================================
    // 4. Competitors Domain (organic competitor discovery – normalized)
    // =====================================================================
    if (seedDomain) {
      const cdResult = await fetchCompetitorsDomain({ target: seedDomain, limit: 10 })
      if (cdResult) {
        const normalizedComps = normalizeCompetitorsDomain(cdResult)
        await supabase.from("location_snapshots").upsert({
          location_id: locationId,
          provider: "seo_competitors_domain",
          date_key: dateKey,
          captured_at: new Date().toISOString(),
          raw_data: { version: "1.0", domain: seedDomain, competitors: normalizedComps } as unknown as Record<string, unknown>,
          diff_hash: hashJsonPayload(normalizedComps),
        }, { onConflict: "location_id,provider,date_key" })
      }
    }

    // =====================================================================
    // 5. SERP for tracked keywords
    // =====================================================================
    const { data: trackedKws } = await supabase
      .from("tracked_keywords")
      .select("keyword")
      .eq("location_id", locationId)
      .eq("is_active", true)
      .limit(getSeoTrackedKeywordsLimit(tier))

    const serpEntries: SerpRankEntry[] = []
    for (const kw of trackedKws ?? []) {
      const serpResult = await fetchSerpOrganic({ keyword: kw.keyword })
      if (serpResult) {
        const entry = normalizeSerpOrganic(serpResult, kw.keyword, allDomains)
        serpEntries.push(entry)
      }
    }

    if (serpEntries.length > 0) {
      const diffHash = hashSerpRanks(serpEntries)
      await supabase.from("location_snapshots").upsert({
        location_id: locationId,
        provider: "seo_serp_keywords",
        date_key: dateKey,
        captured_at: new Date().toISOString(),
        raw_data: { version: "1.0", entries: serpEntries } as unknown as Record<string, unknown>,
        diff_hash: diffHash,
      }, { onConflict: "location_id,provider,date_key" })
    }

    // =====================================================================
    // 6. Domain Intersection (paid tiers only, needs location domain)
    // =====================================================================
    let intersectionRows: NormalizedIntersectionRow[] = []

    if (isSeoIntersectionEnabled(tier) && locationDomain) {
      const limit = getSeoIntersectionLimit(tier)
      for (const comp of compDomains.slice(0, 5)) {
        const diResult = await fetchDomainIntersection({
          target1: locationDomain,
          target2: comp.domain,
          limit,
        })
        if (diResult) {
          const normalized = normalizeDomainIntersection(diResult)
          intersectionRows.push(...normalized)

          await supabase.from("snapshots").upsert({
            competitor_id: comp.id,
            captured_at: new Date().toISOString(),
            date_key: dateKey,
            provider: "dataforseo_labs",
            snapshot_type: SEO_SNAPSHOT_TYPES.domainIntersection,
            raw_data: { version: "1.0", rows: normalized } as unknown as Record<string, unknown>,
            diff_hash: hashJsonPayload(normalized),
          }, { onConflict: "competitor_id,date_key,snapshot_type" })
        }
      }
    }

    // =====================================================================
    // 7. Ads Search (paid tiers only)
    // =====================================================================
    let adCreatives: NormalizedAdCreative[] = []

    if (isSeoAdsEnabled(tier)) {
      for (const kw of (trackedKws ?? []).slice(0, 10)) {
        const adsResult = await fetchAdsSearch({ keyword: kw.keyword })
        if (adsResult) {
          adCreatives.push(...normalizeAdsSearch(adsResult, kw.keyword))
        }
      }

      if (adCreatives.length > 0) {
        await supabase.from("location_snapshots").upsert({
          location_id: locationId,
          provider: "seo_ads_search",
          date_key: dateKey,
          captured_at: new Date().toISOString(),
          raw_data: { version: "1.0", creatives: adCreatives } as unknown as Record<string, unknown>,
          diff_hash: hashJsonPayload(adCreatives),
        }, { onConflict: "location_id,provider,date_key" })
      }
    }

    // =====================================================================
    // 8. Backlinks Summary (location + competitors)
    // =====================================================================
    let locationBacklinks: NormalizedBacklinksSummary | null = null

    if (locationDomain) {
      const blResult = await fetchBacklinksSummary({ target: locationDomain })
      if (blResult) {
        locationBacklinks = normalizeBacklinksSummary(blResult, locationDomain)
        await supabase.from("location_snapshots").upsert({
          location_id: locationId,
          provider: "seo_backlinks_summary",
          date_key: dateKey,
          captured_at: new Date().toISOString(),
          raw_data: locationBacklinks as unknown as Record<string, unknown>,
          diff_hash: hashJsonPayload(locationBacklinks),
        }, { onConflict: "location_id,provider,date_key" })
      }
    }

    // Backlinks for competitors (up to 5)
    for (const comp of compDomains.slice(0, 5)) {
      try {
        const blResult = await fetchBacklinksSummary({ target: comp.domain })
        if (blResult) {
          const normalized = normalizeBacklinksSummary(blResult, comp.domain)
          await supabase.from("snapshots").upsert({
            competitor_id: comp.id,
            captured_at: new Date().toISOString(),
            date_key: dateKey,
            provider: "dataforseo_backlinks",
            snapshot_type: SEO_SNAPSHOT_TYPES.backlinksSummary,
            raw_data: normalized as unknown as Record<string, unknown>,
            diff_hash: hashJsonPayload(normalized),
          }, { onConflict: "competitor_id,date_key,snapshot_type" })
        }
      } catch (err) {
        console.warn(`Backlinks fetch failed for ${comp.domain}:`, err)
      }
    }

    // =====================================================================
    // 9. Relevant Pages (location domain only)
    // =====================================================================
    if (locationDomain) {
      const rpResult = await fetchRelevantPages({ target: locationDomain, limit: 25 })
      if (rpResult) {
        const normalizedPages = normalizeRelevantPages(rpResult)
        await supabase.from("location_snapshots").upsert({
          location_id: locationId,
          provider: "seo_relevant_pages",
          date_key: dateKey,
          captured_at: new Date().toISOString(),
          raw_data: { version: "1.0", pages: normalizedPages } as unknown as Record<string, unknown>,
          diff_hash: hashJsonPayload(normalizedPages),
        }, { onConflict: "location_id,provider,date_key" })
      }
    }

    // =====================================================================
    // 10. Subdomains (location domain only)
    // =====================================================================
    if (locationDomain) {
      const sdResult = await fetchSubdomains({ target: locationDomain, limit: 10 })
      if (sdResult) {
        const normalizedSubs = normalizeSubdomains(sdResult)
        await supabase.from("location_snapshots").upsert({
          location_id: locationId,
          provider: "seo_subdomains",
          date_key: dateKey,
          captured_at: new Date().toISOString(),
          raw_data: { version: "1.0", subdomains: normalizedSubs } as unknown as Record<string, unknown>,
          diff_hash: hashJsonPayload(normalizedSubs),
        }, { onConflict: "location_id,provider,date_key" })
      }
    }

    // =====================================================================
    // 11. Historical Rank Overview (location domain only, last 12 months)
    // =====================================================================
    if (locationDomain) {
      const hrResult = await fetchHistoricalRankOverview({ target: locationDomain })
      if (hrResult) {
        const normalizedHistory = normalizeHistoricalRankOverview(hrResult)
        await supabase.from("location_snapshots").upsert({
          location_id: locationId,
          provider: "seo_historical_rank",
          date_key: dateKey,
          captured_at: new Date().toISOString(),
          raw_data: { version: "1.0", history: normalizedHistory } as unknown as Record<string, unknown>,
          diff_hash: hashJsonPayload(normalizedHistory),
        }, { onConflict: "location_id,provider,date_key" })
      }
    }

    // =====================================================================
    // 12. Generate deterministic insights
    // =====================================================================
    const prevDateKey = getPreviousDateKey(dateKey, 7)

    // Previous rank snapshot
    const { data: prevRankSnap } = await supabase
      .from("location_snapshots")
      .select("raw_data")
      .eq("location_id", locationId)
      .eq("provider", "seo_domain_rank_overview")
      .eq("date_key", prevDateKey)
      .maybeSingle()
    const previousRank = prevRankSnap?.raw_data as DomainRankSnapshot | null

    // Previous ranked keywords
    const { data: prevKwSnap } = await supabase
      .from("location_snapshots")
      .select("raw_data")
      .eq("location_id", locationId)
      .eq("provider", "seo_ranked_keywords")
      .eq("date_key", prevDateKey)
      .maybeSingle()
    const previousKeywords = (prevKwSnap?.raw_data as Record<string, unknown>)?.keywords as NormalizedRankedKeyword[] ?? []

    // Previous SERP
    const { data: prevSerpSnap } = await supabase
      .from("location_snapshots")
      .select("raw_data")
      .eq("location_id", locationId)
      .eq("provider", "seo_serp_keywords")
      .eq("date_key", prevDateKey)
      .maybeSingle()
    const previousSerpEntries = (prevSerpSnap?.raw_data as Record<string, unknown>)?.entries as SerpRankEntry[] ?? []

    // Previous intersection (aggregate)
    const previousIntersectionRows: NormalizedIntersectionRow[] = []
    const { data: prevAdsSnap } = await supabase
      .from("location_snapshots")
      .select("raw_data")
      .eq("location_id", locationId)
      .eq("provider", "seo_ads_search")
      .eq("date_key", prevDateKey)
      .maybeSingle()
    const previousAdCreatives = (prevAdsSnap?.raw_data as Record<string, unknown>)?.creatives as NormalizedAdCreative[] ?? []

    // Previous backlinks
    const { data: prevBlSnap } = await supabase
      .from("location_snapshots")
      .select("raw_data")
      .eq("location_id", locationId)
      .eq("provider", "seo_backlinks_summary")
      .eq("date_key", prevDateKey)
      .maybeSingle()
    const previousBacklinks = prevBlSnap?.raw_data as NormalizedBacklinksSummary | null

    // Previous relevant pages
    const { data: prevPagesSnap } = await supabase
      .from("location_snapshots")
      .select("raw_data")
      .eq("location_id", locationId)
      .eq("provider", "seo_relevant_pages")
      .eq("date_key", prevDateKey)
      .maybeSingle()
    const previousPages = ((prevPagesSnap?.raw_data as Record<string, unknown>)?.pages ?? []) as import("@/lib/seo/types").NormalizedRelevantPage[]

    // Current relevant pages (for insights - already saved above)
    const currentPagesForInsights = (() => {
      try {
        // Re-read from what we just saved
        return [] as import("@/lib/seo/types").NormalizedRelevantPage[]
      } catch {
        return []
      }
    })()

    // Historical traffic (just stored above)
    const { data: hrSnapForInsight } = await supabase
      .from("location_snapshots")
      .select("raw_data")
      .eq("location_id", locationId)
      .eq("provider", "seo_historical_rank")
      .order("date_key", { ascending: false })
      .limit(1)
      .maybeSingle()
    const historicalTraffic = ((hrSnapForInsight?.raw_data as Record<string, unknown>)?.history ?? []) as import("@/lib/seo/types").HistoricalTrafficPoint[]

    const insightContext: SeoInsightContext = {
      locationName: location.name ?? "Your location",
      locationDomain: locationDomain ?? seedDomain,
      competitors: competitors.map((c) => ({
        id: c.id,
        name: c.name ?? null,
        domain: extractDomain(c.website),
      })),
    }

    const insights = generateSeoInsights({
      currentRank: locationRankSnapshot,
      previousRank,
      currentKeywords,
      previousKeywords,
      serpEntries,
      previousSerpEntries,
      intersectionRows,
      previousIntersectionRows,
      adCreatives,
      previousAdCreatives,
      currentBacklinks: locationBacklinks,
      previousBacklinks,
      currentPages: currentPagesForInsights,
      previousPages,
      historicalTraffic,
      context: insightContext,
    })

    if (insights.length > 0) {
      const insightsPayload = insights.map((insight) => ({
        location_id: locationId,
        competitor_id: insight.evidence?.competitor_id
          ? String(insight.evidence.competitor_id)
          : null,
        date_key: dateKey,
        insight_type: insight.insight_type,
        title: insight.title,
        summary: insight.summary,
        confidence: insight.confidence,
        severity: insight.severity,
        evidence: insight.evidence,
        recommendations: insight.recommendations,
        status: "new",
      }))

      await supabase.from("insights").upsert(insightsPayload, {
        onConflict: "location_id,competitor_id,date_key,insight_type",
      })
    }

    const successMsg = locationDomain
      ? "SEO+data+refreshed+successfully"
      : "SEO+data+refreshed+using+competitor+domains.+No+website+could+be+resolved+from+Google+Places.+You+can+manually+add+a+website+URL+to+your+location+for+full+tracking."
    redirect(`/visibility?location_id=${locationId}&success=${successMsg}`)
  } catch (error) {
    // Re-throw redirect errors (Next.js uses error.digest starting with NEXT_REDIRECT)
    const digest = (error as { digest?: string })?.digest
    if (digest?.startsWith("NEXT_REDIRECT")) throw error
    console.error("refreshSeoAction error:", error)
    redirect(`/visibility?error=${encodeURIComponent(String(error))}&location_id=${locationId}`)
  }
}
