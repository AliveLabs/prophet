// ---------------------------------------------------------------------------
// Social Media Insight Generation Rules
//
// Deterministic rules comparing your social data vs competitors.
// Each rule follows the existing GeneratedInsight pattern.
// ---------------------------------------------------------------------------

import type { SocialSnapshotData, SocialPlatform } from "./types"
import type { GeneratedInsight } from "@/lib/insights/types"

type EntitySnapshot = {
  entityType: "location" | "competitor"
  entityId: string
  entityName: string
  platform: SocialPlatform
  current: SocialSnapshotData
  previous: SocialSnapshotData | null
}

/**
 * Generate social insights by comparing a location's social data
 * against its competitors.
 */
export function generateSocialInsights(
  locationSnapshots: EntitySnapshot[],
  competitorSnapshots: EntitySnapshot[]
): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []

  for (const locSnap of locationSnapshots) {
    const platformComps = competitorSnapshots.filter(
      (c) => c.platform === locSnap.platform
    )

    insights.push(
      ...checkPostingFrequencyGap(locSnap, platformComps),
      ...checkEngagementComparison(locSnap, platformComps),
      ...checkFollowerGrowth(locSnap, platformComps),
      ...checkInactiveAccount(locSnap),
      ...checkHashtagGap(locSnap, platformComps),
    )
  }

  // Cross-platform checks
  insights.push(
    ...checkPlatformPresenceGap(locationSnapshots, competitorSnapshots),
  )

  // Competitor-specific checks (don't need location data)
  for (const compSnap of competitorSnapshots) {
    insights.push(
      ...checkViralContent(compSnap),
      ...checkContentTypeOpportunity(compSnap),
      ...checkPromotionalActivity(compSnap),
    )
  }

  return insights
}

// ---------------------------------------------------------------------------
// Rule 1: Posting frequency gap
// ---------------------------------------------------------------------------

function checkPostingFrequencyGap(
  location: EntitySnapshot,
  competitors: EntitySnapshot[]
): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  const locFreq = location.current.aggregateMetrics.postingFrequencyPerWeek

  for (const comp of competitors) {
    const compFreq = comp.current.aggregateMetrics.postingFrequencyPerWeek
    if (compFreq > 0 && compFreq >= locFreq * 2 && compFreq - locFreq >= 2) {
      insights.push({
        insight_type: "social.posting_frequency_gap",
        title: `${comp.entityName} posts ${Math.round(compFreq)}x/week on ${platformLabel(comp.platform)}`,
        summary: `${comp.entityName} posts about ${Math.round(compFreq)} times per week on ${platformLabel(comp.platform)}, while you post ${Math.round(locFreq)} times per week. Consistent posting drives visibility and engagement.`,
        confidence: "high",
        severity: locFreq === 0 ? "critical" : "warning",
        evidence: {
          competitor: comp.entityName,
          competitorFrequency: compFreq,
          yourFrequency: locFreq,
          platform: comp.platform,
        },
        recommendations: [
          {
            title: `Increase ${platformLabel(comp.platform)} posting to at least ${Math.ceil(compFreq / 2)}x/week`,
            rationale: "Meeting even half the competitor's frequency will improve feed visibility and follower retention.",
          },
        ],
      })
    }
  }

  return insights
}

// ---------------------------------------------------------------------------
// Rule 2: Engagement rate comparison
// ---------------------------------------------------------------------------

function checkEngagementComparison(
  location: EntitySnapshot,
  competitors: EntitySnapshot[]
): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  const locRate = location.current.aggregateMetrics.engagementRate

  for (const comp of competitors) {
    const compRate = comp.current.aggregateMetrics.engagementRate
    if (locRate <= 0 || compRate <= 0) continue

    const ratio = locRate / compRate
    if (ratio >= 1.5) {
      insights.push({
        insight_type: "social.engagement_outperform",
        title: `Your ${platformLabel(location.platform)} engagement is ${ratio.toFixed(1)}x higher`,
        summary: `Your engagement rate (${locRate.toFixed(1)}%) on ${platformLabel(location.platform)} is ${ratio.toFixed(1)}x higher than ${comp.entityName}'s (${compRate.toFixed(1)}%). Your content strategy is resonating well with your audience.`,
        confidence: "high",
        severity: "info",
        evidence: {
          yourRate: locRate,
          competitorRate: compRate,
          competitor: comp.entityName,
          platform: location.platform,
        },
        recommendations: [],
      })
    } else if (ratio <= 0.5 && compRate - locRate >= 1.0) {
      insights.push({
        insight_type: "social.engagement_gap",
        title: `${comp.entityName} has ${(1 / ratio).toFixed(1)}x your engagement on ${platformLabel(location.platform)}`,
        summary: `${comp.entityName}'s engagement rate (${compRate.toFixed(1)}%) on ${platformLabel(location.platform)} is ${(1 / ratio).toFixed(1)}x higher than yours (${locRate.toFixed(1)}%). Study their content to identify what resonates.`,
        confidence: "high",
        severity: "warning",
        evidence: {
          yourRate: locRate,
          competitorRate: compRate,
          competitor: comp.entityName,
          platform: location.platform,
        },
        recommendations: [
          {
            title: "Analyze competitor's top-performing content",
            rationale: "Identify post types, formats, and timing that drive engagement.",
          },
        ],
      })
    }
  }

  return insights
}

