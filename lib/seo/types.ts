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
    newKeywords: number
    lostKeywords: number
    upKeywords: number
    downKeywords: number
  }
  paid: {
    etv: number
    rankedKeywords: number
    estimatedCost: number
  }
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
// SEO snapshot types (for snapshot_type column)
// ---------------------------------------------------------------------------

export const SEO_SNAPSHOT_TYPES = {
  domainRankOverview: "seo_domain_rank_overview_weekly",
  rankedKeywords: "seo_ranked_keywords_weekly",
  competitorsDomain: "seo_competitors_domain_weekly",
  domainIntersection: "seo_domain_intersection_weekly",
  serpKeyword: "seo_serp_keyword_weekly",
  adsSearch: "seo_ads_search_weekly",
} as const

export type SeoSnapshotType = (typeof SEO_SNAPSHOT_TYPES)[keyof typeof SEO_SNAPSHOT_TYPES]
