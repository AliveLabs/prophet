// ---------------------------------------------------------------------------
// Visual Intelligence Insight Rules for Social Media
//
// 12 deterministic rules that compare visual analysis data between
// a location and its competitors. Each rule follows the GeneratedInsight
// pattern from lib/insights/types.ts.
//
// Categories:
//   Content Strategy (5): quality gap/win, content mix, food photography, professional content
//   Competitive Intelligence (4): promo blitz, crowd perception, brand consistency, UGC
//   Opportunity (3): video content, seasonal content, behind-the-scenes
// ---------------------------------------------------------------------------

import type { GeneratedInsight } from "@/lib/insights/types"
import type { EntityVisualProfile, SocialPostAnalysis } from "./types"

export function generateVisualInsights(
  locationProfiles: EntityVisualProfile[],
  competitorProfiles: EntityVisualProfile[]
): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []

  for (const loc of locationProfiles) {
    const platformComps = competitorProfiles.filter(
      (c) => c.platform === loc.platform
    )

    // Location-only visual rules (always fire)
    insights.push(
      ...checkBrandConsistencyLow(loc),
      ...checkVisualQualitySelfAssessment(loc),
      ...checkContentMixSelfAnalysis(loc),
      ...checkFoodPhotographySelfAssessment(loc),
      ...checkVisualEngagementCorrelation(loc),
    )

    // Comparative visual rules (require competitor data)
    if (platformComps.length > 0) {
      insights.push(
        ...checkVisualQualityGap(loc, platformComps),
        ...checkVisualQualityWin(loc, platformComps),
        ...checkContentMixImbalance(loc, platformComps),
        ...checkFoodPhotographyGap(loc, platformComps),
        ...checkProfessionalContentGap(loc, platformComps),
        ...checkCrowdPerceptionGap(loc, platformComps),
      )
    }
  }

  for (const comp of competitorProfiles) {
    insights.push(
      ...checkCompetitorPromoBlitz(comp),
      ...checkUgcDominance(comp, locationProfiles),
      ...checkVideoContentOpportunity(comp),
      ...checkSeasonalContentGap(comp, locationProfiles),
      ...checkBehindScenesOpportunity(comp, locationProfiles),
    )
  }

  return insights
}

// ---------------------------------------------------------------------------
// Rule 1: Visual quality gap (competitor > 30 pts higher)
// ---------------------------------------------------------------------------

function checkVisualQualityGap(
  loc: EntityVisualProfile,
  comps: EntityVisualProfile[]
): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []

  for (const comp of comps) {
    const gap = comp.avgVisualQualityScore - loc.avgVisualQualityScore
    if (gap >= 30) {
      insights.push({
        insight_type: "social.visual_quality_gap",
        title: `${comp.entityName}'s ${platformLabel(comp.platform)} photos are significantly higher quality`,
        summary: `${comp.entityName} has a visual quality score of ${comp.avgVisualQualityScore} vs your ${loc.avgVisualQualityScore} on ${platformLabel(loc.platform)}. Higher-quality visuals drive more engagement and brand perception.`,
        confidence: "high",
        severity: "warning",
        evidence: {
          competitor: comp.entityName,
          competitorScore: comp.avgVisualQualityScore,
          yourScore: loc.avgVisualQualityScore,
          gap,
          platform: loc.platform,
        },
        recommendations: [
          {
            title: "Invest in better photography for social posts",
            rationale: "Professional-looking photos get 2-3x more engagement on average. Consider better lighting, composition, or hiring a photographer for key content.",
          },
        ],
      })
    }
  }

  return insights
}

// ---------------------------------------------------------------------------
// Rule 2: Visual quality win (you > 30 pts higher)
// ---------------------------------------------------------------------------

