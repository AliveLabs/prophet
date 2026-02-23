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
  NormalizedBacklinksSummary,
  NormalizedRelevantPage,
  HistoricalTrafficPoint,
} from "./types"

// Re-export types for external consumers
export type { NormalizedRankedKeyword, NormalizedRelevantPage, HistoricalTrafficPoint }

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

export type SeoInsightInput = {
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
  currentBacklinks?: NormalizedBacklinksSummary | null
  previousBacklinks?: NormalizedBacklinksSummary | null
  currentPages?: NormalizedRelevantPage[]
  previousPages?: NormalizedRelevantPage[]
  historicalTraffic?: HistoricalTrafficPoint[]
  // New: competitor-level enriched data (keyed by competitor ID)
  competitorRankedKeywords?: Map<string, NormalizedRankedKeyword[]>
  competitorRelevantPages?: Map<string, NormalizedRelevantPage[]>
  competitorHistoricalTraffic?: Map<string, HistoricalTrafficPoint[]>
  context: SeoInsightContext
}

export function generateSeoInsights(input: SeoInsightInput): GeneratedInsight[] {
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

  // Backlinks insights
  insights.push(
    ...detectBacklinkChanges(input.currentBacklinks ?? null, input.previousBacklinks ?? null, ctx)
  )

  // Top page traffic shift
  insights.push(
    ...detectTopPageTrafficShift(input.currentPages ?? [], input.previousPages ?? [], ctx)
  )

  // Historical traffic trend
  insights.push(
    ...detectHistoricalTrafficTrend(input.historicalTraffic ?? [], ctx)
  )

  // New: Competitor-specific enriched insights
  insights.push(
    ...detectCompetitorKeywordPortfolio(
      input.currentKeywords,
      input.competitorRankedKeywords ?? new Map(),
      ctx
    )
  )
  insights.push(
    ...detectCompetitorTopPageThreat(
      input.competitorRelevantPages ?? new Map(),
      ctx
    )
  )
  insights.push(
    ...detectCompetitorGrowthTrend(
      input.competitorHistoricalTraffic ?? new Map(),
      ctx
    )
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

// ---------------------------------------------------------------------------
// 8. seo_backlink_growth / seo_backlink_decline
// ---------------------------------------------------------------------------

const BACKLINK_DOMAIN_CHANGE_ABS = 5
const BACKLINK_DOMAIN_CHANGE_PCT = 0.1

function detectBacklinkChanges(
  current: NormalizedBacklinksSummary | null,
  previous: NormalizedBacklinksSummary | null,
  ctx: SeoInsightContext
): GeneratedInsight[] {
  if (!current || !previous) return []

  const refDomDelta = current.referringDomains - previous.referringDomains
  const refDomPct = previous.referringDomains > 0
    ? refDomDelta / previous.referringDomains
    : 0

  if (
    Math.abs(refDomDelta) < BACKLINK_DOMAIN_CHANGE_ABS ||
    Math.abs(refDomPct) < BACKLINK_DOMAIN_CHANGE_PCT
  ) {
    return []
  }

  const isGrowth = refDomDelta > 0

  return [
    {
      insight_type: isGrowth ? "seo_backlink_growth" : "seo_backlink_decline",
      title: isGrowth
        ? `${ctx.locationName} gained ${refDomDelta} referring domains`
        : `${ctx.locationName} lost ${Math.abs(refDomDelta)} referring domains`,
      summary: isGrowth
        ? `Referring domains increased from ${previous.referringDomains.toLocaleString()} to ${current.referringDomains.toLocaleString()} (+${Math.round(refDomPct * 100)}%). Total backlinks: ${current.backlinks.toLocaleString()}.`
        : `Referring domains dropped from ${previous.referringDomains.toLocaleString()} to ${current.referringDomains.toLocaleString()} (${Math.round(refDomPct * 100)}%). This may impact domain authority and rankings.`,
      confidence: Math.abs(refDomPct) >= 0.2 ? "high" : "medium",
      severity: isGrowth ? "info" : "warning",
      evidence: {
        domain: current.domain,
        previous_referring_domains: previous.referringDomains,
        current_referring_domains: current.referringDomains,
        delta: refDomDelta,
        pct_change: Number((refDomPct * 100).toFixed(1)),
        current_backlinks: current.backlinks,
        domain_trust: current.domainTrust,
      },
      recommendations: isGrowth
        ? [
            {
              title: "Identify which new sites are linking to you",
              rationale: `${refDomDelta} new referring domains suggest content is resonating or outreach is working. Understand which content attracts links and replicate the pattern.`,
            },
          ]
        : [
            {
              title: "Audit lost backlinks",
              rationale: `Losing ${Math.abs(refDomDelta)} referring domains can weaken domain authority. Use backlink monitoring to identify which links were lost and whether they can be recovered.`,
            },
          ],
    },
  ]
}

// ---------------------------------------------------------------------------
// 9. seo_top_page_traffic_shift
// ---------------------------------------------------------------------------

const TOP_PAGE_SHIFT_PCT = 0.15 // 15% traffic share shift

function detectTopPageTrafficShift(
  currentPages: NormalizedRelevantPage[],
  previousPages: NormalizedRelevantPage[],
  ctx: SeoInsightContext
): GeneratedInsight[] {
  if (currentPages.length === 0 || previousPages.length === 0) return []

  const prevMap = new Map(previousPages.map((p) => [p.url, p]))
  const insights: GeneratedInsight[] = []

  for (const page of currentPages.slice(0, 5)) {
    const prev = prevMap.get(page.url)
    if (!prev) continue

    const shareDelta = page.trafficShare - prev.trafficShare
    const etvDelta = page.organicEtv - prev.organicEtv

    if (Math.abs(shareDelta) >= TOP_PAGE_SHIFT_PCT * 100 && Math.abs(etvDelta) >= 50) {
      const isUp = shareDelta > 0
      insights.push({
        insight_type: "seo_top_page_traffic_shift",
        title: isUp
          ? `Traffic to "${page.url.split("/").pop() || page.url}" surged`
          : `Traffic to "${page.url.split("/").pop() || page.url}" dropped`,
        summary: isUp
          ? `This page's traffic share grew from ${prev.trafficShare}% to ${page.trafficShare}% (ETV: ${prev.organicEtv.toLocaleString()} → ${page.organicEtv.toLocaleString()}).`
          : `This page's traffic share fell from ${prev.trafficShare}% to ${page.trafficShare}% (ETV: ${prev.organicEtv.toLocaleString()} → ${page.organicEtv.toLocaleString()}). Check for content or technical issues.`,
        confidence: "medium",
        severity: isUp ? "info" : "warning",
        evidence: {
          page_url: page.url,
          previous_share: prev.trafficShare,
          current_share: page.trafficShare,
          previous_etv: prev.organicEtv,
          current_etv: page.organicEtv,
          location_name: ctx.locationName,
        },
        recommendations: [
          {
            title: isUp ? "Leverage this high-performing page" : "Investigate the traffic drop",
            rationale: isUp
              ? `This page is capturing more traffic. Add internal links to conversion pages and consider expanding the content.`
              : `A ${Math.abs(shareDelta).toFixed(1)}% traffic share drop may indicate ranking losses, content staleness, or cannibalizing pages.`,
          },
        ],
      })
    }
  }

  return insights.slice(0, 3)
}

// ---------------------------------------------------------------------------
// 10. seo_historical_traffic_trend
// ---------------------------------------------------------------------------

function detectHistoricalTrafficTrend(
  history: HistoricalTrafficPoint[],
  ctx: SeoInsightContext
): GeneratedInsight[] {
  if (history.length < 3) return []

  // Look at the last 3 months
  const recent = history.slice(-3)
  const isDecline = recent.every((p, i) => i === 0 || p.organicEtv < recent[i - 1].organicEtv)
  const isGrowth = recent.every((p, i) => i === 0 || p.organicEtv > recent[i - 1].organicEtv)

  if (!isDecline && !isGrowth) return []

  const first = recent[0]
  const last = recent[recent.length - 1]
  const delta = last.organicEtv - first.organicEtv
  const pct = first.organicEtv > 0 ? delta / first.organicEtv : 0

  if (Math.abs(delta) < 100) return [] // minimum absolute change

  return [
    {
      insight_type: "seo_historical_traffic_trend",
      title: isGrowth
        ? `${ctx.locationName} shows a 3-month organic growth trend`
        : `${ctx.locationName} has been declining for 3 months`,
      summary: isGrowth
        ? `Organic traffic has grown consistently over the last 3 months: ${first.organicEtv.toLocaleString()} → ${last.organicEtv.toLocaleString()} (+${Math.round(pct * 100)}%). This momentum is worth sustaining.`
        : `Organic traffic has declined for 3 consecutive months: ${first.organicEtv.toLocaleString()} → ${last.organicEtv.toLocaleString()} (${Math.round(pct * 100)}%). Investigate root causes before it compounds.`,
      confidence: "high",
      severity: isGrowth ? "info" : "critical",
      evidence: {
        trend: isGrowth ? "growth" : "decline",
        months: recent.map((p) => ({ date: p.date, etv: p.organicEtv })),
        total_delta: delta,
        pct_change: Number((pct * 100).toFixed(1)),
        location_name: ctx.locationName,
      },
      recommendations: isGrowth
        ? [
            {
              title: "Sustain the growth momentum",
              rationale: `3 consecutive months of growth indicates strong content performance. Continue publishing, build more backlinks, and optimize top-performing pages.`,
            },
          ]
        : [
            {
              title: "Conduct a comprehensive SEO audit",
              rationale: `A 3-month decline suggests systemic issues. Check for algorithm impacts, technical problems (crawl errors, page speed), lost backlinks, and content gaps. Prioritize recovering traffic on your top pages.`,
            },
          ],
    },
  ]
}

// ---------------------------------------------------------------------------
// 11. seo_competitor_keyword_portfolio — keywords competitors rank for that
//     you don't (using enriched competitor ranked-keywords data)
// ---------------------------------------------------------------------------

const COMP_KEYWORD_MIN_VOLUME = 100
const COMP_KEYWORD_MAX_RANK = 10

function detectCompetitorKeywordPortfolio(
  locationKeywords: NormalizedRankedKeyword[],
  competitorKeywordsMap: Map<string, NormalizedRankedKeyword[]>,
  ctx: SeoInsightContext
): GeneratedInsight[] {
  if (competitorKeywordsMap.size === 0) return []

  // Build a set of keywords the location already ranks for
  const locationKwSet = new Set(
    locationKeywords.map((k) => k.keyword.toLowerCase())
  )

  const insights: GeneratedInsight[] = []

  for (const comp of ctx.competitors) {
    const compKeywords = competitorKeywordsMap.get(comp.id)
    if (!compKeywords || compKeywords.length === 0) continue

    // Find high-value keywords where competitor ranks top 10 but location doesn't rank at all
    const gaps = compKeywords
      .filter(
        (k) =>
          k.rank <= COMP_KEYWORD_MAX_RANK &&
          (k.searchVolume ?? 0) >= COMP_KEYWORD_MIN_VOLUME &&
          !locationKwSet.has(k.keyword.toLowerCase())
      )
      .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0))
      .slice(0, 10)

    if (gaps.length === 0) continue

    const totalVolume = gaps.reduce((s, g) => s + (g.searchVolume ?? 0), 0)
    const compName = comp.name ?? comp.domain ?? "A competitor"

    insights.push({
      insight_type: "seo_competitor_keyword_portfolio",
      title: `${compName} ranks for ${gaps.length} keywords you're missing`,
      summary: `${compName} ranks in the top ${COMP_KEYWORD_MAX_RANK} for ${gaps.length} high-volume keywords (${totalVolume.toLocaleString()} combined monthly searches) that ${ctx.locationName} doesn't appear for. Top opportunity: "${gaps[0].keyword}" (${(gaps[0].searchVolume ?? 0).toLocaleString()} searches/mo, rank #${gaps[0].rank}).`,
      confidence: gaps.length >= 5 ? "high" : "medium",
      severity: gaps.length >= 5 ? "warning" : "info",
      evidence: {
        competitor_id: comp.id,
        competitor_name: compName,
        competitor_domain: comp.domain,
        gap_count: gaps.length,
        total_volume: totalVolume,
        top_gaps: gaps.slice(0, 5).map((g) => ({
          keyword: g.keyword,
          rank: g.rank,
          search_volume: g.searchVolume,
          cpc: g.cpc,
          intent: g.intent,
        })),
        location_name: ctx.locationName,
      },
      recommendations: [
        {
          title: `Create content targeting "${gaps[0].keyword}"`,
          rationale: `${compName} ranks #${gaps[0].rank} for this keyword with ${(gaps[0].searchVolume ?? 0).toLocaleString()} monthly searches${gaps[0].cpc ? ` and $${gaps[0].cpc.toFixed(2)} CPC` : ""}. Creating a well-optimized page could capture this traffic.`,
        },
        {
          title: `Build a content plan for the ${gaps.length} keyword gaps`,
          rationale: `These ${gaps.length} keywords represent ${totalVolume.toLocaleString()} monthly searches. Prioritize by search volume and commercial intent to maximize ROI.`,
        },
      ],
    })
  }

  return insights
}

