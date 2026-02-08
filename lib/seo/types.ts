// ---------------------------------------------------------------------------
// SEO Search Intelligence – Normalized Types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Domain Rank Overview (normalized)
// ---------------------------------------------------------------------------

export type RankDistribution = {
  pos_1: number
  pos_2_3: number
  pos_4_10: number
  pos_11_20: number
  pos_21_50: number
  pos_51_100: number
}

export type DomainRankSnapshot = {
  version: "1.0"
  capturedAt: string
  domain: string
  organic: {
    etv: number // estimated traffic volume
    rankedKeywords: number
    distribution: RankDistribution
    estimatedPaidTrafficCost: number
    newKeywords: number
    lostKeywords: number
    upKeywords: number
    downKeywords: number
    featuredSnippetCount: number
    localPackCount: number
  }
  paid: {
    etv: number
    rankedKeywords: number
    estimatedCost: number
  }
}

// ---------------------------------------------------------------------------
// Backlinks Summary (normalized)
// ---------------------------------------------------------------------------

export type NormalizedBacklinksSummary = {
  domain: string
  domainTrust: number // rank field, 0-1000
  backlinks: number
  referringDomains: number
  referringPages: number
  brokenBacklinks: number
  externalLinks: number
  referringMainDomains: number
  topTlds: Record<string, number>
  capturedAt: string
}

// ---------------------------------------------------------------------------
// Ranked Keywords (normalized)
// ---------------------------------------------------------------------------

export type NormalizedRankedKeyword = {
  keyword: string
  rank: number // rank_group or rank_absolute
  url: string | null
  searchVolume: number | null
  cpc: number | null
  competition: number | null
  competitionLevel: string | null
  serpFeatures: string[]
  isPaid: boolean
  intent: string | null // informational, commercial, navigational, transactional
  keywordDifficulty: number | null
}

// ---------------------------------------------------------------------------
// Keyword Candidates (for tracked keyword seeding)
// ---------------------------------------------------------------------------

export type NormalizedKeywordCandidate = {
  keyword: string
  searchVolume: number | null
  cpc: number | null
  competition: number | null
  competitionLevel: string | null
}

// ---------------------------------------------------------------------------
// SERP Rank Entry (per tracked keyword)
// ---------------------------------------------------------------------------

export type SerpRankEntry = {
  keyword: string
  positions: Record<string, number | null> // domain -> rank (null = not found)
  searchVolume: number | null
  serpFeatures: string[]
  fetchedAt: string
}

// ---------------------------------------------------------------------------
// Domain Intersection (normalized)
// ---------------------------------------------------------------------------

export type NormalizedIntersectionRow = {
  keyword: string
  searchVolume: number | null
  cpc: number | null
  competition: number | null
  domain1Rank: number | null
  domain2Rank: number | null
  gapType: "win" | "loss" | "shared" // win = you rank, they don't; loss = they rank, you don't
}

// ---------------------------------------------------------------------------
// Ad Creatives (normalized)
// ---------------------------------------------------------------------------

export type NormalizedAdCreative = {
  headline: string | null
  description: string | null
  displayUrl: string | null
  domain: string | null
  position: number | null
  keyword: string
  fetchedAt: string
}

// ---------------------------------------------------------------------------
// Organic Competitors (normalized from competitors_domain)
// ---------------------------------------------------------------------------

export type NormalizedOrganicCompetitor = {
  domain: string
  avgPosition: number
  intersections: number // keyword overlap count
  organicKeywords: number
  organicEtv: number
  paidKeywords: number
}

// ---------------------------------------------------------------------------
// Relevant Pages (normalized)
// ---------------------------------------------------------------------------

export type NormalizedRelevantPage = {
  url: string
  organicEtv: number
  organicKeywords: number
  trafficShare: number // percentage
}

// ---------------------------------------------------------------------------
// Subdomains (normalized)
// ---------------------------------------------------------------------------

export type NormalizedSubdomain = {
  subdomain: string
  organicEtv: number
  organicKeywords: number
  trafficShare: number // percentage
}

// ---------------------------------------------------------------------------
// Historical Rank (normalized monthly data points)
// ---------------------------------------------------------------------------

export type HistoricalTrafficPoint = {
  date: string // "YYYY-MM"
  organicEtv: number
  paidEtv: number
  organicKeywords: number
  paidKeywords: number
  organicCost: number
}

// ---------------------------------------------------------------------------
// SEO snapshot types (for snapshot_type column)
// ---------------------------------------------------------------------------

export const SEO_SNAPSHOT_TYPES = {
  domainRankOverview: "seo_domain_rank_overview_weekly",
  rankedKeywords: "seo_ranked_keywords_weekly",
  competitorsDomain: "seo_competitors_domain_weekly",
  domainIntersection: "seo_domain_intersection_weekly",
  serpKeyword: "seo_serp_keyword_weekly",
  adsSearch: "seo_ads_search_weekly",
  backlinksSummary: "seo_backlinks_summary_weekly",
  relevantPages: "seo_relevant_pages_weekly",
  subdomains: "seo_subdomains_weekly",
  historicalRank: "seo_historical_rank_weekly",
} as const

export type SeoSnapshotType = (typeof SEO_SNAPSHOT_TYPES)[keyof typeof SEO_SNAPSHOT_TYPES]
