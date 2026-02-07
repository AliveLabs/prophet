// ---------------------------------------------------------------------------
// Deterministic SEO insight rules (organic + paid)
// ---------------------------------------------------------------------------

import type { GeneratedInsight } from "@/lib/insights/types"
import type {
  DomainRankSnapshot,
  NormalizedRankedKeyword,
  SerpRankEntry,
  NormalizedIntersectionRow,
  NormalizedAdCreative,
} from "./types"

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const ETV_CHANGE_PCT = 0.1 // 10% change triggers visibility insight
const ETV_CHANGE_ABS = 50 // minimum absolute change
const KEYWORD_COUNT_CHANGE_ABS = 5
const RANK_BAND_TOP3 = 3
const RANK_BAND_TOP10 = 10
const RANK_BAND_TOP20 = 20
const INTERSECTION_SPIKE_ABS = 5

// ---------------------------------------------------------------------------
// Context type
// ---------------------------------------------------------------------------

export type SeoInsightContext = {
  locationName: string
  locationDomain: string | null
  competitors: Array<{
    id: string
    name: string | null
    domain: string | null
  }>
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function generateSeoInsights(input: {
  currentRank: DomainRankSnapshot | null
  previousRank: DomainRankSnapshot | null
  currentKeywords: NormalizedRankedKeyword[]
  previousKeywords: NormalizedRankedKeyword[]
  serpEntries: SerpRankEntry[]
  previousSerpEntries: SerpRankEntry[]
  intersectionRows: NormalizedIntersectionRow[]
  previousIntersectionRows: NormalizedIntersectionRow[]
  adCreatives: NormalizedAdCreative[]
  previousAdCreatives: NormalizedAdCreative[]
  context: SeoInsightContext
}): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  const ctx = input.context

  // Organic insights
  insights.push(
    ...detectOrganicVisibilityChange(input.currentRank, input.previousRank, ctx)
  )
  insights.push(
    ...detectKeywordOpportunityGap(input.intersectionRows, ctx)
  )
  insights.push(
    ...detectKeywordWins(input.serpEntries, input.previousSerpEntries, ctx)
  )
  insights.push(
    ...detectCompetitorOvertakes(input.serpEntries, input.previousSerpEntries, ctx)
  )

  // Paid insights
  insights.push(
    ...detectPaidVisibilityChange(input.currentRank, input.previousRank, ctx)
  )
  insights.push(
    ...detectNewCompetitorAds(input.adCreatives, input.previousAdCreatives, ctx)
  )
  insights.push(
    ...detectPaidOverlapSpike(input.intersectionRows, input.previousIntersectionRows, ctx)
  )

  return insights
}

// ---------------------------------------------------------------------------
// 1. seo_organic_visibility_up / seo_organic_visibility_down
// ---------------------------------------------------------------------------