// ---------------------------------------------------------------------------
// 12. seo_competitor_top_page_threat — competitor pages getting significant
//     organic traffic (using enriched competitor relevant pages data)
// ---------------------------------------------------------------------------

const COMP_PAGE_MIN_ETV = 100

function detectCompetitorTopPageThreat(
  competitorPagesMap: Map<string, NormalizedRelevantPage[]>,
  ctx: SeoInsightContext
): GeneratedInsight[] {
  if (competitorPagesMap.size === 0) return []

  const insights: GeneratedInsight[] = []

  for (const comp of ctx.competitors) {
    const compPages = competitorPagesMap.get(comp.id)
    if (!compPages || compPages.length === 0) continue

    const topPages = compPages
      .filter((p) => p.organicEtv >= COMP_PAGE_MIN_ETV)
      .sort((a, b) => b.organicEtv - a.organicEtv)
      .slice(0, 5)

    if (topPages.length === 0) continue

    const compName = comp.name ?? comp.domain ?? "A competitor"
    const totalEtv = topPages.reduce((s, p) => s + p.organicEtv, 0)

    insights.push({
      insight_type: "seo_competitor_top_page_threat",
      title: `${compName}'s top ${topPages.length} pages drive ${totalEtv.toLocaleString()} monthly visits`,
      summary: `${compName}'s highest-traffic pages are generating significant organic traffic. Their top page "${topPages[0].url.split("/").pop() || topPages[0].url}" alone drives ~${topPages[0].organicEtv.toLocaleString()} estimated visits/month with ${topPages[0].organicKeywords} ranking keywords.`,
      confidence: "medium",
      severity: "info",
      evidence: {
        competitor_id: comp.id,
        competitor_name: compName,
        competitor_domain: comp.domain,
        total_etv: totalEtv,
        top_pages: topPages.map((p) => ({
          url: p.url,
          organic_etv: p.organicEtv,
          organic_keywords: p.organicKeywords,
          traffic_share: p.trafficShare,
        })),
        location_name: ctx.locationName,
      },
      recommendations: [
        {
          title: `Analyze ${compName}'s top-performing page`,
          rationale: `Their page at "${topPages[0].url}" gets ~${topPages[0].organicEtv.toLocaleString()} visits/month. Study the content format, keywords targeted, and user experience to create a superior alternative.`,
        },
        {
          title: `Create competing content for their top topics`,
          rationale: `${compName}'s top ${topPages.length} pages together drive ${totalEtv.toLocaleString()} visits. Identify the topics they cover and create better, more comprehensive content to compete.`,
        },
      ],
    })
  }

  return insights
}

