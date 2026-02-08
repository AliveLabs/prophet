// ---------------------------------------------------------------------------
// SEO Search Intelligence – Normalization
// ---------------------------------------------------------------------------

import type { DomainRankOverviewResult, DomainRankMetrics } from "@/lib/providers/dataforseo/domain-rank-overview"
import type { RankedKeywordsResult, RankedKeywordItem } from "@/lib/providers/dataforseo/ranked-keywords"
import type { KeywordsForSiteResult, KeywordForSiteItem } from "@/lib/providers/dataforseo/keywords-for-site"
import type { SerpOrganicResult, SerpOrganicItem } from "@/lib/providers/dataforseo/serp-organic"
import type { DomainIntersectionResult, DomainIntersectionItem } from "@/lib/providers/dataforseo/domain-intersection"
import type { AdsSearchResult, AdsSearchItem } from "@/lib/providers/dataforseo/ads-search"
import type { CompetitorsDomainResult, CompetitorDomainItem } from "@/lib/providers/dataforseo/competitors-domain"
import type { BacklinksSummaryItem } from "@/lib/providers/dataforseo/backlinks-summary"
import type { RelevantPagesResult, RelevantPageItem } from "@/lib/providers/dataforseo/relevant-pages"
import type { SubdomainsResult, SubdomainItem } from "@/lib/providers/dataforseo/subdomains"
import type { HistoricalRankOverviewResult, HistoricalRankMonthlyItem } from "@/lib/providers/dataforseo/historical-rank-overview"
import type {
  DomainRankSnapshot,
  RankDistribution,
  NormalizedRankedKeyword,
  NormalizedKeywordCandidate,
  SerpRankEntry,
  NormalizedIntersectionRow,
  NormalizedAdCreative,
  NormalizedOrganicCompetitor,
  NormalizedBacklinksSummary,
  NormalizedRelevantPage,
  NormalizedSubdomain,
  HistoricalTrafficPoint,
} from "./types"

// ---------------------------------------------------------------------------
// 1. Domain Rank Overview
// ---------------------------------------------------------------------------

function sumMetricDistribution(m: DomainRankMetrics | undefined): RankDistribution {
  if (!m) return { pos_1: 0, pos_2_3: 0, pos_4_10: 0, pos_11_20: 0, pos_21_50: 0, pos_51_100: 0 }
  return {
    pos_1: m.pos_1 ?? 0,
    pos_2_3: m.pos_2_3 ?? 0,
    pos_4_10: m.pos_4_10 ?? 0,
    pos_11_20: m.pos_11_20 ?? 0,
    pos_21_50:
      (m.pos_21_30 ?? 0) + (m.pos_31_40 ?? 0) + (m.pos_41_50 ?? 0),
    pos_51_100:
      (m.pos_51_60 ?? 0) + (m.pos_61_70 ?? 0) + (m.pos_71_80 ?? 0) + (m.pos_81_90 ?? 0) + (m.pos_91_100 ?? 0),
  }
}

export function normalizeDomainRankOverview(
  result: DomainRankOverviewResult,
  domain: string
): DomainRankSnapshot {
  const item = result.items?.[0]
  const organic = item?.organic
  const paid = item?.paid
  const featuredSnippet = item?.featured_snippet
  const localPack = item?.local_pack

  return {
    version: "1.0",
    capturedAt: new Date().toISOString(),
    domain,
    organic: {
      etv: organic?.etv ?? 0,
      rankedKeywords: organic?.count ?? 0,
      distribution: sumMetricDistribution(organic),
      estimatedPaidTrafficCost: organic?.estimated_paid_traffic_cost ?? 0,
      newKeywords: organic?.is_new ?? 0,
      lostKeywords: organic?.is_lost ?? 0,
      upKeywords: organic?.is_up ?? 0,
      downKeywords: organic?.is_down ?? 0,
      featuredSnippetCount: featuredSnippet?.count ?? 0,
      localPackCount: localPack?.count ?? 0,
    },
    paid: {
      etv: paid?.etv ?? 0,
      rankedKeywords: paid?.count ?? 0,
      estimatedCost: paid?.estimated_paid_traffic_cost ?? 0,
    },
  }
}