// ---------------------------------------------------------------------------
// Rule 3: Follower growth velocity
// ---------------------------------------------------------------------------

function checkFollowerGrowth(
  location: EntitySnapshot,
  competitors: EntitySnapshot[]
): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  if (!location.previous) return insights

  const locGrowth = location.current.profile.followerCount - location.previous.profile.followerCount
  const locPct = location.previous.profile.followerCount > 0
    ? (locGrowth / location.previous.profile.followerCount) * 100
    : 0

  for (const comp of competitors) {
    if (!comp.previous) continue
    const compGrowth = comp.current.profile.followerCount - comp.previous.profile.followerCount
    const compPct = comp.previous.profile.followerCount > 0
      ? (compGrowth / comp.previous.profile.followerCount) * 100
      : 0

    if (compGrowth > locGrowth * 3 && compGrowth >= 50 && compPct >= 1) {
      insights.push({
        insight_type: "social.follower_growth_gap",
        title: `${comp.entityName} gained ${formatNumber(compGrowth)} followers on ${platformLabel(comp.platform)}`,
        summary: `${comp.entityName} gained ${formatNumber(compGrowth)} followers (+${compPct.toFixed(1)}%) on ${platformLabel(comp.platform)} since last snapshot, while you gained ${formatNumber(locGrowth)} (+${locPct.toFixed(1)}%). Investigate what's driving their growth.`,
        confidence: "medium",
        severity: "warning",
        evidence: {
          competitor: comp.entityName,
          competitorGrowth: compGrowth,
          competitorPct: compPct,
          yourGrowth: locGrowth,
          yourPct: locPct,
          platform: comp.platform,
        },
        recommendations: [
          {
            title: "Review competitor's recent content and campaigns",
            rationale: "Rapid follower growth usually signals effective campaigns, collaborations, or viral content.",
          },
        ],
      })
    }
  }

  return insights
}

// ---------------------------------------------------------------------------
// Rule 4: Platform presence gap
// ---------------------------------------------------------------------------

function checkPlatformPresenceGap(
  locationSnapshots: EntitySnapshot[],
  competitorSnapshots: EntitySnapshot[]
): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  const locPlatforms = new Set(locationSnapshots.map((s) => s.platform))
  const allPlatforms: SocialPlatform[] = ["instagram", "facebook", "tiktok"]

  for (const platform of allPlatforms) {
    if (locPlatforms.has(platform)) continue

    const compsOnPlatform = competitorSnapshots.filter((c) => c.platform === platform)
    if (compsOnPlatform.length >= 2) {
      const compNames = compsOnPlatform.slice(0, 3).map((c) => c.entityName).join(", ")
      insights.push({
        insight_type: "social.platform_presence_gap",
        title: `${compsOnPlatform.length} competitors are active on ${platformLabel(platform)}`,
        summary: `${compsOnPlatform.length} of your competitors (${compNames}) have an active ${platformLabel(platform)} presence, but you don't. You're missing potential customers who discover businesses on this platform.`,
        confidence: "high",
        severity: "critical",
        evidence: {
          platform,
          competitorCount: compsOnPlatform.length,
          competitors: compsOnPlatform.map((c) => c.entityName),
        },
        recommendations: [
          {
            title: `Create a ${platformLabel(platform)} account and start posting`,
            rationale: `${compsOnPlatform.length} competitors are already reaching customers here.`,
          },
        ],
      })
    }
  }

  return insights
}