function checkVisualQualityWin(
  loc: EntityVisualProfile,
  comps: EntityVisualProfile[]
): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []

  for (const comp of comps) {
    const gap = loc.avgVisualQualityScore - comp.avgVisualQualityScore
    if (gap >= 30) {
      insights.push({
        insight_type: "social.visual_quality_win",
        title: `Your ${platformLabel(loc.platform)} visual quality leads ${comp.entityName}`,
        summary: `Your visual quality score (${loc.avgVisualQualityScore}) is ${gap} points higher than ${comp.entityName}'s (${comp.avgVisualQualityScore}) on ${platformLabel(loc.platform)}. This is a competitive advantage — maintain it.`,
        confidence: "high",
        severity: "info",
        evidence: {
          competitor: comp.entityName,
          yourScore: loc.avgVisualQualityScore,
          competitorScore: comp.avgVisualQualityScore,
          gap,
          platform: loc.platform,
        },
        recommendations: [],
      })
      break
    }
  }

  return insights
}

// ---------------------------------------------------------------------------
// Rule 3: Content mix imbalance (>70% one category while competitor diversified)
// ---------------------------------------------------------------------------

function checkContentMixImbalance(
  loc: EntityVisualProfile,
  comps: EntityVisualProfile[]
): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []

  const locTopCategory = getTopCategory(loc.contentMix)
  if (!locTopCategory || locTopCategory.pct < 70) return insights

  for (const comp of comps) {
    const compTop = getTopCategory(comp.contentMix)
    if (!compTop || compTop.pct > 50) continue

    const compCategories = Object.keys(comp.contentMix).filter(
      (k) => comp.contentMix[k] >= 10
    ).length

    if (compCategories >= 3) {
      insights.push({
        insight_type: "social.content_mix_imbalance",
        title: `Your ${platformLabel(loc.platform)} content is too focused on ${formatCategory(locTopCategory.category)}`,
        summary: `${Math.round(locTopCategory.pct)}% of your posts are ${formatCategory(locTopCategory.category)}, while ${comp.entityName} diversifies across ${compCategories} content types. A varied content mix keeps audiences engaged.`,
        confidence: "medium",
        severity: "warning",
        evidence: {
          yourTopCategory: locTopCategory.category,
          yourTopPct: locTopCategory.pct,
          competitor: comp.entityName,
          competitorCategories: compCategories,
          competitorContentMix: comp.contentMix,
          platform: loc.platform,
        },
        recommendations: [
          {
            title: "Diversify your content types",
            rationale: `Try adding behind-the-scenes, staff, or event content to complement your ${formatCategory(locTopCategory.category)} posts.`,
          },
        ],
      })
      break
    }
  }

  return insights
}

// ---------------------------------------------------------------------------
// Rule 4: Food photography gap (competitor > 30 pts higher)
// ---------------------------------------------------------------------------

function checkFoodPhotographyGap(
  loc: EntityVisualProfile,
  comps: EntityVisualProfile[]
): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  if (loc.foodPresentationScore === 0) return insights

  for (const comp of comps) {
    if (comp.foodPresentationScore === 0) continue
    const gap = comp.foodPresentationScore - loc.foodPresentationScore
    if (gap >= 30) {
      insights.push({
        insight_type: "social.food_photography_gap",
        title: `${comp.entityName}'s food photos look significantly better on ${platformLabel(loc.platform)}`,
        summary: `${comp.entityName}'s food presentation score is ${comp.foodPresentationScore} vs your ${loc.foodPresentationScore}. Better food photography directly impacts perceived quality and customer appetite appeal.`,
        confidence: "high",
        severity: "warning",
        evidence: {
          competitor: comp.entityName,
          competitorScore: comp.foodPresentationScore,
          yourScore: loc.foodPresentationScore,
          gap,
          platform: loc.platform,
        },
        recommendations: [
          {
            title: "Improve food styling and photography",
            rationale: "Use natural lighting, clean plating, and appealing backgrounds. Food posts with professional styling get 40% more engagement.",
          },
        ],
      })
    }
  }

  return insights
}

// ---------------------------------------------------------------------------
// Rule 5: Professional content gap (competitor > 2x)
// ---------------------------------------------------------------------------

