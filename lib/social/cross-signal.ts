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
import type { SocialSnapshotData, SocialPlatform, EntityVisualProfile } from "./types"

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
  visualProfiles?: {
    location: EntityVisualProfile[]
    competitors: EntityVisualProfile[]
  } | null
  googlePhotosData?: {
    locationAvgQuality?: number
    locationPhotoCount?: number
    topCategories?: string[]
  } | null
  menuData?: {
    recentMenuItemCount?: number
    recentMenuChangeDate?: string | null
  } | null
}

export function generateCrossSignalInsights(input: CrossSignalInput): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []

  insights.push(
    ...checkSocialSeoCorrelation(input),
    ...checkSocialEventPromotion(input),
    ...checkSocialWeatherOpportunity(input),
    ...checkMultiPlatformStrategy(input),
    ...checkVisualGoogleMismatch(input),
    ...checkEventVisualPromo(input),
    ...checkWeatherSeasonalContent(input),
    ...checkMenuVisualAlignment(input),
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
// Visual + Google Places: social images vs Google photos mismatch
// ---------------------------------------------------------------------------

function checkVisualGoogleMismatch(input: CrossSignalInput): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  if (!input.visualProfiles?.location?.length || !input.googlePhotosData) return insights

  const locVisual = input.visualProfiles.location[0]
  const googleQuality = input.googlePhotosData.locationAvgQuality ?? 0
  const socialQuality = locVisual.avgVisualQualityScore

  if (googleQuality <= 0 || socialQuality <= 0) return insights

  const gap = Math.abs(socialQuality - googleQuality)
  if (gap < 25) return insights

  if (socialQuality > googleQuality) {
    insights.push({
      insight_type: "social.cross_visual_google_mismatch",
      title: "Your social media photos are better than your Google listing photos",
      summary: `Your social content quality score (${socialQuality}) is significantly higher than your Google Places photo quality (${googleQuality}). Update your Google Business Profile photos to match — many customers see Google first.`,
      confidence: "medium",
      severity: "warning",
      evidence: {
        socialQualityScore: socialQuality,
        googleQualityScore: googleQuality,
        gap,
        direction: "social_better",
      },
      recommendations: [
        {
          title: "Upload your best social photos to Google Business Profile",
          rationale: "Google listing photos are often a customer's first impression. Match the quality of your social presence.",
        },
      ],
    })
  } else {
    insights.push({
      insight_type: "social.cross_visual_google_mismatch",
      title: "Your Google photos look better than your social media content",
      summary: `Your Google Places photo quality (${googleQuality}) outperforms your social content quality (${socialQuality}). Customers who discover you on social see a different (lower) quality than on Google.`,
      confidence: "medium",
      severity: "info",
      evidence: {
        socialQualityScore: socialQuality,
        googleQualityScore: googleQuality,
        gap,
        direction: "google_better",
      },
      recommendations: [
        {
          title: "Raise social media photo quality to match your Google presence",
          rationale: "Consistency across platforms builds trust. Repurpose your Google-quality photos for social posts.",
        },
      ],
    })
  }

  return insights
}

// ---------------------------------------------------------------------------
// Visual + Events: competitors visually promoting events on social
// ---------------------------------------------------------------------------

function checkEventVisualPromo(input: CrossSignalInput): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  if (!input.eventData || input.eventData.upcomingEventCount === 0) return insights
  if (!input.visualProfiles?.competitors?.length) return insights

  for (const compVisual of input.visualProfiles.competitors) {
    const eventPct = compVisual.contentMix["event_live"] ?? 0
    if (eventPct < 10) continue

    const locVisual = input.visualProfiles.location?.find(
      (l) => l.platform === compVisual.platform
    )
    const locEventPct = locVisual?.contentMix["event_live"] ?? 0

    if (eventPct >= 10 && locEventPct < 5) {
      insights.push({
        insight_type: "social.cross_event_visual_promo",
        title: `${compVisual.entityName} is visually promoting events on ${platformLabel(compVisual.platform)}`,
        summary: `${eventPct}% of ${compVisual.entityName}'s recent posts feature event content, while you have ${locEventPct}%. With ${input.eventData.upcomingEventCount} upcoming local events, visual event promotion can drive foot traffic.`,
        confidence: "medium",
        severity: "info",
        evidence: {
          competitor: compVisual.entityName,
          competitorEventPct: eventPct,
          yourEventPct: locEventPct,
          upcomingEvents: input.eventData.upcomingEventCount,
          platform: compVisual.platform,
        },
        recommendations: [
          {
            title: "Create visual content around upcoming local events",
            rationale: "Event-related visual content gets boosted by algorithms and attracts event-goers to your location.",
          },
        ],
      })
      break
    }
  }

  return insights
}

// ---------------------------------------------------------------------------
// Visual + Weather: seasonal content adaptation during weather changes
// ---------------------------------------------------------------------------

