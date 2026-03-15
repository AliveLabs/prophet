import { describe, it, expect } from "vitest"
import { generateCrossSignalInsights } from "@/lib/social/cross-signal"
import type { SocialSnapshotData } from "@/lib/social/types"

function makeSnapshot(overrides: Partial<SocialSnapshotData> = {}): SocialSnapshotData {
  return {
    version: "1.0",
    timestamp: new Date().toISOString(),
    profile: {
      platform: "instagram",
      handle: "test",
      displayName: "Test",
      bio: null,
      followerCount: 1000,
      followingCount: 100,
      postCount: 50,
      isVerified: false,
      avatarUrl: null,
      engagementRate: null,
      ...overrides.profile,
    },
    recentPosts: overrides.recentPosts ?? [],
    aggregateMetrics: {
      avgLikesPerPost: 50,
      avgCommentsPerPost: 5,
      avgSharesPerPost: 2,
      avgViewsPerPost: null,
      engagementRate: 5.5,
      postingFrequencyPerWeek: 3,
      topHashtags: [],
      ...overrides.aggregateMetrics,
    },
  }
}

// ---------------------------------------------------------------------------
// Social + SEO: follower count vs web traffic mismatch
// ---------------------------------------------------------------------------

describe("Social + SEO correlation", () => {
  it("generates insight when high followers but low organic traffic", () => {
    const results = generateCrossSignalInsights({
      locationSocial: [
        {
          platform: "instagram",
          snapshot: makeSnapshot({
            profile: { followerCount: 5000 } as SocialSnapshotData["profile"],
          }),
        },
      ],
      competitorSocial: [],
      seoData: {
        locationOrganicTraffic: 200,
      },
    })

    const seoInsights = results.filter((i) => i.insight_type === "social.cross_seo_opportunity")
    expect(seoInsights.length).toBeGreaterThanOrEqual(1)
    expect(seoInsights[0].evidence.totalFollowers).toBe(5000)
    expect(seoInsights[0].evidence.organicTraffic).toBe(200)
  })

  it("does not fire when organic traffic is sufficient", () => {
    const results = generateCrossSignalInsights({
      locationSocial: [
        {
          platform: "instagram",
          snapshot: makeSnapshot({
            profile: { followerCount: 5000 } as SocialSnapshotData["profile"],
          }),
        },
      ],
      competitorSocial: [],
      seoData: {
        locationOrganicTraffic: 1000,
      },
    })

    const seoInsights = results.filter((i) => i.insight_type === "social.cross_seo_opportunity")
    expect(seoInsights).toHaveLength(0)
  })

  it("does not fire without seo data", () => {
    const results = generateCrossSignalInsights({
      locationSocial: [
        {
          platform: "instagram",
          snapshot: makeSnapshot({
            profile: { followerCount: 5000 } as SocialSnapshotData["profile"],
          }),
        },
      ],
      competitorSocial: [],
    })

    const seoInsights = results.filter((i) => i.insight_type === "social.cross_seo_opportunity")
    expect(seoInsights).toHaveLength(0)
  })

  it("does not fire when followers are low", () => {
    const results = generateCrossSignalInsights({
      locationSocial: [
        {
          platform: "instagram",
          snapshot: makeSnapshot({
            profile: { followerCount: 500 } as SocialSnapshotData["profile"],
          }),
        },
      ],
      competitorSocial: [],
      seoData: {
        locationOrganicTraffic: 100,
      },
    })

    const seoInsights = results.filter((i) => i.insight_type === "social.cross_seo_opportunity")
    expect(seoInsights).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Social + Events: competitor event promotion detection
// ---------------------------------------------------------------------------

describe("Social + Events promotion", () => {
  it("detects competitor promoting events on social", () => {
    const results = generateCrossSignalInsights({
      locationSocial: [],
      competitorSocial: [
        {
          entityName: "Rival",
          platform: "instagram",
          snapshot: makeSnapshot({
            recentPosts: [
              {
                platformPostId: "e1",
                platform: "instagram",
                text: "Come join us for our live event this weekend!",
                mediaUrl: null,
                mediaType: "image",
                likesCount: 100,
                commentsCount: 10,
                sharesCount: 5,
                viewsCount: null,
                hashtags: [],
                createdTime: new Date().toISOString(),
              },
            ],
          }),
        },
      ],
      eventData: {
        upcomingEventCount: 3,
        competitorEventCount: 1,
      },
    })

    const eventInsights = results.filter((i) => i.insight_type === "social.cross_events_promotion")
    expect(eventInsights.length).toBeGreaterThanOrEqual(1)
    expect(eventInsights[0].evidence.competitor).toBe("Rival")
  })

  it("does not fire without event data", () => {
    const results = generateCrossSignalInsights({
      locationSocial: [],
      competitorSocial: [
        {
          entityName: "Rival",
          platform: "instagram",
          snapshot: makeSnapshot({
            recentPosts: [
              {
                platformPostId: "e1",
                platform: "instagram",
                text: "Come join our event!",
                mediaUrl: null,
                mediaType: "image",
                likesCount: 100,
                commentsCount: 10,
                sharesCount: 5,
                viewsCount: null,
                hashtags: [],
                createdTime: new Date().toISOString(),
              },
            ],
          }),
        },
      ],
    })

    const eventInsights = results.filter((i) => i.insight_type === "social.cross_events_promotion")
    expect(eventInsights).toHaveLength(0)
  })

  it("does not fire when competitor event count is 0", () => {
    const results = generateCrossSignalInsights({
      locationSocial: [],
      competitorSocial: [
        {
          entityName: "Rival",
          platform: "instagram",
          snapshot: makeSnapshot({
            recentPosts: [
              {
                platformPostId: "e1",
                platform: "instagram",
                text: "Come join our event!",
                mediaUrl: null,
                mediaType: "image",
                likesCount: 100,
                commentsCount: 10,
                sharesCount: 5,
                viewsCount: null,
                hashtags: [],
                createdTime: new Date().toISOString(),
              },
            ],
          }),
        },
      ],
      eventData: {
        upcomingEventCount: 2,
        competitorEventCount: 0,
      },
    })

    const eventInsights = results.filter((i) => i.insight_type === "social.cross_events_promotion")
    expect(eventInsights).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Social + Weather: posting opportunity during severe weather
// ---------------------------------------------------------------------------

describe("Social + Weather opportunity", () => {
  it("generates insight during severe weather when social profiles exist", () => {
    const results = generateCrossSignalInsights({
      locationSocial: [
        {
          platform: "instagram",
          snapshot: makeSnapshot(),
        },
      ],
      competitorSocial: [],
      weatherData: {
        isSevere: true,
        condition: "Heavy Rain",
      },
    })

    const weatherInsights = results.filter((i) => i.insight_type === "social.cross_weather_opportunity")
    expect(weatherInsights.length).toBeGreaterThanOrEqual(1)
    expect(weatherInsights[0].evidence.weatherCondition).toBe("Heavy Rain")
  })

  it("does not fire when weather is not severe", () => {
    const results = generateCrossSignalInsights({
      locationSocial: [{ platform: "instagram", snapshot: makeSnapshot() }],
      competitorSocial: [],
      weatherData: {
        isSevere: false,
        condition: "Sunny",
      },
    })

    const weatherInsights = results.filter((i) => i.insight_type === "social.cross_weather_opportunity")
    expect(weatherInsights).toHaveLength(0)
  })

  it("does not fire when no social profiles exist", () => {
    const results = generateCrossSignalInsights({
      locationSocial: [],
      competitorSocial: [],
      weatherData: {
        isSevere: true,
        condition: "Blizzard",
      },
    })

    const weatherInsights = results.filter((i) => i.insight_type === "social.cross_weather_opportunity")
    expect(weatherInsights).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Multi-platform strategy
// ---------------------------------------------------------------------------

describe("Multi-platform strategy", () => {
  it("generates insight when competitor is on 3+ platforms and you're on fewer", () => {
    const results = generateCrossSignalInsights({
      locationSocial: [
        { platform: "instagram", snapshot: makeSnapshot() },
      ],
      competitorSocial: [
        { entityName: "Rival", platform: "instagram", snapshot: makeSnapshot() },
        { entityName: "Rival", platform: "facebook", snapshot: makeSnapshot() },
        { entityName: "Rival", platform: "tiktok", snapshot: makeSnapshot() },
      ],
    })

    const multiPlatform = results.filter((i) => i.insight_type === "social.cross_multi_platform")
    expect(multiPlatform.length).toBeGreaterThanOrEqual(1)
    expect(multiPlatform[0].evidence.competitor).toBe("Rival")
    expect(multiPlatform[0].evidence.competitorPlatforms).toHaveLength(3)
  })

  it("does not fire when you're on the same number of platforms", () => {
    const results = generateCrossSignalInsights({
      locationSocial: [
        { platform: "instagram", snapshot: makeSnapshot() },
        { platform: "facebook", snapshot: makeSnapshot() },
        { platform: "tiktok", snapshot: makeSnapshot() },
      ],
      competitorSocial: [
        { entityName: "Rival", platform: "instagram", snapshot: makeSnapshot() },
        { entityName: "Rival", platform: "facebook", snapshot: makeSnapshot() },
        { entityName: "Rival", platform: "tiktok", snapshot: makeSnapshot() },
      ],
    })

    const multiPlatform = results.filter((i) => i.insight_type === "social.cross_multi_platform")
    expect(multiPlatform).toHaveLength(0)
  })

  it("does not fire when competitor is on fewer than 3 platforms", () => {
    const results = generateCrossSignalInsights({
      locationSocial: [
        { platform: "instagram", snapshot: makeSnapshot() },
      ],
      competitorSocial: [
        { entityName: "Rival", platform: "instagram", snapshot: makeSnapshot() },
        { entityName: "Rival", platform: "facebook", snapshot: makeSnapshot() },
      ],
    })

    const multiPlatform = results.filter((i) => i.insight_type === "social.cross_multi_platform")
    expect(multiPlatform).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Integration: multiple cross-signal rules fire together
// ---------------------------------------------------------------------------

describe("Integration: multiple cross-signal rules", () => {
  it("fires multiple rules when conditions overlap", () => {
    const results = generateCrossSignalInsights({
      locationSocial: [
        {
          platform: "instagram",
          snapshot: makeSnapshot({
            profile: { followerCount: 5000 } as SocialSnapshotData["profile"],
          }),
        },
      ],
      competitorSocial: [
        {
          entityName: "Rival",
          platform: "instagram",
          snapshot: makeSnapshot({
            recentPosts: [
              {
                platformPostId: "e1",
                platform: "instagram",
                text: "Come join our live show tonight!",
                mediaUrl: null,
                mediaType: "video",
                likesCount: 200,
                commentsCount: 20,
                sharesCount: 10,
                viewsCount: null,
                hashtags: [],
                createdTime: new Date().toISOString(),
              },
            ],
          }),
        },
        { entityName: "Rival", platform: "facebook", snapshot: makeSnapshot() },
        { entityName: "Rival", platform: "tiktok", snapshot: makeSnapshot() },
      ],
      seoData: { locationOrganicTraffic: 100 },
      eventData: { upcomingEventCount: 2, competitorEventCount: 1 },
      weatherData: { isSevere: true, condition: "Thunderstorm" },
    })

    const types = new Set(results.map((i) => i.insight_type))
    expect(types.has("social.cross_seo_opportunity")).toBe(true)
    expect(types.has("social.cross_weather_opportunity")).toBe(true)
    expect(types.has("social.cross_multi_platform")).toBe(true)
  })
})