function detectOrganicVisibilityChange(
  current: DomainRankSnapshot | null,
  previous: DomainRankSnapshot | null,
  ctx: SeoInsightContext
): GeneratedInsight[] {
  if (!current || !previous) return []

  const insights: GeneratedInsight[] = []
  const etvDelta = current.organic.etv - previous.organic.etv
  const kwDelta = current.organic.rankedKeywords - previous.organic.rankedKeywords
  const etvPct = previous.organic.etv > 0 ? etvDelta / previous.organic.etv : 0

  if (Math.abs(etvDelta) >= ETV_CHANGE_ABS && Math.abs(etvPct) >= ETV_CHANGE_PCT) {
    const isUp = etvDelta > 0
    insights.push({
      insight_type: isUp ? "seo_organic_visibility_up" : "seo_organic_visibility_down",
      title: isUp
        ? `${ctx.locationName}'s organic traffic is growing`
        : `${ctx.locationName}'s organic traffic declined`,
      summary: isUp
        ? `Estimated organic traffic for ${ctx.locationDomain ?? ctx.locationName} increased from ${previous.organic.etv.toLocaleString()} to ${current.organic.etv.toLocaleString()} (+${Math.round(etvPct * 100)}%). You now rank for ${current.organic.rankedKeywords} keywords.`
        : `Estimated organic traffic for ${ctx.locationDomain ?? ctx.locationName} dropped from ${previous.organic.etv.toLocaleString()} to ${current.organic.etv.toLocaleString()} (${Math.round(etvPct * 100)}%). Review which keywords lost visibility.`,
      confidence: Math.abs(etvPct) >= 0.2 ? "high" : "medium",
      severity: isUp ? "info" : "warning",
      evidence: {
        domain: current.domain,
        previous_etv: previous.organic.etv,
        current_etv: current.organic.etv,
        etv_delta: etvDelta,
        etv_pct_change: Number((etvPct * 100).toFixed(1)),
        previous_keywords: previous.organic.rankedKeywords,
        current_keywords: current.organic.rankedKeywords,
        keyword_delta: kwDelta,
        new_keywords: current.organic.newKeywords,
        lost_keywords: current.organic.lostKeywords,
      },
      recommendations: isUp
        ? [
            {
              title: `Double down on what's working for ${ctx.locationName}`,
              rationale: `With +${Math.round(etvPct * 100)}% organic traffic growth, identify which new keywords are driving visits and create content around related topics.`,
            },
          ]
        : [
            {
              title: `Audit recent changes to ${ctx.locationDomain ?? "your site"}`,
              rationale: `A ${Math.abs(Math.round(etvPct * 100))}% traffic drop suggests ranking losses. Check for technical issues, content changes, or algorithm updates that may have impacted visibility.`,
            },
          ],
    })
  }

  if (Math.abs(kwDelta) >= KEYWORD_COUNT_CHANGE_ABS && insights.length === 0) {
    const isUp = kwDelta > 0
    insights.push({
      insight_type: isUp ? "seo_organic_visibility_up" : "seo_organic_visibility_down",
      title: isUp
        ? `${ctx.locationName} ranks for ${kwDelta} more keywords`
        : `${ctx.locationName} lost rankings on ${Math.abs(kwDelta)} keywords`,
      summary: isUp
        ? `Your site now ranks for ${current.organic.rankedKeywords} keywords (up from ${previous.organic.rankedKeywords}).`
        : `Your site ranks for ${current.organic.rankedKeywords} keywords (down from ${previous.organic.rankedKeywords}).`,
      confidence: "medium",
      severity: isUp ? "info" : "warning",
      evidence: {
        domain: current.domain,
        previous_keywords: previous.organic.rankedKeywords,
        current_keywords: current.organic.rankedKeywords,
        keyword_delta: kwDelta,
      },
      recommendations: [
        {
          title: isUp ? "Expand on winning topics" : "Identify and recover lost keywords",
          rationale: isUp
            ? `${kwDelta} new keyword rankings indicate growing topical authority. Publish more content in these areas.`
            : `Review which ${Math.abs(kwDelta)} keywords dropped and prioritize refreshing that content.`,
        },
      ],
    })
  }

  return insights
}

// ---------------------------------------------------------------------------
// 2. seo_keyword_opportunity_gap
// ---------------------------------------------------------------------------