function checkProfessionalContentGap(
  loc: EntityVisualProfile,
  comps: EntityVisualProfile[]
): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []

  for (const comp of comps) {
    if (comp.professionalContentPct <= 0) continue
    if (
      comp.professionalContentPct >= (loc.professionalContentPct || 1) * 2 &&
      comp.professionalContentPct >= 30
    ) {
      insights.push({
        insight_type: "social.professional_content_gap",
        title: `${comp.entityName} has ${comp.professionalContentPct}% professional-quality content on ${platformLabel(loc.platform)}`,
        summary: `${comp.professionalContentPct}% of ${comp.entityName}'s posts have professional-quality visuals, compared to your ${loc.professionalContentPct}%. Professional content builds brand credibility.`,
        confidence: "medium",
        severity: "warning",
        evidence: {
          competitor: comp.entityName,
          competitorPct: comp.professionalContentPct,
          yourPct: loc.professionalContentPct,
          platform: loc.platform,
        },
        recommendations: [
          {
            title: "Schedule regular professional photo sessions",
            rationale: "Even a monthly shoot can provide weeks of high-quality content that outperforms phone photos.",
          },
        ],
      })
      break
    }
  }

  return insights
}

// ---------------------------------------------------------------------------
// Rule 6: Competitor promo blitz (>30% promotional content)
// ---------------------------------------------------------------------------

function checkCompetitorPromoBlitz(comp: EntityVisualProfile): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []

  if (comp.promotionalContentPct >= 30) {
    insights.push({
      insight_type: "social.competitor_promo_blitz",
      title: `${comp.entityName} is running a heavy promotion campaign on ${platformLabel(comp.platform)}`,
      summary: `${comp.promotionalContentPct}% of ${comp.entityName}'s recent posts on ${platformLabel(comp.platform)} are promotional. They may be running deals, events, or seasonal offers to drive traffic.`,
      confidence: "high",
      severity: "warning",
      evidence: {
        competitor: comp.entityName,
        promotionalPct: comp.promotionalContentPct,
        platform: comp.platform,
        topPromos: comp.postAnalyses
          .filter((a) => a.analysis.promotionalContent)
          .slice(0, 3)
          .map((a) => a.analysis.promotionalDetails)
          .filter(Boolean),
      },
      recommendations: [
        {
          title: "Consider a counter-promotion or unique value offer",
          rationale: "When competitors promote heavily, maintaining visibility with your own offers or highlighting unique value prevents customer attrition.",
        },
      ],
    })
  }

  return insights
}

// ---------------------------------------------------------------------------
// Rule 7: Crowd perception gap (competitor > 40 pts higher)
// ---------------------------------------------------------------------------

function checkCrowdPerceptionGap(
  loc: EntityVisualProfile,
  comps: EntityVisualProfile[]
): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  if (loc.crowdSignalScore === 0) return insights

  for (const comp of comps) {
    if (comp.crowdSignalScore === 0) continue
    const gap = comp.crowdSignalScore - loc.crowdSignalScore
    if (gap >= 40) {
      insights.push({
        insight_type: "social.crowd_perception_gap",
        title: `${comp.entityName} looks much busier in their ${platformLabel(loc.platform)} photos`,
        summary: `${comp.entityName}'s social posts show a crowd/atmosphere score of ${comp.crowdSignalScore} vs your ${loc.crowdSignalScore}. Customers perceive busy restaurants as better — even if you're equally busy, your photos should show it.`,
        confidence: "medium",
        severity: "warning",
        evidence: {
          competitor: comp.entityName,
          competitorCrowdScore: comp.crowdSignalScore,
          yourCrowdScore: loc.crowdSignalScore,
          gap,
          platform: loc.platform,
        },
        recommendations: [
          {
            title: "Photograph during peak hours to showcase energy",
            rationale: "Posts showing a busy atmosphere signal popularity and create FOMO. Time your photos during peak service.",
          },
        ],
      })
    }
  }

  return insights
}

// ---------------------------------------------------------------------------
// Rule 8: Brand consistency low (<40)
// ---------------------------------------------------------------------------