// ---------------------------------------------------------------------------
// 2. Ranked Keywords (enriched with intent + difficulty)
// ---------------------------------------------------------------------------

export function normalizeRankedKeywords(
  result: RankedKeywordsResult
): NormalizedRankedKeyword[] {
  return (result.items ?? []).map((item: RankedKeywordItem) => {
    const kd = item.keyword_data
    const si = item.ranked_serp_element?.serp_item
    return {
      keyword: kd?.keyword ?? "",
      rank: si?.rank_group ?? si?.rank_absolute ?? 999,
      url: si?.url ?? null,
      searchVolume: kd?.keyword_info?.search_volume ?? null,
      cpc: kd?.keyword_info?.cpc ?? null,
      competition: kd?.keyword_info?.competition ?? null,
      competitionLevel: kd?.keyword_info?.competition_level ?? null,
      serpFeatures: kd?.serp_info?.serp_item_types ?? [],
      isPaid: si?.is_paid ?? false,
      intent: kd?.search_intent_info?.main_intent ?? null,
      keywordDifficulty: kd?.keyword_properties?.keyword_difficulty ?? null,
    }
  })
}

// ---------------------------------------------------------------------------
// 3. Keywords For Site (candidate seeding)
// ---------------------------------------------------------------------------

export function normalizeKeywordsForSite(
  result: KeywordsForSiteResult
): NormalizedKeywordCandidate[] {
  return (result.items ?? []).map((item: KeywordForSiteItem) => ({
    keyword: item.keyword ?? "",
    searchVolume: item.keyword_info?.search_volume ?? null,
    cpc: item.keyword_info?.cpc ?? null,
    competition: item.keyword_info?.competition ?? null,
    competitionLevel: item.keyword_info?.competition_level ?? null,
  }))
}

// ---------------------------------------------------------------------------
// 4. SERP Organic (rank positions for tracked keywords)
// ---------------------------------------------------------------------------