// ---------------------------------------------------------------------------
// 13. seo_competitor_growth_trend — detect 3-month consistent growth or
//     decline for each competitor (using enriched competitor historical data)
// ---------------------------------------------------------------------------

const COMP_GROWTH_PCT_THRESHOLD = 0.15 // 15% change over 3 months

function detectCompetitorGrowthTrend(
  competitorHistoryMap: Map<string, HistoricalTrafficPoint[]>,
  ctx: SeoInsightContext
): GeneratedInsight[] {
  if (competitorHistoryMap.size === 0) return []

  const insights: GeneratedInsight[] = []

  for (const comp of ctx.competitors) {
    const history = competitorHistoryMap.get(comp.id)
    if (!history || history.length < 3) continue

    const recent = history.slice(-3)
    const isDecline = recent.every((p, i) => i === 0 || p.organicEtv < recent[i - 1].organicEtv)
    const isGrowth = recent.every((p, i) => i === 0 || p.organicEtv > recent[i - 1].organicEtv)

    if (!isDecline && !isGrowth) continue

    const first = recent[0]
    const last = recent[recent.length - 1]
    const delta = last.organicEtv - first.organicEtv
    const pct = first.organicEtv > 0 ? delta / first.organicEtv : 0

    if (Math.abs(pct) < COMP_GROWTH_PCT_THRESHOLD) continue
    if (Math.abs(delta) < 50) continue // minimum absolute change

    const compName = comp.name ?? comp.domain ?? "A competitor"

    insights.push({
      insight_type: "seo_competitor_growth_trend",
      title: isGrowth
        ? `${compName}'s organic traffic grew ${Math.round(pct * 100)}% over 3 months`
        : `${compName}'s organic traffic declined ${Math.abs(Math.round(pct * 100))}% over 3 months`,
      summary: isGrowth
        ? `${compName}'s estimated organic traffic has grown consistently: ${first.organicEtv.toLocaleString()} → ${last.organicEtv.toLocaleString()} (+${Math.round(pct * 100)}%) over 3 months. This competitor is gaining momentum and may capture more of your shared audience.`
        : `${compName}'s organic traffic declined from ${first.organicEtv.toLocaleString()} to ${last.organicEtv.toLocaleString()} (${Math.round(pct * 100)}%) over 3 months. This may be an opportunity to capture their lost traffic.`,
      confidence: "high",
      severity: isGrowth ? "warning" : "info",
      evidence: {
        competitor_id: comp.id,
        competitor_name: compName,
        competitor_domain: comp.domain,
        trend: isGrowth ? "growth" : "decline",
        pct_change: Number((pct * 100).toFixed(1)),
        months: recent.map((p) => ({ date: p.date, etv: p.organicEtv })),
        total_delta: delta,
        location_name: ctx.locationName,
      },
      recommendations: isGrowth
        ? [
            {
              title: `Investigate what's driving ${compName}'s growth`,
              rationale: `With +${Math.round(pct * 100)}% organic growth over 3 months, ${compName} is doing something right. Analyze their new content, backlinks, and keyword strategy to identify what's working and adapt.`,
            },
            {
              title: `Accelerate your own content strategy`,
              rationale: `A growing competitor means increased competition for shared keywords. Prioritize publishing new content and improving existing pages to maintain your position.`,
            },
          ]
        : [
            {
              title: `Capitalize on ${compName}'s traffic decline`,
              rationale: `${compName}'s ${Math.abs(Math.round(pct * 100))}% traffic drop means less competition for shared keywords. Target their weakening positions with strong content to capture their lost traffic.`,
            },
          ],
    })
  }

  return insights
}