function checkBrandConsistencyLow(loc: EntityVisualProfile): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []

  if (loc.brandConsistencyScore < 40 && loc.postAnalyses.length >= 5) {
    insights.push({
      insight_type: "social.brand_consistency_low",
      title: `Your ${platformLabel(loc.platform)} visual brand is inconsistent`,
      summary: `Your brand consistency score is ${loc.brandConsistencyScore}/100 on ${platformLabel(loc.platform)}. Inconsistent visual branding makes your profile look unprofessional and harder to recognize in feeds.`,
      confidence: "medium",
      severity: "warning",
      evidence: {
        brandConsistencyScore: loc.brandConsistencyScore,
        postCount: loc.postAnalyses.length,
        platform: loc.platform,
      },
      recommendations: [
        {
          title: "Create visual brand guidelines for social content",
          rationale: "Consistent colors, filters, and style make your content instantly recognizable and build brand equity.",
        },
      ],
    })
  }

  return insights
}

// ---------------------------------------------------------------------------
// Rule 9: UGC dominance (competitor > 3x customer_ugc posts)
// ---------------------------------------------------------------------------

function checkUgcDominance(
  comp: EntityVisualProfile,
  locProfiles: EntityVisualProfile[]
): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []

  const compUgc = comp.contentMix["customer_ugc"] ?? 0
  if (compUgc < 15) return insights

  const locOnPlatform = locProfiles.find((l) => l.platform === comp.platform)
  if (!locOnPlatform) return insights

  const locUgc = locOnPlatform.contentMix["customer_ugc"] ?? 0
  if (compUgc >= (locUgc || 1) * 3 && compUgc >= 20) {
    insights.push({
      insight_type: "social.ugc_dominance",
      title: `${comp.entityName} features much more customer content on ${platformLabel(comp.platform)}`,
      summary: `${compUgc}% of ${comp.entityName}'s posts are customer/UGC content vs your ${locUgc}%. User-generated content builds trust and community engagement.`,
      confidence: "medium",
      severity: "info",
      evidence: {
        competitor: comp.entityName,
        competitorUgcPct: compUgc,
        yourUgcPct: locUgc,
        platform: comp.platform,
      },
      recommendations: [
        {
          title: "Encourage and repost customer content",
          rationale: "Create a branded hashtag, feature customer photos in stories, and encourage tagging for organic UGC.",
        },
      ],
    })
  }

  return insights
}

// ---------------------------------------------------------------------------
// Rule 10: Video content opportunity (video engagement > 3x image engagement)
// ---------------------------------------------------------------------------

function checkVideoContentOpportunity(comp: EntityVisualProfile): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []

  const videoAnalyses = comp.postAnalyses.filter((a) =>
    ["event_live", "behind_the_scenes"].includes(a.analysis.contentCategory) ||
    a.analysis.tags.some((t) => /video|reel|clip/i.test(t))
  )
  const imageAnalyses = comp.postAnalyses.filter(
    (a) => !videoAnalyses.includes(a)
  )

  if (videoAnalyses.length < 3 || imageAnalyses.length < 3) return insights

  const avgVideoEng =
    videoAnalyses.reduce((s, a) => s + a.engagement, 0) / videoAnalyses.length
  const avgImageEng =
    imageAnalyses.reduce((s, a) => s + a.engagement, 0) / imageAnalyses.length

  if (avgVideoEng >= avgImageEng * 3 && avgVideoEng >= 50) {
    insights.push({
      insight_type: "social.video_content_opportunity",
      title: `Video content gets ${Math.round(avgVideoEng / avgImageEng)}x more engagement for ${comp.entityName}`,
      summary: `${comp.entityName}'s video/reel content on ${platformLabel(comp.platform)} averages ${formatNumber(Math.round(avgVideoEng))} engagements vs ${formatNumber(Math.round(avgImageEng))} for images. Video is dominating this market.`,
      confidence: "medium",
      severity: "info",
      evidence: {
        competitor: comp.entityName,
        avgVideoEngagement: avgVideoEng,
        avgImageEngagement: avgImageEng,
        videoPostCount: videoAnalyses.length,
        platform: comp.platform,
      },
      recommendations: [
        {
          title: "Start creating short-form video content (reels, stories)",
          rationale: "Video content is getting significantly more engagement in your market. Even simple behind-the-scenes clips can perform well.",
        },
      ],
    })
  }

  return insights
}

// ---------------------------------------------------------------------------
// Rule 11: Seasonal content gap
// ---------------------------------------------------------------------------