function detectKeywordOpportunityGap(
  rows: NormalizedIntersectionRow[],
  ctx: SeoInsightContext
): GeneratedInsight[] {
  // Keywords where competitor ranks and you don't (gapType = "loss")
  const gaps = rows
    .filter((r) => r.gapType === "loss" && (r.searchVolume ?? 0) > 0)
    .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0))
    .slice(0, 5)

  if (gaps.length === 0) return []

  const topKeywords = gaps.map((g) => g.keyword).join(", ")
  const totalVolume = gaps.reduce((s, g) => s + (g.searchVolume ?? 0), 0)

  return [
    {
      insight_type: "seo_keyword_opportunity_gap",
      title: `${gaps.length} keyword opportunities competitors are winning`,
      summary: `Competitors rank for "${gaps[0].keyword}" and ${gaps.length - 1} other high-volume keywords (${totalVolume.toLocaleString()} combined monthly searches) where ${ctx.locationName} doesn't appear.`,
      confidence: "high",
      severity: "warning",
      evidence: {
        gap_keywords: gaps.map((g) => ({
          keyword: g.keyword,
          search_volume: g.searchVolume,
          cpc: g.cpc,
          competitor_rank: g.domain2Rank,
        })),
        total_volume: totalVolume,
        location_name: ctx.locationName,
      },
      recommendations: [
        {
          title: `Create content targeting "${gaps[0].keyword}"`,
          rationale: `This keyword has ${(gaps[0].searchVolume ?? 0).toLocaleString()} monthly searches and ${gaps[0].cpc ? `$${gaps[0].cpc.toFixed(2)} CPC` : "commercial intent"}. A well-optimized page could capture this traffic from competitors.`,
        },
        {
          title: `Target the full keyword gap list`,
          rationale: `The top ${gaps.length} gap keywords represent ${totalVolume.toLocaleString()} monthly searches your competitors capture that you don't. Prioritize by volume and relevance.`,
        },
      ],
    },
  ]
}

// ---------------------------------------------------------------------------
// 3. seo_keyword_win
// ---------------------------------------------------------------------------

function detectKeywordWins(
  current: SerpRankEntry[],
  previous: SerpRankEntry[],
  ctx: SeoInsightContext
): GeneratedInsight[] {
  if (!ctx.locationDomain || current.length === 0 || previous.length === 0) return []

  const insights: GeneratedInsight[] = []
  const prevMap = new Map(previous.map((e) => [e.keyword, e]))

  for (const entry of current) {
    const prev = prevMap.get(entry.keyword)
    if (!prev) continue

    const curRank = entry.positions[ctx.locationDomain] ?? null
    const prevRank = prev.positions[ctx.locationDomain] ?? null

    if (curRank === null || prevRank === null) continue

    // Crossed into Top 3
    if (curRank <= RANK_BAND_TOP3 && prevRank > RANK_BAND_TOP3) {
      insights.push({
        insight_type: "seo_keyword_win",
        title: `"${entry.keyword}" reached Top 3`,
        summary: `${ctx.locationName} climbed from position ${prevRank} to ${curRank} for "${entry.keyword}". Top 3 positions capture the majority of clicks.`,
        confidence: "high",
        severity: "info",
        evidence: {
          keyword: entry.keyword,
          previous_rank: prevRank,
          current_rank: curRank,
          domain: ctx.locationDomain,
          location_name: ctx.locationName,
        },
        recommendations: [
          {
            title: `Strengthen "${entry.keyword}" content`,
            rationale: `You've reached position ${curRank} for this keyword. Add internal links, update content freshness, and monitor competitor moves to maintain this position.`,
          },
        ],
      })
    }
    // Crossed into Top 10
    else if (curRank <= RANK_BAND_TOP10 && prevRank > RANK_BAND_TOP10) {
      insights.push({
        insight_type: "seo_keyword_win",
        title: `"${entry.keyword}" entered page 1`,
        summary: `${ctx.locationName} moved from position ${prevRank} to ${curRank} for "${entry.keyword}", now appearing on the first page of results.`,
        confidence: "medium",
        severity: "info",
        evidence: {
          keyword: entry.keyword,
          previous_rank: prevRank,
          current_rank: curRank,
          domain: ctx.locationDomain,
        },
        recommendations: [
          {
            title: `Push "${entry.keyword}" into Top 3`,
            rationale: `Page 1 visibility is a strong foundation. Optimize meta titles, add schema markup, and build topical authority to climb further.`,
          },
        ],
      })
    }
  }

  return insights.slice(0, 5) // cap to avoid flooding
}

// ---------------------------------------------------------------------------
// 4. seo_competitor_overtake
// ---------------------------------------------------------------------------