// ---------------------------------------------------------------------------
// Rule 5: Viral content alert
// ---------------------------------------------------------------------------

function checkViralContent(compSnap: EntitySnapshot): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  const metrics = compSnap.current.aggregateMetrics
  const avgEngagement = metrics.avgLikesPerPost + metrics.avgCommentsPerPost

  if (avgEngagement <= 0) return insights

  for (const post of compSnap.current.recentPosts) {
    const postEngagement = post.likesCount + post.commentsCount
    if (postEngagement >= avgEngagement * 5 && postEngagement >= 100) {
      const snippet = post.text ? post.text.slice(0, 80) + (post.text.length > 80 ? "..." : "") : "(no caption)"
      insights.push({
        insight_type: "social.viral_content",
        title: `${compSnap.entityName} had a viral ${post.mediaType} on ${platformLabel(compSnap.platform)}`,
        summary: `A recent ${post.mediaType} by ${compSnap.entityName} got ${formatNumber(postEngagement)} engagements — ${Math.round(postEngagement / avgEngagement)}x their average. Content: "${snippet}"`,
        confidence: "high",
        severity: "info",
        evidence: {
          competitor: compSnap.entityName,
          postEngagement,
          avgEngagement,
          multiplier: Math.round(postEngagement / avgEngagement),
          mediaType: post.mediaType,
          platform: compSnap.platform,
        },
        recommendations: [
          {
            title: "Study what made this content perform well",
            rationale: "Viral content often reveals audience preferences you can apply to your own strategy.",
          },
        ],
      })
      break // Only report one viral post per competitor
    }
  }

  return insights
}

// ---------------------------------------------------------------------------
// Rule 6: Content type opportunity
// ---------------------------------------------------------------------------

function checkContentTypeOpportunity(compSnap: EntitySnapshot): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  const posts = compSnap.current.recentPosts
  if (posts.length < 5) return insights

  const byType = new Map<string, { count: number; totalEngagement: number }>()
  for (const post of posts) {
    const entry = byType.get(post.mediaType) ?? { count: 0, totalEngagement: 0 }
    entry.count++
    entry.totalEngagement += post.likesCount + post.commentsCount
    byType.set(post.mediaType, entry)
  }

  const typeStats = Array.from(byType.entries())
    .map(([type, stats]) => ({
      type,
      count: stats.count,
      avgEngagement: stats.count > 0 ? stats.totalEngagement / stats.count : 0,
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement)

  if (typeStats.length < 2) return insights

  const best = typeStats[0]
  const worst = typeStats[typeStats.length - 1]
  if (best.avgEngagement >= worst.avgEngagement * 3 && best.count >= 3) {
    insights.push({
      insight_type: "social.content_type_opportunity",
      title: `${best.type}s get ${Math.round(best.avgEngagement / worst.avgEngagement)}x more engagement for ${compSnap.entityName}`,
      summary: `${compSnap.entityName}'s ${best.type} content on ${platformLabel(compSnap.platform)} gets ${formatNumber(Math.round(best.avgEngagement))} avg engagement vs ${formatNumber(Math.round(worst.avgEngagement))} for ${worst.type}s. Consider creating more ${best.type} content.`,
      confidence: "medium",
      severity: "info",
      evidence: {
        competitor: compSnap.entityName,
        bestType: best.type,
        bestAvg: best.avgEngagement,
        worstType: worst.type,
        worstAvg: worst.avgEngagement,
        platform: compSnap.platform,
      },
      recommendations: [
        {
          title: `Create more ${best.type} content`,
          rationale: `${best.type}s consistently outperform other formats in your market.`,
        },
      ],
    })
  }

  return insights
}

// ---------------------------------------------------------------------------
// Rule 7: Promotional activity detection
// ---------------------------------------------------------------------------

const PROMO_KEYWORDS = /\b(sale|discount|promo|promotion|deal|offer|free|giveaway|contest|limited time|flash sale|% off|half price|buy one get one|bogo|coupon|special)\b/i

function checkPromotionalActivity(compSnap: EntitySnapshot): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  const promoPosts = compSnap.current.recentPosts.filter(
    (p) => p.text && PROMO_KEYWORDS.test(p.text)
  )

  if (promoPosts.length >= 2) {
    insights.push({
      insight_type: "social.promotional_activity",
      title: `${compSnap.entityName} is running promotions on ${platformLabel(compSnap.platform)}`,
      summary: `${compSnap.entityName} has posted ${promoPosts.length} promotional posts recently on ${platformLabel(compSnap.platform)}. They may be running sales, discounts, or giveaways to attract customers.`,
      confidence: "medium",
      severity: "warning",
      evidence: {
        competitor: compSnap.entityName,
        promoPostCount: promoPosts.length,
        samples: promoPosts.slice(0, 2).map((p) => p.text?.slice(0, 100)),
        platform: compSnap.platform,
      },
      recommendations: [
        {
          title: "Consider a counter-promotion or loyalty offer",
          rationale: "Competitor promotions can draw away customers. A targeted response maintains market share.",
        },
      ],
    })
  }

  return insights
}