function checkSeasonalContentGap(
  comp: EntityVisualProfile,
  locProfiles: EntityVisualProfile[]
): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []

  const compSeasonal = comp.contentMix["seasonal_holiday"] ?? 0
  if (compSeasonal < 10) return insights

  const locOnPlatform = locProfiles.find((l) => l.platform === comp.platform)
  if (!locOnPlatform) return insights

  const locSeasonal = locOnPlatform.contentMix["seasonal_holiday"] ?? 0
  if (compSeasonal >= 10 && locSeasonal < 5) {
    insights.push({
      insight_type: "social.seasonal_content_gap",
      title: `${comp.entityName} is posting seasonal content on ${platformLabel(comp.platform)} and you're not`,
      summary: `${compSeasonal}% of ${comp.entityName}'s posts are seasonal/holiday themed, while you have ${locSeasonal}%. Seasonal content drives higher engagement and shows relevance.`,
      confidence: "medium",
      severity: "info",
      evidence: {
        competitor: comp.entityName,
        competitorSeasonalPct: compSeasonal,
        yourSeasonalPct: locSeasonal,
        platform: comp.platform,
      },
      recommendations: [
        {
          title: "Create seasonal and holiday-themed content",
          rationale: "Seasonal posts tap into trending topics and holidays, getting boosted by platform algorithms.",
        },
      ],
    })
  }

  return insights
}

// ---------------------------------------------------------------------------
// Rule 12: Behind-the-scenes opportunity
// ---------------------------------------------------------------------------

function checkBehindScenesOpportunity(
  comp: EntityVisualProfile,
  locProfiles: EntityVisualProfile[]
): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []

  const compBts = comp.contentMix["behind_the_scenes"] ?? 0
  if (compBts < 10) return insights

  const btsPosts = comp.postAnalyses.filter(
    (a) => a.analysis.contentCategory === "behind_the_scenes"
  )
  if (btsPosts.length < 2) return insights

  const avgBtsEngagement =
    btsPosts.reduce((s, a) => s + a.engagement, 0) / btsPosts.length
  const avgOverall =
    comp.postAnalyses.reduce((s, a) => s + a.engagement, 0) / comp.postAnalyses.length

  if (avgBtsEngagement < avgOverall * 1.2) return insights

  const locOnPlatform = locProfiles.find((l) => l.platform === comp.platform)
  const locBts = locOnPlatform?.contentMix["behind_the_scenes"] ?? 0

  if (locBts < 5) {
    insights.push({
      insight_type: "social.behind_scenes_opportunity",
      title: `Behind-the-scenes content is working well for ${comp.entityName}`,
      summary: `${comp.entityName}'s behind-the-scenes posts on ${platformLabel(comp.platform)} get ${Math.round((avgBtsEngagement / avgOverall) * 100)}% of their average engagement, and you have almost none. This content type builds authenticity.`,
      confidence: "medium",
      severity: "info",
      evidence: {
        competitor: comp.entityName,
        competitorBtsPct: compBts,
        avgBtsEngagement: Math.round(avgBtsEngagement),
        avgOverallEngagement: Math.round(avgOverall),
        platform: comp.platform,
      },
      recommendations: [
        {
          title: "Share kitchen prep, staff stories, or daily routines",
          rationale: "Behind-the-scenes content humanizes your brand and builds emotional connections with followers.",
        },
      ],
    })
  }

  return insights
}

// ---------------------------------------------------------------------------
// Rule 13: Visual quality self-assessment (location-only)
// ---------------------------------------------------------------------------