function detectCompetitorOvertakes(
  current: SerpRankEntry[],
  previous: SerpRankEntry[],
  ctx: SeoInsightContext
): GeneratedInsight[] {
  if (!ctx.locationDomain || current.length === 0 || previous.length === 0) return []

  const insights: GeneratedInsight[] = []
  const prevMap = new Map(previous.map((e) => [e.keyword, e]))

  for (const entry of current) {
    const prev = prevMap.get(entry.keyword)
    if (!prev) continue

    const myRank = entry.positions[ctx.locationDomain]
    const myPrevRank = prev.positions[ctx.locationDomain]
    if (myRank === null || myRank === undefined) continue

    for (const comp of ctx.competitors) {
      if (!comp.domain) continue
      const compRank = entry.positions[comp.domain]
      const compPrevRank = prev.positions[comp.domain]

      // Competitor overtook us (they were behind, now ahead)
      if (
        compRank !== null && compRank !== undefined &&
        compPrevRank !== null && compPrevRank !== undefined &&
        myPrevRank !== null && myPrevRank !== undefined &&
        compPrevRank > myPrevRank &&
        compRank < myRank &&
        compRank <= RANK_BAND_TOP20
      ) {
        insights.push({
          insight_type: "seo_competitor_overtake",
          title: `${comp.name ?? comp.domain} overtook you on "${entry.keyword}"`,
          summary: `${comp.name ?? comp.domain} moved from position ${compPrevRank} to ${compRank} on "${entry.keyword}", passing ${ctx.locationName} (now at position ${myRank}).`,
          confidence: "high",
          severity: "warning",
          evidence: {
            keyword: entry.keyword,
            competitor_name: comp.name,
            competitor_domain: comp.domain,
            competitor_previous_rank: compPrevRank,
            competitor_current_rank: compRank,
            your_previous_rank: myPrevRank,
            your_current_rank: myRank,
            location_name: ctx.locationName,
          },
          recommendations: [
            {
              title: `Analyze ${comp.name ?? comp.domain}'s content for "${entry.keyword}"`,
              rationale: `They moved from #${compPrevRank} to #${compRank}. Check what content or backlink changes they made and respond with improved content, better on-page optimization, or fresh updates.`,
            },
          ],
        })
      }
    }
  }

  return insights.slice(0, 5)
}

// ---------------------------------------------------------------------------
// 5. seo_paid_visibility_change
// ---------------------------------------------------------------------------

function detectPaidVisibilityChange(
  current: DomainRankSnapshot | null,
  previous: DomainRankSnapshot | null,
  ctx: SeoInsightContext
): GeneratedInsight[] {
  if (!current || !previous) return []
  if (current.paid.etv === 0 && previous.paid.etv === 0) return []

  const delta = current.paid.etv - previous.paid.etv
  const pct = previous.paid.etv > 0 ? delta / previous.paid.etv : 0

  if (Math.abs(delta) < ETV_CHANGE_ABS || Math.abs(pct) < ETV_CHANGE_PCT) return []

  const isUp = delta > 0
  return [
    {
      insight_type: "seo_paid_visibility_change",
      title: isUp
        ? `${ctx.locationName}'s paid visibility increased`
        : `${ctx.locationName}'s paid visibility decreased`,
      summary: `Estimated paid traffic ${isUp ? "grew" : "fell"} from ${previous.paid.etv.toLocaleString()} to ${current.paid.etv.toLocaleString()} (${isUp ? "+" : ""}${Math.round(pct * 100)}%). Paid keyword count: ${current.paid.rankedKeywords}.`,
      confidence: "medium",
      severity: isUp ? "info" : "warning",
      evidence: {
        domain: current.domain,
        previous_paid_etv: previous.paid.etv,
        current_paid_etv: current.paid.etv,
        delta,
        pct_change: Number((pct * 100).toFixed(1)),
        previous_paid_keywords: previous.paid.rankedKeywords,
        current_paid_keywords: current.paid.rankedKeywords,
      },
      recommendations: [
        {
          title: isUp
            ? "Monitor paid ROI"
            : `Review ${ctx.locationDomain ?? "your"} ad campaigns`,
          rationale: isUp
            ? `Increasing paid visibility means higher ad spend. Ensure conversions justify the investment.`
            : `A drop in paid visibility may indicate budget changes, paused campaigns, or increased competition for ad placements.`,
        },
      ],
    },
  ]
}

