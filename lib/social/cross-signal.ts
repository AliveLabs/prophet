// ---------------------------------------------------------------------------
// Cross-Signal Social Intelligence
//
// Insights that correlate social media data with other signals:
// - Social + SEO (social driving web traffic)
// - Social + Events (competitors promoting events on social)
// - Social + Content (menu/feature launches promoted on social)
// - Social + Weather (posting patterns during weather events)
// ---------------------------------------------------------------------------

import type { GeneratedInsight } from "@/lib/insights/types"
import type { SocialSnapshotData, SocialPlatform } from "./types"

type CrossSignalInput = {
  locationSocial: Array<{
    platform: SocialPlatform
    snapshot: SocialSnapshotData
  }>
  competitorSocial: Array<{
    entityName: string
    platform: SocialPlatform
    snapshot: SocialSnapshotData
  }>
  seoData?: {
    locationDomainRank?: number | null
    locationOrganicTraffic?: number | null
    topCompetitorDomainRank?: number | null
    topCompetitorName?: string | null
  } | null
  eventData?: {
    upcomingEventCount: number
    competitorEventCount: number
  } | null
  weatherData?: {
    isSevere: boolean
    condition: string
  } | null
}

export function generateCrossSignalInsights(input: CrossSignalInput): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []

  insights.push(
    ...checkSocialSeoCorrelation(input),
    ...checkSocialEventPromotion(input),
    ...checkSocialWeatherOpportunity(input),
    ...checkMultiPlatformStrategy(input),
  )

  return insights
}

// ---------------------------------------------------------------------------
// Social + SEO: social audience vs web visibility mismatch
// ---------------------------------------------------------------------------

function checkSocialSeoCorrelation(input: CrossSignalInput): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  if (!input.seoData?.locationOrganicTraffic) return insights

  const totalFollowers = input.locationSocial.reduce(
    (s, p) => s + p.snapshot.profile.followerCount,
    0
  )

  if (totalFollowers > 1000 && input.seoData.locationOrganicTraffic < 500) {
    insights.push({
      insight_type: "social.cross_seo_opportunity",
      title: "Strong social following but low web traffic",
      summary: `You have ${formatNumber(totalFollowers)} followers across social media but only ~${formatNumber(input.seoData.locationOrganicTraffic)} monthly organic visits. Drive your social audience to your website with link-in-bio, stories, and post CTAs.`,
      confidence: "medium",
      severity: "warning",
      evidence: {
        totalFollowers,
        organicTraffic: input.seoData.locationOrganicTraffic,
        ratio: Math.round(totalFollowers / input.seoData.locationOrganicTraffic),
      },
      recommendations: [
        {
          title: "Add your website link to all social bios and use CTA posts weekly",
          rationale: "Converting even 5% of followers to website visitors could double your organic traffic.",
        },
      ],
    })
  }

  return insights
}

// ---------------------------------------------------------------------------
// Social + Events: competitor promoting events on social
// ---------------------------------------------------------------------------

function checkSocialEventPromotion(input: CrossSignalInput): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  if (!input.eventData || input.eventData.competitorEventCount === 0) return insights

  const EVENT_KEYWORDS = /\b(event|show|live|tonight|this weekend|come join|we're hosting|hosting a|tickets|rsvp|book now|grand opening|launch|celebration)\b/i

  for (const comp of input.competitorSocial) {
    const eventPosts = comp.snapshot.recentPosts.filter(
      (p) => p.text && EVENT_KEYWORDS.test(p.text)
    )

    if (eventPosts.length >= 1) {
      insights.push({
        insight_type: "social.cross_events_promotion",
        title: `${comp.entityName} is promoting events on ${platformLabel(comp.platform)}`,
        summary: `${comp.entityName} has ${eventPosts.length} recent post(s) promoting events on ${platformLabel(comp.platform)}. Competitors who promote events on social media drive higher foot traffic and brand awareness.`,
        confidence: "medium",
        severity: "info",
        evidence: {
          competitor: comp.entityName,
          eventPostCount: eventPosts.length,
          platform: comp.platform,
          sampleText: eventPosts[0].text?.slice(0, 100),
        },
        recommendations: [
          {
            title: "Create and promote your own events or specials on social media",
            rationale: "Event-based content typically gets 2-3x more engagement than regular posts.",
          },
        ],
      })
      break
    }
  }

  return insights
}

// ---------------------------------------------------------------------------
// Social + Weather: posting opportunity during weather events
// ---------------------------------------------------------------------------

function checkSocialWeatherOpportunity(input: CrossSignalInput): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  if (!input.weatherData) return insights

  if (input.weatherData.isSevere && input.locationSocial.length > 0) {
    insights.push({
      insight_type: "social.cross_weather_opportunity",
      title: "Severe weather — post about it on social media",
      summary: `Current weather is severe (${input.weatherData.condition}). Posts about weather (safety tips, comfort food, cozy vibes) tend to get high engagement during bad weather days. This is an opportunity to connect with your local audience.`,
      confidence: "low",
      severity: "info",
      evidence: {
        weatherCondition: input.weatherData.condition,
        isSevere: true,
      },
      recommendations: [
        {
          title: "Post weather-related content (safety, comfort, community) within 24 hours",
          rationale: "Weather-related posts during severe events see 40-60% higher engagement.",
        },
      ],
    })
  }

  return insights
}

// ---------------------------------------------------------------------------
// Multi-platform strategy: competitors with coordinated presence
// ---------------------------------------------------------------------------

function checkMultiPlatformStrategy(input: CrossSignalInput): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []

  // Group competitor profiles by entity
  const compPlatformCount = new Map<string, Set<string>>()
  for (const comp of input.competitorSocial) {
    const platforms = compPlatformCount.get(comp.entityName) ?? new Set()
    platforms.add(comp.platform)
    compPlatformCount.set(comp.entityName, platforms)
  }

  const yourPlatforms = new Set(input.locationSocial.map((s) => s.platform))

  for (const [name, platforms] of compPlatformCount) {
    if (platforms.size >= 3 && yourPlatforms.size < platforms.size) {
      insights.push({
        insight_type: "social.cross_multi_platform",
        title: `${name} has a coordinated presence on ${platforms.size} platforms`,
        summary: `${name} is active on ${Array.from(platforms).map(platformLabel).join(", ")} while you're on ${yourPlatforms.size} platform(s). A multi-platform strategy increases reach and ensures you're visible where customers spend time.`,
        confidence: "medium",
        severity: "info",
        evidence: {
          competitor: name,
          competitorPlatforms: Array.from(platforms),
          yourPlatforms: Array.from(yourPlatforms),
        },
        recommendations: [
          {
            title: `Expand to ${Array.from(platforms).filter((p) => !yourPlatforms.has(p as SocialPlatform)).map(platformLabel).join(" and ")}`,
            rationale: "Being present where competitors are ensures you don't lose visibility.",
          },
        ],
      })
      break
    }
  }

  return insights
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