function checkVisualQualitySelfAssessment(loc: EntityVisualProfile): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  if (loc.postAnalyses.length < 3) return insights

  const score = loc.avgVisualQualityScore
  if (score >= 75) {
    insights.push({
      insight_type: "social.visual_quality_strong",
      title: `Strong visual quality on ${platformLabel(loc.platform)} (${score}/100)`,
      summary: `Your ${platformLabel(loc.platform)} visual quality score is ${score}/100 across ${loc.postAnalyses.length} analyzed posts. High-quality visuals drive more engagement and build brand perception.`,
      confidence: "high",
      severity: "info",
      evidence: {
        qualityScore: score,
        postsAnalyzed: loc.postAnalyses.length,
        platform: loc.platform,
      },
      recommendations: [
        {
          title: "Maintain this quality standard across all posts",
          rationale: "Consistency in visual quality builds brand recognition. Use these posts as benchmarks for future content.",
        },
      ],
    })
  } else if (score < 45) {
    insights.push({
      insight_type: "social.visual_quality_needs_work",
      title: `Your ${platformLabel(loc.platform)} photo quality needs improvement (${score}/100)`,
      summary: `Your visual quality score is ${score}/100 on ${platformLabel(loc.platform)}. Posts with higher visual quality get 2-3x more engagement. Consider better lighting, composition, and editing.`,
      confidence: "high",
      severity: "warning",
      evidence: {
        qualityScore: score,
        postsAnalyzed: loc.postAnalyses.length,
        platform: loc.platform,
      },
      recommendations: [
        {
          title: "Improve lighting and composition in your photos",
          rationale: "Natural lighting, clean backgrounds, and the rule of thirds make a huge difference. Even phone cameras produce great results with proper technique.",
        },
      ],
    })
  }

  return insights
}

// ---------------------------------------------------------------------------
// Rule 14: Content mix self-analysis (location-only)
// ---------------------------------------------------------------------------

function checkContentMixSelfAnalysis(loc: EntityVisualProfile): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  const categories = Object.entries(loc.contentMix).filter(([, pct]) => pct >= 5)
  if (categories.length < 1 || loc.postAnalyses.length < 5) return insights

  const topCat = getTopCategory(loc.contentMix)
  if (!topCat) return insights

  if (categories.length <= 2 && topCat.pct >= 60) {
    insights.push({
      insight_type: "social.content_variety_low",
      title: `${Math.round(topCat.pct)}% of your ${platformLabel(loc.platform)} content is ${formatCategory(topCat.category)}`,
      summary: `Your ${platformLabel(loc.platform)} content is heavily focused on ${formatCategory(topCat.category)} (${Math.round(topCat.pct)}%). Diversifying with behind-the-scenes, staff spotlights, or customer features keeps your feed interesting.`,
      confidence: "medium",
      severity: "warning",
      evidence: {
        topCategory: topCat.category,
        topPct: topCat.pct,
        totalCategories: categories.length,
        contentMix: loc.contentMix,
        platform: loc.platform,
      },
      recommendations: [
        {
          title: `Add variety: try behind-the-scenes, events, or customer stories`,
          rationale: "A diverse content mix keeps followers engaged and appeals to different audience segments.",
        },
      ],
    })
  } else if (categories.length >= 4) {
    insights.push({
      insight_type: "social.content_variety_good",
      title: `Great content variety on ${platformLabel(loc.platform)} — ${categories.length} content types`,
      summary: `Your ${platformLabel(loc.platform)} content spans ${categories.length} categories including ${categories.slice(0, 3).map(([c]) => formatCategory(c)).join(", ")}. A diversified content mix keeps your audience engaged.`,
      confidence: "medium",
      severity: "info",
      evidence: {
        categoryCount: categories.length,
        contentMix: loc.contentMix,
        platform: loc.platform,
      },
      recommendations: [],
    })
  }

  return insights
}

// ---------------------------------------------------------------------------
// Rule 15: Food photography self-assessment (location-only)
// ---------------------------------------------------------------------------