export function normalizeSerpOrganic(
  result: SerpOrganicResult,
  keyword: string,
  domains: string[]
): SerpRankEntry {
  const items = result.items ?? []
  const positions: Record<string, number | null> = {}

  for (const domain of domains) {
    const found = items.find((item: SerpOrganicItem) =>
      item.domain?.includes(domain) && item.type === "organic"
    )
    positions[domain] = found?.rank_group ?? null
  }

  const serpFeatures = result.item_types ?? []

  return {
    keyword,
    positions,
    searchVolume: null, // SERP doesn't include this; enrich from Labs data
    serpFeatures,
    fetchedAt: result.datetime ?? new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// 5. Domain Intersection
// ---------------------------------------------------------------------------

export function normalizeDomainIntersection(
  result: DomainIntersectionResult
): NormalizedIntersectionRow[] {
  return (result.items ?? []).map((item: DomainIntersectionItem) => {
    const kw = item.keyword_data?.keyword ?? ""
    const r1 = item.first_domain_serp_element?.serp_item?.rank_group ?? null
    const r2 = item.second_domain_serp_element?.serp_item?.rank_group ?? null

    let gapType: "win" | "loss" | "shared" = "shared"
    if (r1 !== null && r2 === null) gapType = "win"
    else if (r1 === null && r2 !== null) gapType = "loss"

    return {
      keyword: kw,
      searchVolume: item.keyword_data?.keyword_info?.search_volume ?? null,
      cpc: item.keyword_data?.keyword_info?.cpc ?? null,
      competition: item.keyword_data?.keyword_info?.competition ?? null,
      domain1Rank: r1,
      domain2Rank: r2,
      gapType,
    }
  })
}

// ---------------------------------------------------------------------------
// 6. Ads Search
// ---------------------------------------------------------------------------

export function normalizeAdsSearch(
  result: AdsSearchResult,
  keyword: string
): NormalizedAdCreative[] {
  return (result.items ?? []).map((item: AdsSearchItem) => ({
    headline: item.title ?? null,
    description: item.description ?? null,
    displayUrl: item.breadcrumb ?? item.url ?? null,
    domain: item.domain ?? null,
    position: item.rank_group ?? null,
    keyword,
    fetchedAt: result.datetime ?? new Date().toISOString(),
  }))
}

// ---------------------------------------------------------------------------
// 7. Competitors Domain
// ---------------------------------------------------------------------------

export function normalizeCompetitorsDomain(
  result: CompetitorsDomainResult
): NormalizedOrganicCompetitor[] {
  return (result.items ?? []).map((item: CompetitorDomainItem) => {
    // full_domain_metrics has keys per se_type; pick first or "google"
    const metricsMap = item.full_domain_metrics ?? {}
    const metricsEntry = metricsMap["google"] ?? Object.values(metricsMap)[0]
    const organic = metricsEntry?.organic

    return {
      domain: item.domain ?? "",
      avgPosition: item.avg_position ?? 0,
      intersections: item.intersections ?? 0,
      organicKeywords: organic?.count ?? 0,
      organicEtv: organic?.etv ?? 0,
      paidKeywords: metricsEntry?.paid?.count ?? 0,
    }
  })
}

// ---------------------------------------------------------------------------
// 8. Backlinks Summary
// ---------------------------------------------------------------------------

export function normalizeBacklinksSummary(
  item: BacklinksSummaryItem,
  domain: string
): NormalizedBacklinksSummary {
  return {
    domain,
    domainTrust: item.rank ?? 0,
    backlinks: item.backlinks ?? 0,
    referringDomains: item.referring_domains ?? 0,
    referringPages: item.referring_pages ?? 0,
    brokenBacklinks: item.broken_backlinks ?? 0,
    externalLinks: item.external_links ?? 0,
    referringMainDomains: item.referring_main_domains ?? 0,
    topTlds: item.referring_links_tld ?? {},
    capturedAt: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// 9. Relevant Pages
// ---------------------------------------------------------------------------

export function normalizeRelevantPages(
  result: RelevantPagesResult
): NormalizedRelevantPage[] {
  const items = result.items ?? []
  // Compute total ETV for traffic share %
  const totalEtv = items.reduce((sum, p: RelevantPageItem) => sum + (p.metrics?.organic?.etv ?? 0), 0)

  return items.map((item: RelevantPageItem) => {
    const etv = item.metrics?.organic?.etv ?? 0
    return {
      url: item.page_address ?? "",
      organicEtv: etv,
      organicKeywords: item.metrics?.organic?.count ?? 0,
      trafficShare: totalEtv > 0 ? Math.round((etv / totalEtv) * 10000) / 100 : 0,
    }
  })
}

// ---------------------------------------------------------------------------
// 10. Subdomains
// ---------------------------------------------------------------------------

export function normalizeSubdomains(
  result: SubdomainsResult
): NormalizedSubdomain[] {
  const items = result.items ?? []
  const totalEtv = items.reduce((sum, s: SubdomainItem) => sum + (s.metrics?.organic?.etv ?? 0), 0)

  return items.map((item: SubdomainItem) => {
    const etv = item.metrics?.organic?.etv ?? 0
    return {
      subdomain: item.subdomain ?? "",
      organicEtv: etv,
      organicKeywords: item.metrics?.organic?.count ?? 0,
      trafficShare: totalEtv > 0 ? Math.round((etv / totalEtv) * 10000) / 100 : 0,
    }
  })
}

// ---------------------------------------------------------------------------
// 11. Historical Rank Overview
// ---------------------------------------------------------------------------

export function normalizeHistoricalRankOverview(
  result: HistoricalRankOverviewResult
): HistoricalTrafficPoint[] {
  return (result.items ?? []).map((item: HistoricalRankMonthlyItem) => {
    const month = String(item.month ?? 1).padStart(2, "0")
    return {
      date: `${item.year ?? 2025}-${month}`,
      organicEtv: item.organic?.etv ?? 0,
      paidEtv: item.paid?.etv ?? 0,
      organicKeywords: item.organic?.count ?? 0,
      paidKeywords: item.paid?.count ?? 0,
      organicCost: item.organic?.estimated_paid_traffic_cost ?? 0,
    }
  }).sort((a, b) => a.date.localeCompare(b.date))
}