// ---------------------------------------------------------------------------
// 6. seo_new_competitor_ads_detected
// ---------------------------------------------------------------------------

function detectNewCompetitorAds(
  current: NormalizedAdCreative[],
  previous: NormalizedAdCreative[],
  ctx: SeoInsightContext
): GeneratedInsight[] {
  if (current.length === 0) return []

  // Detect new competitor domains appearing in ads
  const prevDomains = new Set(previous.map((a) => a.domain).filter(Boolean))
  const compDomains = new Set(ctx.competitors.map((c) => c.domain).filter(Boolean))

  const newAds = current.filter(
    (a) => a.domain && compDomains.has(a.domain) && !prevDomains.has(a.domain)
  )

  if (newAds.length === 0) return []

  const uniqueDomains = [...new Set(newAds.map((a) => a.domain))].slice(0, 3)
  const sampleHeadlines = newAds
    .map((a) => a.headline)
    .filter(Boolean)
    .slice(0, 3)

  return [
    {
      insight_type: "seo_new_competitor_ads_detected",
      title: `${uniqueDomains.length} competitor(s) running new ads`,
      summary: `New ads detected from ${uniqueDomains.join(", ")} targeting keywords in your space. Sample headlines: ${sampleHeadlines.map((h) => `"${h}"`).join(", ") || "N/A"}.`,
      confidence: "medium",
      severity: "info",
      evidence: {
        new_advertiser_domains: uniqueDomains,
        sample_ads: newAds.slice(0, 5).map((a) => ({
          domain: a.domain,
          headline: a.headline,
          description: a.description,
          keyword: a.keyword,
        })),
        location_name: ctx.locationName,
      },
      recommendations: [
        {
          title: "Review competitor ad messaging",
          rationale: `${uniqueDomains[0]} is now advertising on keywords relevant to ${ctx.locationName}. Analyze their messaging for differentiation opportunities.`,
        },
      ],
    },
  ]
}

// ---------------------------------------------------------------------------
// 7. seo_paid_keyword_overlap_spike
// ---------------------------------------------------------------------------

function detectPaidOverlapSpike(
  current: NormalizedIntersectionRow[],
  previous: NormalizedIntersectionRow[],
  ctx: SeoInsightContext
): GeneratedInsight[] {
  // Count paid-related overlap rows
  const currentPaidOverlap = current.filter(
    (r) => r.gapType === "shared" && r.domain1Rank !== null && r.domain2Rank !== null
  ).length
  const previousPaidOverlap = previous.filter(
    (r) => r.gapType === "shared" && r.domain1Rank !== null && r.domain2Rank !== null
  ).length

  const delta = currentPaidOverlap - previousPaidOverlap

  if (delta < INTERSECTION_SPIKE_ABS) return []

  return [
    {
      insight_type: "seo_paid_keyword_overlap_spike",
      title: `Keyword competition overlap increased by ${delta}`,
      summary: `You now share ${currentPaidOverlap} keywords with competitors (up from ${previousPaidOverlap}). This means more head-to-head competition for visibility around ${ctx.locationName}.`,
      confidence: "medium",
      severity: "warning",
      evidence: {
        current_overlap: currentPaidOverlap,
        previous_overlap: previousPaidOverlap,
        delta,
        location_name: ctx.locationName,
      },
      recommendations: [
        {
          title: "Differentiate your keyword strategy",
          rationale: `With ${delta} more overlapping keywords, competition is intensifying. Consider targeting long-tail variations or local modifiers to reduce direct competition.`,
        },
      ],
    },
  ]
}