function checkWeatherSeasonalContent(input: CrossSignalInput): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  if (!input.weatherData || !input.visualProfiles?.competitors?.length) return insights

  const isWarmWeather = /clear|sun|warm|hot/i.test(input.weatherData.condition)
  const isColdWeather = /cold|snow|frost|ice|freez/i.test(input.weatherData.condition)

  if (!isWarmWeather && !isColdWeather) return insights

  for (const compVisual of input.visualProfiles.competitors) {
    const outdoorPct = (compVisual.contentMix["patio_outdoor"] ?? 0) +
      (compVisual.contentMix["exterior_facade"] ?? 0)
    const seasonalPct = compVisual.contentMix["seasonal_holiday"] ?? 0

    const locVisual = input.visualProfiles.location?.find(
      (l) => l.platform === compVisual.platform
    )

    if (isWarmWeather && outdoorPct >= 15) {
      const locOutdoor = (locVisual?.contentMix["patio_outdoor"] ?? 0) +
        (locVisual?.contentMix["exterior_facade"] ?? 0)
      if (locOutdoor < 5) {
        insights.push({
          insight_type: "social.cross_weather_seasonal_content",
          title: `${compVisual.entityName} is showcasing outdoor vibes while the weather is great`,
          summary: `With ${input.weatherData.condition} conditions, ${compVisual.entityName} has ${outdoorPct}% outdoor/patio content on ${platformLabel(compVisual.platform)}. Capitalize on good weather with patio shots and outdoor dining content.`,
          confidence: "low",
          severity: "info",
          evidence: {
            competitor: compVisual.entityName,
            weather: input.weatherData.condition,
            competitorOutdoorPct: outdoorPct,
            yourOutdoorPct: locOutdoor,
            platform: compVisual.platform,
          },
          recommendations: [
            {
              title: "Post patio and outdoor dining content while weather is good",
              rationale: "Weather-aligned content resonates with audiences and shows your space at its best.",
            },
          ],
        })
        break
      }
    }

    if (isColdWeather && seasonalPct >= 10) {
      const locSeasonal = locVisual?.contentMix["seasonal_holiday"] ?? 0
      if (locSeasonal < 5) {
        insights.push({
          insight_type: "social.cross_weather_seasonal_content",
          title: `${compVisual.entityName} is adapting content for cold weather`,
          summary: `During ${input.weatherData.condition} conditions, ${compVisual.entityName} has ${seasonalPct}% seasonal content on ${platformLabel(compVisual.platform)}. Cozy interior shots and comfort food posts perform well in cold weather.`,
          confidence: "low",
          severity: "info",
          evidence: {
            competitor: compVisual.entityName,
            weather: input.weatherData.condition,
            competitorSeasonalPct: seasonalPct,
            yourSeasonalPct: locSeasonal,
            platform: compVisual.platform,
          },
          recommendations: [
            {
              title: "Create cozy, seasonal content suited to cold weather",
              rationale: "Comfort food, warm beverages, and cozy atmosphere posts resonate during cold weather periods.",
            },
          ],
        })
        break
      }
    }
  }

  return insights
}

// ---------------------------------------------------------------------------
// Visual + Menu/Content: new menu items not promoted visually
// ---------------------------------------------------------------------------

function checkMenuVisualAlignment(input: CrossSignalInput): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  if (!input.menuData?.recentMenuChangeDate || !input.visualProfiles?.location?.length) return insights

  const changeDate = new Date(input.menuData.recentMenuChangeDate)
  const daysSinceChange = (Date.now() - changeDate.getTime()) / (1000 * 60 * 60 * 24)

  if (daysSinceChange > 30 || daysSinceChange < 0) return insights

  for (const locVisual of input.visualProfiles.location) {
    const foodPct = (locVisual.contentMix["food_dish"] ?? 0) +
      (locVisual.contentMix["drink_cocktail"] ?? 0)
    const promoPct = locVisual.contentMix["menu_promo"] ?? 0

    if (foodPct + promoPct < 20) {
      insights.push({
        insight_type: "social.cross_menu_visual_alignment",
        title: `You updated your menu ${Math.round(daysSinceChange)} days ago but aren't promoting it visually`,
        summary: `Your menu was updated ${Math.round(daysSinceChange)} days ago with ${input.menuData.recentMenuItemCount ?? "new"} items, but only ${foodPct + promoPct}% of your recent ${platformLabel(locVisual.platform)} posts feature food or menu content. Showcase your new items.`,
        confidence: "medium",
        severity: "warning",
        evidence: {
          daysSinceMenuChange: Math.round(daysSinceChange),
          menuItemCount: input.menuData.recentMenuItemCount,
          foodContentPct: foodPct,
          promoContentPct: promoPct,
          platform: locVisual.platform,
        },
        recommendations: [
          {
            title: "Create dedicated posts showcasing new menu items",
            rationale: "Menu updates are natural content opportunities. Professional photos of new dishes drive visits and engagement.",
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