function checkFoodPhotographySelfAssessment(loc: EntityVisualProfile): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  if (loc.foodPresentationScore === 0) return insights

  if (loc.foodPresentationScore >= 70) {
    insights.push({
      insight_type: "social.food_photography_strong",
      title: `Your food photography on ${platformLabel(loc.platform)} looks great (${loc.foodPresentationScore}/100)`,
      summary: `Food presentation score is ${loc.foodPresentationScore}/100 on ${platformLabel(loc.platform)}. Appetizing food photos are the #1 driver of restaurant social media engagement. Keep up the quality.`,
      confidence: "high",
      severity: "info",
      evidence: {
        foodScore: loc.foodPresentationScore,
        platform: loc.platform,
      },
      recommendations: [],
    })
  } else if (loc.foodPresentationScore < 40) {
    insights.push({
      insight_type: "social.food_photography_weak",
      title: `Food photos on ${platformLabel(loc.platform)} need improvement (${loc.foodPresentationScore}/100)`,
      summary: `Your food presentation score is ${loc.foodPresentationScore}/100. Appetizing food photos directly influence customer decisions — better styling, natural lighting, and clean plating can significantly boost engagement.`,
      confidence: "high",
      severity: "warning",
      evidence: {
        foodScore: loc.foodPresentationScore,
        platform: loc.platform,
      },
      recommendations: [
        {
          title: "Use natural lighting and clean plates for food shots",
          rationale: "Photograph near windows during golden hour. Clean plate edges, add garnish, and use contrasting backgrounds.",
        },
      ],
    })
  }

  return insights
}

// ---------------------------------------------------------------------------
// Rule 16: Visual-engagement correlation (location-only)
// ---------------------------------------------------------------------------

function checkVisualEngagementCorrelation(loc: EntityVisualProfile): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  if (loc.postAnalyses.length < 5) return insights

  const sorted = [...loc.postAnalyses].sort((a, b) => b.engagement - a.engagement)
  const topHalf = sorted.slice(0, Math.ceil(sorted.length / 2))
  const bottomHalf = sorted.slice(Math.ceil(sorted.length / 2))

  const avgTopQuality = topHalf.reduce((s, p) => s + scoreVisualQuality(p.analysis), 0) / topHalf.length
  const avgBottomQuality = bottomHalf.reduce((s, p) => s + scoreVisualQuality(p.analysis), 0) / bottomHalf.length

  if (avgTopQuality >= avgBottomQuality + 20) {
    insights.push({
      insight_type: "social.visual_drives_engagement",
      title: `Higher-quality photos get more engagement on ${platformLabel(loc.platform)}`,
      summary: `Your top-performing posts on ${platformLabel(loc.platform)} have an average visual quality of ${Math.round(avgTopQuality)} vs ${Math.round(avgBottomQuality)} for lower-performing posts. Investing in visual quality directly drives results.`,
      confidence: "high",
      severity: "info",
      evidence: {
        topHalfQuality: Math.round(avgTopQuality),
        bottomHalfQuality: Math.round(avgBottomQuality),
        qualityGap: Math.round(avgTopQuality - avgBottomQuality),
        postsAnalyzed: loc.postAnalyses.length,
        platform: loc.platform,
      },
      recommendations: [
        {
          title: "Prioritize photo quality — it's proven to boost your engagement",
          rationale: "Your own data shows a clear correlation between visual quality and engagement. Make every post count.",
        },
      ],
    })
  }

  return insights
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTopCategory(mix: Record<string, number>): { category: string; pct: number } | null {
  let top: { category: string; pct: number } | null = null
  for (const [cat, pct] of Object.entries(mix)) {
    if (!top || pct > top.pct) {
      top = { category: cat, pct }
    }
  }
  return top
}

function formatCategory(cat: string): string {
  return cat.replace(/_/g, " ")
}

function platformLabel(platform: string): string {
  switch (platform) {
    case "instagram": return "Instagram"
    case "facebook": return "Facebook"
    case "tiktok": return "TikTok"
    default: return platform
  }
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

const LIGHTING_SCORES: Record<string, number> = { professional: 100, natural_good: 70, amateur: 40, poor: 15 }
const COMPOSITION_SCORES: Record<string, number> = { professional: 100, decent: 65, casual: 35, poor: 10 }
const EDITING_SCORES: Record<string, number> = { polished: 100, filtered: 65, minimal: 35, none: 15 }

function scoreVisualQuality(analysis: SocialPostAnalysis): number {
  const l = LIGHTING_SCORES[analysis.visualQuality.lighting] ?? 40
  const c = COMPOSITION_SCORES[analysis.visualQuality.composition] ?? 40
  const e = EDITING_SCORES[analysis.visualQuality.editing] ?? 40
  return Math.round((l + c + e) / 3)
}