// ---------------------------------------------------------------------------
// Rule 8: Hashtag strategy gap
// ---------------------------------------------------------------------------

function checkHashtagGap(
  location: EntitySnapshot,
  competitors: EntitySnapshot[]
): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  const locHashtags = new Set(location.current.aggregateMetrics.topHashtags)

  const compHashtagCounts = new Map<string, number>()
  for (const comp of competitors) {
    for (const tag of comp.current.aggregateMetrics.topHashtags) {
      compHashtagCounts.set(tag, (compHashtagCounts.get(tag) ?? 0) + 1)
    }
  }

  const missingTags = Array.from(compHashtagCounts.entries())
    .filter(([tag, count]) => count >= 2 && !locHashtags.has(tag))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag]) => tag)

  if (missingTags.length >= 2) {
    insights.push({
      insight_type: "social.hashtag_gap",
      title: `Competitors use local hashtags you're not using on ${platformLabel(location.platform)}`,
      summary: `Multiple competitors use these hashtags on ${platformLabel(location.platform)} that you're not: ${missingTags.map((t) => `#${t}`).join(", ")}. Using relevant local and industry hashtags increases discoverability.`,
      confidence: "medium",
      severity: "info",
      evidence: {
        missingHashtags: missingTags,
        yourHashtags: Array.from(locHashtags),
        platform: location.platform,
      },
      recommendations: [
        {
          title: `Start using ${missingTags.slice(0, 3).map((t) => `#${t}`).join(", ")} in your posts`,
          rationale: "These hashtags are proven to work in your local market.",
        },
      ],
    })
  }

  return insights
}

// ---------------------------------------------------------------------------
// Rule 10: Inactive account warning
// ---------------------------------------------------------------------------

function checkInactiveAccount(location: EntitySnapshot): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  const posts = location.current.recentPosts

  if (posts.length === 0) {
    insights.push({
      insight_type: "social.inactive_account",
      title: `Your ${platformLabel(location.platform)} account has no recent posts`,
      summary: `Your ${platformLabel(location.platform)} account (@${location.current.profile.handle}) has no recent posts. An inactive social media presence can hurt credibility and discoverability.`,
      confidence: "high",
      severity: "critical",
      evidence: { platform: location.platform, handle: location.current.profile.handle },
      recommendations: [
        {
          title: "Post at least 2-3 times this week to re-engage your audience",
          rationale: "Algorithms favor accounts that post consistently. Even a few posts can restart momentum.",
        },
      ],
    })
    return insights
  }

  const latestPostTime = new Date(posts[0].createdTime).getTime()
  const daysSincePost = (Date.now() - latestPostTime) / (1000 * 60 * 60 * 24)

  if (daysSincePost >= 30) {
    insights.push({
      insight_type: "social.inactive_account",
      title: `Your ${platformLabel(location.platform)} hasn't posted in ${Math.round(daysSincePost)} days`,
      summary: `Your last post on ${platformLabel(location.platform)} was ${Math.round(daysSincePost)} days ago. An inactive social presence signals to customers that the business may not be active.`,
      confidence: "high",
      severity: "critical",
      evidence: {
        platform: location.platform,
        daysSincePost: Math.round(daysSincePost),
        handle: location.current.profile.handle,
      },
      recommendations: [
        {
          title: "Resume posting immediately with behind-the-scenes or seasonal content",
          rationale: "Break the silence with low-effort, authentic content to re-engage followers.",
        },
      ],
    })
  }

  return insights
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function platformLabel(platform: SocialPlatform): string {
  switch (platform) {
    case "instagram": return "Instagram"
    case "facebook": return "Facebook"
    case "tiktok": return "TikTok"
  }
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
