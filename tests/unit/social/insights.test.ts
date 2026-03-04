import { describe, it, expect } from "vitest"
import { generateSocialInsights } from "@/lib/social/insights"
import type { SocialSnapshotData, SocialPlatform } from "@/lib/social/types"

type EntitySnapshot = {
  entityType: "location" | "competitor"
  entityId: string
  entityName: string
  platform: SocialPlatform
  current: SocialSnapshotData
  previous: SocialSnapshotData | null
}

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

function makeEntity(
  type: "location" | "competitor",
  name: string,
  platform: SocialPlatform,
  current: Partial<SocialSnapshotData> = {},
  previous: Partial<SocialSnapshotData> | null = null
): EntitySnapshot {
  return {
    entityType: type,
    entityId: `${type}-${name}`,
    entityName: name,
    platform,
    current: makeSnapshot(current),
    previous: previous ? makeSnapshot(previous) : null,
  }
}

// ---------------------------------------------------------------------------
// Rule 1: Posting frequency gap
// ---------------------------------------------------------------------------

describe("Rule 1: Posting frequency gap", () => {
  it("generates insight when competitor posts 2x+ more", () => {
    const loc = makeEntity("location", "MyBiz", "instagram", {
      aggregateMetrics: { postingFrequencyPerWeek: 1 } as SocialSnapshotData["aggregateMetrics"],
    })
    const comp = makeEntity("competitor", "Rival", "instagram", {
      aggregateMetrics: { postingFrequencyPerWeek: 7 } as SocialSnapshotData["aggregateMetrics"],
    })

    const results = generateSocialInsights([loc], [comp])
    const freqInsights = results.filter((i) => i.insight_type === "social.posting_frequency_gap")

    expect(freqInsights.length).toBeGreaterThanOrEqual(1)
    expect(freqInsights[0].severity).toBe("warning")
    expect(freqInsights[0].evidence.competitor).toBe("Rival")
  })

  it("generates critical severity when location frequency is 0", () => {
    const loc = makeEntity("location", "MyBiz", "instagram", {
      aggregateMetrics: { postingFrequencyPerWeek: 0 } as SocialSnapshotData["aggregateMetrics"],
    })
    const comp = makeEntity("competitor", "Rival", "instagram", {
      aggregateMetrics: { postingFrequencyPerWeek: 5 } as SocialSnapshotData["aggregateMetrics"],
    })

    const results = generateSocialInsights([loc], [comp])
    const freqInsights = results.filter((i) => i.insight_type === "social.posting_frequency_gap")

    expect(freqInsights.length).toBeGreaterThanOrEqual(1)
    expect(freqInsights[0].severity).toBe("critical")
  })

  it("does not fire when gap is small", () => {
    const loc = makeEntity("location", "MyBiz", "instagram", {
      aggregateMetrics: { postingFrequencyPerWeek: 3 } as SocialSnapshotData["aggregateMetrics"],
    })
    const comp = makeEntity("competitor", "Rival", "instagram", {
      aggregateMetrics: { postingFrequencyPerWeek: 4 } as SocialSnapshotData["aggregateMetrics"],
    })

    const results = generateSocialInsights([loc], [comp])
    const freqInsights = results.filter((i) => i.insight_type === "social.posting_frequency_gap")
    expect(freqInsights).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Rule 2: Engagement rate comparison
// ---------------------------------------------------------------------------

describe("Rule 2: Engagement comparison", () => {
  it("generates outperform insight when location has 1.5x+ engagement", () => {
    const loc = makeEntity("location", "MyBiz", "instagram", {
      aggregateMetrics: { engagementRate: 6.0 } as SocialSnapshotData["aggregateMetrics"],
    })
    const comp = makeEntity("competitor", "Rival", "instagram", {
      aggregateMetrics: { engagementRate: 3.0 } as SocialSnapshotData["aggregateMetrics"],
    })

    const results = generateSocialInsights([loc], [comp])
    const outperform = results.filter((i) => i.insight_type === "social.engagement_outperform")

    expect(outperform.length).toBeGreaterThanOrEqual(1)
    expect(outperform[0].severity).toBe("info")
  })

  it("generates engagement gap insight when competitor has 2x+ engagement", () => {
    const loc = makeEntity("location", "MyBiz", "instagram", {
      aggregateMetrics: { engagementRate: 1.5 } as SocialSnapshotData["aggregateMetrics"],
    })
    const comp = makeEntity("competitor", "Rival", "instagram", {
      aggregateMetrics: { engagementRate: 4.0 } as SocialSnapshotData["aggregateMetrics"],
    })

    const results = generateSocialInsights([loc], [comp])
    const gap = results.filter((i) => i.insight_type === "social.engagement_gap")

    expect(gap.length).toBeGreaterThanOrEqual(1)
    expect(gap[0].severity).toBe("warning")
  })

  it("does not fire when rates are similar", () => {
    const loc = makeEntity("location", "MyBiz", "instagram", {
      aggregateMetrics: { engagementRate: 4.0 } as SocialSnapshotData["aggregateMetrics"],
    })
    const comp = makeEntity("competitor", "Rival", "instagram", {
      aggregateMetrics: { engagementRate: 5.0 } as SocialSnapshotData["aggregateMetrics"],
    })

    const results = generateSocialInsights([loc], [comp])
    const engInsights = results.filter(
      (i) => i.insight_type === "social.engagement_outperform" || i.insight_type === "social.engagement_gap"
    )
    expect(engInsights).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Rule 3: Follower growth velocity
// ---------------------------------------------------------------------------

describe("Rule 3: Follower growth velocity", () => {
  it("generates insight when competitor grows 3x faster", () => {
    const loc = makeEntity(
      "location", "MyBiz", "instagram",
      { profile: { followerCount: 1010 } as SocialSnapshotData["profile"] },
      { profile: { followerCount: 1000 } as SocialSnapshotData["profile"] }
    )
    const comp = makeEntity(
      "competitor", "Rival", "instagram",
      { profile: { followerCount: 5100 } as SocialSnapshotData["profile"] },
      { profile: { followerCount: 5000 } as SocialSnapshotData["profile"] }
    )

    const results = generateSocialInsights([loc], [comp])
    const growth = results.filter((i) => i.insight_type === "social.follower_growth_gap")

    expect(growth.length).toBeGreaterThanOrEqual(1)
    expect(growth[0].evidence.competitor).toBe("Rival")
  })

  it("does not fire without previous snapshot", () => {
    const loc = makeEntity("location", "MyBiz", "instagram", {
      profile: { followerCount: 1000 } as SocialSnapshotData["profile"],
    })
    const comp = makeEntity("competitor", "Rival", "instagram", {
      profile: { followerCount: 5000 } as SocialSnapshotData["profile"],
    })

    const results = generateSocialInsights([loc], [comp])
    const growth = results.filter((i) => i.insight_type === "social.follower_growth_gap")
    expect(growth).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Rule 4: Platform presence gap
// ---------------------------------------------------------------------------

describe("Rule 4: Platform presence gap", () => {
  it("generates insight when 2+ competitors are on a platform you're not", () => {
    const loc = makeEntity("location", "MyBiz", "instagram")
    const comp1 = makeEntity("competitor", "Rival1", "tiktok")
    const comp2 = makeEntity("competitor", "Rival2", "tiktok")

    const results = generateSocialInsights([loc], [comp1, comp2])
    const gap = results.filter((i) => i.insight_type === "social.platform_presence_gap")

    expect(gap.length).toBeGreaterThanOrEqual(1)
    expect(gap[0].severity).toBe("critical")
    expect(gap[0].evidence.platform).toBe("tiktok")
  })

  it("does not fire when only one competitor is on platform", () => {
    const loc = makeEntity("location", "MyBiz", "instagram")
    const comp = makeEntity("competitor", "Rival1", "tiktok")

    const results = generateSocialInsights([loc], [comp])
    const gap = results.filter((i) => i.insight_type === "social.platform_presence_gap")
    expect(gap).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Rule 5: Viral content alert
// ---------------------------------------------------------------------------

describe("Rule 5: Viral content alert", () => {
  it("detects viral post with 5x average engagement", () => {
    const comp = makeEntity("competitor", "Rival", "instagram", {
      aggregateMetrics: {
        avgLikesPerPost: 50,
        avgCommentsPerPost: 10,
      } as SocialSnapshotData["aggregateMetrics"],
      recentPosts: [
        {
          platformPostId: "v1",
          platform: "instagram",
          text: "Our big announcement!",
          mediaUrl: null,
          mediaType: "image",
          likesCount: 500,
          commentsCount: 200,
          sharesCount: 0,
          viewsCount: null,
          hashtags: [],
          createdTime: new Date().toISOString(),
        },
      ],
    })

    const results = generateSocialInsights([], [comp])
    const viral = results.filter((i) => i.insight_type === "social.viral_content")

    expect(viral.length).toBeGreaterThanOrEqual(1)
    expect(viral[0].evidence.competitor).toBe("Rival")
  })

  it("does not fire for posts below 5x threshold", () => {
    const comp = makeEntity("competitor", "Rival", "instagram", {
      aggregateMetrics: {
        avgLikesPerPost: 100,
        avgCommentsPerPost: 20,
      } as SocialSnapshotData["aggregateMetrics"],
      recentPosts: [
        {
          platformPostId: "v1",
          platform: "instagram",
          text: "Normal post",
          mediaUrl: null,
          mediaType: "image",
          likesCount: 150,
          commentsCount: 30,
          sharesCount: 0,
          viewsCount: null,
          hashtags: [],
          createdTime: new Date().toISOString(),
        },
      ],
    })

    const results = generateSocialInsights([], [comp])
    const viral = results.filter((i) => i.insight_type === "social.viral_content")
    expect(viral).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Rule 6: Content type opportunity
// ---------------------------------------------------------------------------

describe("Rule 6: Content type opportunity", () => {
  it("identifies best-performing content type", () => {
    const reels = Array.from({ length: 3 }, (_, i) => ({
      platformPostId: `reel${i}`,
      platform: "instagram" as const,
      text: "Check this out",
      mediaUrl: null,
      mediaType: "reel" as const,
      likesCount: 500,
      commentsCount: 50,
      sharesCount: 0,
      viewsCount: null,
      hashtags: [],
      createdTime: new Date().toISOString(),
    }))

    const images = Array.from({ length: 3 }, (_, i) => ({
      platformPostId: `img${i}`,
      platform: "instagram" as const,
      text: "Photo post",
      mediaUrl: null,
      mediaType: "image" as const,
      likesCount: 30,
      commentsCount: 5,
      sharesCount: 0,
      viewsCount: null,
      hashtags: [],
      createdTime: new Date().toISOString(),
    }))

    const comp = makeEntity("competitor", "Rival", "instagram", {
      recentPosts: [...reels, ...images],
    })

    const results = generateSocialInsights([], [comp])
    const contentType = results.filter((i) => i.insight_type === "social.content_type_opportunity")

    expect(contentType.length).toBeGreaterThanOrEqual(1)
    expect(contentType[0].evidence.bestType).toBe("reel")
  })

  it("does not fire with fewer than 5 posts", () => {
    const posts = Array.from({ length: 4 }, (_, i) => ({
      platformPostId: `p${i}`,
      platform: "instagram" as const,
      text: null,
      mediaUrl: null,
      mediaType: "image" as const,
      likesCount: 50,
      commentsCount: 5,
      sharesCount: 0,
      viewsCount: null,
      hashtags: [],
      createdTime: new Date().toISOString(),
    }))

    const comp = makeEntity("competitor", "Rival", "instagram", { recentPosts: posts })

    const results = generateSocialInsights([], [comp])
    const contentType = results.filter((i) => i.insight_type === "social.content_type_opportunity")
    expect(contentType).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Rule 7: Promotional activity detection
// ---------------------------------------------------------------------------

describe("Rule 7: Promotional activity detection", () => {
  it("detects 2+ promotional posts", () => {
    const promoPosts = [
      {
        platformPostId: "p1",
        platform: "instagram" as const,
        text: "Big SALE this weekend! 50% off everything",
        mediaUrl: null,
        mediaType: "image" as const,
        likesCount: 100,
        commentsCount: 10,
        sharesCount: 0,
        viewsCount: null,
        hashtags: [],
        createdTime: new Date().toISOString(),
      },
      {
        platformPostId: "p2",
        platform: "instagram" as const,
        text: "GIVEAWAY! Win a free dinner",
        mediaUrl: null,
        mediaType: "image" as const,
        likesCount: 200,
        commentsCount: 50,
        sharesCount: 0,
        viewsCount: null,
        hashtags: [],
        createdTime: new Date().toISOString(),
      },
    ]

    const comp = makeEntity("competitor", "Rival", "instagram", {
      recentPosts: promoPosts,
    })

    const results = generateSocialInsights([], [comp])
    const promo = results.filter((i) => i.insight_type === "social.promotional_activity")

    expect(promo.length).toBeGreaterThanOrEqual(1)
    expect(promo[0].evidence.promoPostCount).toBe(2)
  })

  it("does not fire with only 1 promo post", () => {
    const posts = [
      {
        platformPostId: "p1",
        platform: "instagram" as const,
        text: "Flash sale today!",
        mediaUrl: null,
        mediaType: "image" as const,
        likesCount: 100,
        commentsCount: 10,
        sharesCount: 0,
        viewsCount: null,
        hashtags: [],
        createdTime: new Date().toISOString(),
      },
      {
        platformPostId: "p2",
        platform: "instagram" as const,
        text: "Beautiful sunset today",
        mediaUrl: null,
        mediaType: "image" as const,
        likesCount: 50,
        commentsCount: 5,
        sharesCount: 0,
        viewsCount: null,
        hashtags: [],
        createdTime: new Date().toISOString(),
      },
    ]

    const comp = makeEntity("competitor", "Rival", "instagram", { recentPosts: posts })
    const results = generateSocialInsights([], [comp])
    const promo = results.filter((i) => i.insight_type === "social.promotional_activity")
    expect(promo).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Rule 8: Hashtag strategy gap
// ---------------------------------------------------------------------------

describe("Rule 8: Hashtag strategy gap", () => {
  it("identifies hashtags used by 2+ competitors but not location", () => {
    const loc = makeEntity("location", "MyBiz", "instagram", {
      aggregateMetrics: {
        topHashtags: ["mybiz", "food"],
      } as SocialSnapshotData["aggregateMetrics"],
    })
    const comp1 = makeEntity("competitor", "Rival1", "instagram", {
      aggregateMetrics: {
        topHashtags: ["localfood", "citycafe", "food"],
      } as SocialSnapshotData["aggregateMetrics"],
    })
    const comp2 = makeEntity("competitor", "Rival2", "instagram", {
      aggregateMetrics: {
        topHashtags: ["localfood", "citycafe", "eats"],
      } as SocialSnapshotData["aggregateMetrics"],
    })

    const results = generateSocialInsights([loc], [comp1, comp2])
    const hashtagGap = results.filter((i) => i.insight_type === "social.hashtag_gap")

    expect(hashtagGap.length).toBeGreaterThanOrEqual(1)
    expect(hashtagGap[0].evidence.missingHashtags).toContain("localfood")
    expect(hashtagGap[0].evidence.missingHashtags).toContain("citycafe")
  })

  it("does not fire when there are fewer than 2 shared missing tags", () => {
    const loc = makeEntity("location", "MyBiz", "instagram", {
      aggregateMetrics: { topHashtags: ["food", "localfood"] } as SocialSnapshotData["aggregateMetrics"],
    })
    const comp = makeEntity("competitor", "Rival", "instagram", {
      aggregateMetrics: { topHashtags: ["food", "localfood"] } as SocialSnapshotData["aggregateMetrics"],
    })

    const results = generateSocialInsights([loc], [comp])
    const hashtagGap = results.filter((i) => i.insight_type === "social.hashtag_gap")
    expect(hashtagGap).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Rule 9 (labeled 10 in code): Inactive account warning
// ---------------------------------------------------------------------------

describe("Rule 9: Inactive account warning", () => {
  it("generates critical insight when no recent posts", () => {
    const loc = makeEntity("location", "MyBiz", "instagram", {
      recentPosts: [],
    })

    const results = generateSocialInsights([loc], [])
    const inactive = results.filter((i) => i.insight_type === "social.inactive_account")

    expect(inactive.length).toBeGreaterThanOrEqual(1)
    expect(inactive[0].severity).toBe("critical")
  })

  it("generates insight when last post was 30+ days ago", () => {
    const oldDate = new Date()
    oldDate.setDate(oldDate.getDate() - 45)

    const loc = makeEntity("location", "MyBiz", "instagram", {
      recentPosts: [
        {
          platformPostId: "old1",
          platform: "instagram",
          text: "Old post",
          mediaUrl: null,
          mediaType: "image",
          likesCount: 10,
          commentsCount: 1,
          sharesCount: 0,
          viewsCount: null,
          hashtags: [],
          createdTime: oldDate.toISOString(),
        },
      ],
    })

    const results = generateSocialInsights([loc], [])
    const inactive = results.filter((i) => i.insight_type === "social.inactive_account")

    expect(inactive.length).toBeGreaterThanOrEqual(1)
    expect(inactive[0].evidence.daysSincePost).toBeGreaterThanOrEqual(30)
  })

  it("does not fire when there are recent posts", () => {
    const recent = new Date()
    recent.setDate(recent.getDate() - 2)

    const loc = makeEntity("location", "MyBiz", "instagram", {
      recentPosts: [
        {
          platformPostId: "new1",
          platform: "instagram",
          text: "Fresh post",
          mediaUrl: null,
          mediaType: "image",
          likesCount: 50,
          commentsCount: 5,
          sharesCount: 0,
          viewsCount: null,
          hashtags: [],
          createdTime: recent.toISOString(),
        },
      ],
    })

    const results = generateSocialInsights([loc], [])
    const inactive = results.filter((i) => i.insight_type === "social.inactive_account")
    expect(inactive).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Integration: multiple rules fire together
// ---------------------------------------------------------------------------

describe("Integration: multiple rules", () => {
  it("generates insights from multiple rules simultaneously", () => {
    const loc = makeEntity("location", "MyBiz", "instagram", {
      aggregateMetrics: {
        postingFrequencyPerWeek: 0,
        engagementRate: 1,
        topHashtags: [],
        avgLikesPerPost: 0,
        avgCommentsPerPost: 0,
        avgSharesPerPost: 0,
        avgViewsPerPost: 0,
      } as SocialSnapshotData["aggregateMetrics"],
      recentPosts: [],
    })

    const comp = makeEntity("competitor", "Rival", "instagram", {
      aggregateMetrics: {
        postingFrequencyPerWeek: 7,
        engagementRate: 5,
        topHashtags: ["local", "food"],
        avgLikesPerPost: 100,
        avgCommentsPerPost: 20,
        avgSharesPerPost: 0,
        avgViewsPerPost: 0,
      } as SocialSnapshotData["aggregateMetrics"],
      recentPosts: [
        {
          platformPostId: "p1",
          platform: "instagram",
          text: "Big sale today!",
          mediaUrl: null,
          mediaType: "image",
          likesCount: 100,
          commentsCount: 10,
          sharesCount: 0,
          viewsCount: null,
          hashtags: [],
          createdTime: new Date().toISOString(),
        },
        {
          platformPostId: "p2",
          platform: "instagram",
          text: "Another giveaway!",
          mediaUrl: null,
          mediaType: "image",
          likesCount: 200,
          commentsCount: 50,
          sharesCount: 0,
          viewsCount: null,
          hashtags: [],
          createdTime: new Date().toISOString(),
        },
      ],
    })

    const results = generateSocialInsights([loc], [comp])

    expect(results.length).toBeGreaterThanOrEqual(2)

    const types = new Set(results.map((i) => i.insight_type))
    expect(types.has("social.posting_frequency_gap")).toBe(true)
    expect(types.has("social.inactive_account")).toBe(true)
  })
})
