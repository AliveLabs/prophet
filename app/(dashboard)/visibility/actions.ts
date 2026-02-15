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
  normalizeRelevantPages,
  normalizeSubdomains,
  normalizeHistoricalRankOverview,
} from "@/lib/seo/normalize"
import { hashDomainRankSnapshot, hashRankedKeywords, hashSerpRanks, hashJsonPayload } from "@/lib/seo/hash"
import { generateSeoInsights, type SeoInsightContext } from "@/lib/seo/insights"
import { SEO_SNAPSHOT_TYPES } from "@/lib/seo/types"
import type { DomainRankSnapshot, NormalizedRankedKeyword, SerpRankEntry, NormalizedIntersectionRow, NormalizedAdCreative } from "@/lib/seo/types"

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

  // Track non-fatal errors from individual API sections
  const warnings: string[] = []

  // Shared data collected across sections
  let locationRankSnapshot: DomainRankSnapshot | null = null
  let currentKeywords: NormalizedRankedKeyword[] = []
  const serpEntries: SerpRankEntry[] = []
  let intersectionRows: NormalizedIntersectionRow[] = []
  let adCreatives: NormalizedAdCreative[] = []
  // (Backlinks API removed — requires separate DataForSEO subscription)

  // =====================================================================
  // 1. Domain Rank Overview (for all domains)
  // =====================================================================
  try {
    for (const domain of allDomains) {
      const result = await fetchDomainRankOverview({ target: domain })
      if (!result) continue

      const normalized = normalizeDomainRankOverview(result, domain)
      const diffHash = hashDomainRankSnapshot(normalized)

      if (domain === locationDomain) {
        locationRankSnapshot = normalized
        console.log(`[SEO] Domain Rank Overview for ${domain}:`, JSON.stringify({
          organic_etv: normalized.organic.etv,
          organic_keywords: normalized.organic.rankedKeywords,
          paid_etv: normalized.paid.etv,
          paid_keywords: normalized.paid.rankedKeywords,
          traffic_cost: normalized.organic.estimatedPaidTrafficCost,
        }))
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
  } catch (err) {
    console.warn("Step 1 (Domain Rank Overview) failed:", err)
    warnings.push("Domain rank overview partially failed")
  }

  // =====================================================================
  // 2. Ranked Keywords (for location domain OR seed domain)
  // =====================================================================
  try {
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
  } catch (err) {
    console.warn("Step 2 (Ranked Keywords) failed:", err)
    warnings.push("Ranked keywords failed")
  }

  // =====================================================================
  // 3. Auto-seed tracked keywords (if empty) using seed domain
  // =====================================================================
  try {
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
  } catch (err) {
    console.warn("Step 3 (Keyword seeding) failed:", err)
    warnings.push("Keyword seeding failed")
  }

  // =====================================================================
  // 4. Competitors Domain (organic competitor discovery – normalized)
  // =====================================================================
  try {
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
  } catch (err) {
    console.warn("Step 4 (Competitors Domain) failed:", err)
    warnings.push("Competitor discovery failed")
  }

  // =====================================================================
  // 5. SERP for tracked keywords
  // =====================================================================
  try {
    const { data: trackedKws } = await supabase
      .from("tracked_keywords")
      .select("keyword")
      .eq("location_id", locationId)
      .eq("is_active", true)
      .limit(getSeoTrackedKeywordsLimit(tier))

    for (const kw of trackedKws ?? []) {
      try {
        const serpResult = await fetchSerpOrganic({ keyword: kw.keyword })
        if (serpResult) {
          const entry = normalizeSerpOrganic(serpResult, kw.keyword, allDomains)
          serpEntries.push(entry)
        }
      } catch (serpErr) {
        console.warn(`SERP fetch failed for "${kw.keyword}":`, serpErr)
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
  } catch (err) {
    console.warn("Step 5 (SERP keywords) failed:", err)
    warnings.push("SERP tracking failed")
  }

  // =====================================================================
  // 6. Domain Intersection (needs location domain)
  // =====================================================================
  try {
    if (isSeoIntersectionEnabled(tier) && locationDomain) {
      const limit = getSeoIntersectionLimit(tier)
      for (const comp of compDomains.slice(0, 5)) {
        try {
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
        } catch (diErr) {
          console.warn(`Domain intersection failed for ${comp.domain}:`, diErr)
        }
      }
    }
  } catch (err) {
    console.warn("Step 6 (Domain Intersection) failed:", err)
    warnings.push("Domain intersection failed")
  }

  // =====================================================================
  // 7. Ads Search (domain-based, Google Ads Transparency)
  // =====================================================================
  try {
    if (isSeoAdsEnabled(tier)) {
      for (const domain of allDomains.slice(0, 5)) {
        try {
          const adsResult = await fetchAdsSearch({ target: domain })
          if (adsResult) {
            adCreatives.push(...normalizeAdsSearch(adsResult, domain))
          }
        } catch (adsErr) {
          console.warn(`Ads search failed for ${domain}:`, adsErr)
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
  } catch (err) {
    console.warn("Step 7 (Ads Search) failed:", err)
    warnings.push("Ads search failed")
  }

  // =====================================================================
  // 8. Relevant Pages (location domain only)
  // =====================================================================
  try {
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
  } catch (err) {
    console.warn("Step 9 (Relevant Pages) failed:", err)
    warnings.push("Relevant pages failed")
  }

  // =====================================================================
  // 10. Subdomains (location domain only)
  // =====================================================================
  try {
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
  } catch (err) {
    console.warn("Step 10 (Subdomains) failed:", err)
    warnings.push("Subdomains failed")
  }

  // =====================================================================
  // 11. Historical Rank Overview (location domain only, last 12 months)
  // =====================================================================
  try {
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
  } catch (err) {
    console.warn("Step 11 (Historical Rank) failed:", err)
    warnings.push("Historical rank failed")
  }

  // =====================================================================
  // 12. Ranked Keywords for each competitor
  // =====================================================================
  try {
    const rkLimit = getSeoRankedKeywordsLimit(tier)
    for (const comp of compDomains) {
      try {
        const rkResult = await fetchRankedKeywords({ target: comp.domain, limit: rkLimit })
        if (rkResult) {
          const normalized = normalizeRankedKeywords(rkResult)
          const diffHash = hashRankedKeywords(normalized)
          await supabase.from("snapshots").upsert({
            competitor_id: comp.id,
            captured_at: new Date().toISOString(),
            date_key: dateKey,
            provider: "dataforseo_labs",
            snapshot_type: SEO_SNAPSHOT_TYPES.rankedKeywords,
            raw_data: { version: "1.0", domain: comp.domain, keywords: normalized } as unknown as Record<string, unknown>,
            diff_hash: diffHash,
          }, { onConflict: "competitor_id,date_key,snapshot_type" })
          console.log(`[SEO] Ranked Keywords for competitor ${comp.name}: ${normalized.length} keywords`)
        }
      } catch (rkErr) {
        console.warn(`Ranked Keywords failed for competitor ${comp.domain}:`, rkErr)
      }
    }
  } catch (err) {
    console.warn("Step 12 (Competitor Ranked Keywords) failed:", err)
    warnings.push("Competitor ranked keywords partially failed")
  }

  // =====================================================================
  // 13. Relevant Pages for each competitor
  // =====================================================================
  try {
    for (const comp of compDomains) {
      try {
        const rpResult = await fetchRelevantPages({ target: comp.domain, limit: 25 })
        if (rpResult) {
          const normalized = normalizeRelevantPages(rpResult)
          await supabase.from("snapshots").upsert({
            competitor_id: comp.id,
            captured_at: new Date().toISOString(),
            date_key: dateKey,
            provider: "dataforseo_labs",
            snapshot_type: SEO_SNAPSHOT_TYPES.relevantPages,
            raw_data: { version: "1.0", domain: comp.domain, pages: normalized } as unknown as Record<string, unknown>,
            diff_hash: hashJsonPayload(normalized),
          }, { onConflict: "competitor_id,date_key,snapshot_type" })
          console.log(`[SEO] Relevant Pages for competitor ${comp.name}: ${normalized.length} pages`)
        }
      } catch (rpErr) {
        console.warn(`Relevant Pages failed for competitor ${comp.domain}:`, rpErr)
      }
    }
  } catch (err) {
    console.warn("Step 13 (Competitor Relevant Pages) failed:", err)
    warnings.push("Competitor relevant pages partially failed")
  }

  // =====================================================================
  // 14. Historical Rank for each competitor
  // =====================================================================
  try {
    for (const comp of compDomains) {
      try {
        const hrResult = await fetchHistoricalRankOverview({ target: comp.domain })
        if (hrResult) {
          const normalized = normalizeHistoricalRankOverview(hrResult)
          await supabase.from("snapshots").upsert({
            competitor_id: comp.id,
            captured_at: new Date().toISOString(),
            date_key: dateKey,
            provider: "dataforseo_labs",
            snapshot_type: SEO_SNAPSHOT_TYPES.historicalRank,
            raw_data: { version: "1.0", domain: comp.domain, history: normalized } as unknown as Record<string, unknown>,
            diff_hash: hashJsonPayload(normalized),
          }, { onConflict: "competitor_id,date_key,snapshot_type" })
          console.log(`[SEO] Historical Rank for competitor ${comp.name}: ${normalized.length} months`)
        }
      } catch (hrErr) {
        console.warn(`Historical Rank failed for competitor ${comp.domain}:`, hrErr)
      }
    }
  } catch (err) {
    console.warn("Step 14 (Competitor Historical Rank) failed:", err)
    warnings.push("Competitor historical rank partially failed")
  }

  // =====================================================================
  // 15. Generate deterministic insights
  // =====================================================================
  try {
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

    // Previous relevant pages
    const { data: prevPagesSnap } = await supabase
      .from("location_snapshots")
      .select("raw_data")
      .eq("location_id", locationId)
      .eq("provider", "seo_relevant_pages")
      .eq("date_key", prevDateKey)
      .maybeSingle()
    const previousPages = ((prevPagesSnap?.raw_data as Record<string, unknown>)?.pages ?? []) as import("@/lib/seo/types").NormalizedRelevantPage[]

    // Current relevant pages (re-read from what we just saved)
    const { data: curPagesSnap } = await supabase
      .from("location_snapshots")
      .select("raw_data")
      .eq("location_id", locationId)
      .eq("provider", "seo_relevant_pages")
      .eq("date_key", dateKey)
      .maybeSingle()
    const currentPagesForInsights = ((curPagesSnap?.raw_data as Record<string, unknown>)?.pages ?? []) as import("@/lib/seo/types").NormalizedRelevantPage[]

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
      currentBacklinks: null,
      previousBacklinks: null,
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
  } catch (err) {
    console.warn("Step 12 (Insights) failed:", err)
    warnings.push("Insight generation failed")
  }

  // =====================================================================
  // Done – redirect with success (and any warnings)
  // =====================================================================
  try {
    let successMsg = locationDomain
      ? "SEO data refreshed successfully"
      : "SEO data refreshed using competitor domains. No website could be resolved from Google Places. You can manually add a website URL to your location for full tracking."
    if (warnings.length > 0) {
      successMsg += ` (partial: ${warnings.join(", ")})`
    }
    redirect(`/visibility?location_id=${locationId}&success=${encodeURIComponent(successMsg)}`)
  } catch (error) {
    const digest = (error as { digest?: string })?.digest
    if (digest?.startsWith("NEXT_REDIRECT")) throw error
    console.error("refreshSeoAction redirect error:", error)
    redirect(`/visibility?error=${encodeURIComponent(String(error))}&location_id=${locationId}`)
  }
}
