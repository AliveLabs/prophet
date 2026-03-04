import { describe, it, expect } from "vitest"
import {
  normalizeInstagramProfile,
  normalizeInstagramPost,
  normalizeFacebookProfile,
  normalizeFacebookPost,
  normalizeTikTokProfile,
  normalizeTikTokPost,
  computeAggregateMetrics,
  buildSocialSnapshot,
} from "@/lib/social/normalize"
import type { InstagramRawProfile, InstagramRawPost } from "@/lib/providers/data365/instagram"
import type { FacebookRawProfile, FacebookRawPost } from "@/lib/providers/data365/facebook"
import type { TikTokRawProfile, TikTokRawPost } from "@/lib/providers/data365/tiktok"

// ---------------------------------------------------------------------------
// Instagram normalizers
// ---------------------------------------------------------------------------

describe("normalizeInstagramProfile", () => {
  it("maps all fields from raw response", () => {
    const raw: InstagramRawProfile = {
      id: "123",
      username: "testuser",
      full_name: "Test User",
      biography: "Hello world",
      followers_count: 5000,
      followings_count: 200,
      posts_count: 120,
      is_verified: true,
      profile_photo_url: "https://example.com/pic.jpg",
    }

    const result = normalizeInstagramProfile(raw, "testuser")

    expect(result.platform).toBe("instagram")
    expect(result.handle).toBe("testuser")
    expect(result.displayName).toBe("Test User")
    expect(result.bio).toBe("Hello world")
    expect(result.followerCount).toBe(5000)
    expect(result.followingCount).toBe(200)
    expect(result.postCount).toBe(120)
    expect(result.isVerified).toBe(true)
    expect(result.avatarUrl).toBe("https://example.com/pic.jpg")
    expect(result.engagementRate).toBeNull()
  })

  it("defaults missing fields to zero/null", () => {
    const raw: InstagramRawProfile = {}
    const result = normalizeInstagramProfile(raw, "emptyuser")

    expect(result.followerCount).toBe(0)
    expect(result.followingCount).toBe(0)
    expect(result.postCount).toBe(0)
    expect(result.isVerified).toBe(false)
    expect(result.avatarUrl).toBeNull()
    expect(result.bio).toBeNull()
  })

  it("falls back to username then handle for displayName", () => {
    expect(normalizeInstagramProfile({ username: "u1" }, "h1").displayName).toBe("u1")
    expect(normalizeInstagramProfile({}, "h1").displayName).toBe("h1")
  })
})

describe("normalizeInstagramPost", () => {
  it("normalizes a standard image post", () => {
    const raw: InstagramRawPost = {
      id: "post1",
      shortcode: "ABC",
      text: "Great day! #food #cafe",
      timestamp: 1700000000,
      attached_media_display_url: "https://example.com/img.jpg",
      likes_count: 100,
      comments_count: 10,
      is_video: false,
      text_tags: ["food", "cafe"],
    }

    const result = normalizeInstagramPost(raw)

    expect(result.platformPostId).toBe("post1")
    expect(result.platform).toBe("instagram")
    expect(result.text).toBe("Great day! #food #cafe")
    expect(result.mediaType).toBe("image")
    expect(result.likesCount).toBe(100)
    expect(result.commentsCount).toBe(10)
    expect(result.sharesCount).toBe(0)
    expect(result.hashtags).toEqual(["food", "cafe"])
    expect(result.createdTime).toBeTruthy()
  })

  it("identifies reels from product_type=clips", () => {
    const result = normalizeInstagramPost({ product_type: "clips" })
    expect(result.mediaType).toBe("reel")
  })

  it("identifies carousels", () => {
    const result = normalizeInstagramPost({ product_type: "carousel_container" })
    expect(result.mediaType).toBe("carousel")
  })

  it("identifies reels from is_video flag", () => {
    const result = normalizeInstagramPost({ is_video: true })
    expect(result.mediaType).toBe("reel")
  })

  it("extracts hashtags from caption when not provided", () => {
    const result = normalizeInstagramPost({ text: "Love this #sunset #travel" })
    expect(result.hashtags).toEqual(["sunset", "travel"])
  })
})

// ---------------------------------------------------------------------------
// Facebook normalizers
// ---------------------------------------------------------------------------

describe("normalizeFacebookProfile", () => {
  it("maps all fields from raw response", () => {
    const raw: FacebookRawProfile = {
      id: "fb123",
      username: "testpage",
      full_name: "Test Page",
      biography: "A page about testing",
      followers_count: 8000,
      likes_count: 7500,
      is_verified: true,
      profile_photo_url: "https://example.com/fb.jpg",
    }

    const result = normalizeFacebookProfile(raw, "testpage")

    expect(result.platform).toBe("facebook")
    expect(result.handle).toBe("testpage")
    expect(result.displayName).toBe("Test Page")
    expect(result.bio).toBe("A page about testing")
    expect(result.followerCount).toBe(8000)
    expect(result.followingCount).toBe(0)
    expect(result.isVerified).toBe(true)
    expect(result.extraMetrics?.likesCount).toBe(7500)
  })

  it("defaults missing fields", () => {
    const result = normalizeFacebookProfile({}, "emptypage")
    expect(result.followerCount).toBe(0)
    expect(result.isVerified).toBe(false)
    expect(result.bio).toBeNull()
  })
})

describe("normalizeFacebookPost", () => {
  it("normalizes a photo post with reactions", () => {
    const raw: FacebookRawPost = {
      id: "fbpost1",
      message: "Check this out! #promo",
      type: "photo",
      attached_media_display_url: "https://example.com/photo.jpg",
      likes_count: 50,
      comments_count: 5,
      shares_count: 3,
      reactions: { like: 30, love: 15, haha: 5 },
    }

    const result = normalizeFacebookPost(raw)

    expect(result.platformPostId).toBe("fbpost1")
    expect(result.platform).toBe("facebook")
    expect(result.mediaType).toBe("image")
    expect(result.likesCount).toBe(50)
    expect(result.commentsCount).toBe(5)
    expect(result.sharesCount).toBe(3)
    expect(result.reactions?.like).toBe(30)
  })

  it("computes total reactions when likes_count is missing", () => {
    const raw: FacebookRawPost = {
      id: "fbpost2",
      reactions: { like: 10, love: 5, wow: 3 },
    }

    const result = normalizeFacebookPost(raw)
    expect(result.likesCount).toBe(18)
  })

  it("maps video and link types", () => {
    expect(normalizeFacebookPost({ type: "video" }).mediaType).toBe("video")
    expect(normalizeFacebookPost({ type: "link" }).mediaType).toBe("link")
    expect(normalizeFacebookPost({ type: "status" }).mediaType).toBe("status")
  })

  it("extracts hashtags from message", () => {
    const result = normalizeFacebookPost({ message: "Big #sale today! #discount" })
    expect(result.hashtags).toEqual(["sale", "discount"])
  })
})

// ---------------------------------------------------------------------------
// TikTok normalizers
// ---------------------------------------------------------------------------

describe("normalizeTikTokProfile", () => {
  it("maps all fields from raw response", () => {
    const raw: TikTokRawProfile = {
      id: "tt123",
      username: "tikuser",
      full_name: "TikTok User",
      signature: "Creating content",
      follower_count: 15000,
      following_count: 300,
      heart_count: 500000,
      video_count: 80,
      digg_count: 1000,
      is_verified: false,
      avatar_url: "https://example.com/tt.jpg",
    }

    const result = normalizeTikTokProfile(raw, "tikuser")

    expect(result.platform).toBe("tiktok")
    expect(result.handle).toBe("tikuser")
    expect(result.displayName).toBe("TikTok User")
    expect(result.bio).toBe("Creating content")
    expect(result.followerCount).toBe(15000)
    expect(result.followingCount).toBe(300)
    expect(result.postCount).toBe(80)
    expect(result.extraMetrics?.heartCount).toBe(500000)
    expect(result.extraMetrics?.diggCount).toBe(1000)
  })

  it("falls back to username then handle for displayName", () => {
    expect(normalizeTikTokProfile({ username: "uid" }, "h").displayName).toBe("uid")
    expect(normalizeTikTokProfile({}, "h").displayName).toBe("h")
  })
})

describe("normalizeTikTokPost", () => {
  it("normalizes a TikTok video post", () => {
    const raw: TikTokRawPost = {
      id: "ttpost1",
      text: "Amazing recipe #cooking #food",
      timestamp: 1700000000,
      video_cover_url_s3: "https://example.com/cover.jpg",
      play_count: 50000,
      digg_count: 3000,
      comment_count: 150,
      share_count: 200,
      hashtags: [{ name: "cooking" }, { name: "food" }],
    }

    const result = normalizeTikTokPost(raw)

    expect(result.platformPostId).toBe("ttpost1")
    expect(result.platform).toBe("tiktok")
    expect(result.mediaType).toBe("video")
    expect(result.likesCount).toBe(3000)
    expect(result.commentsCount).toBe(150)
    expect(result.sharesCount).toBe(200)
    expect(result.viewsCount).toBe(50000)
    expect(result.hashtags).toEqual(["cooking", "food"])
  })

  it("extracts hashtags from description when not provided", () => {
    const result = normalizeTikTokPost({ text: "Try this #recipe #tasty" })
    expect(result.hashtags).toEqual(["recipe", "tasty"])
  })

  it("defaults missing fields to zero", () => {
    const result = normalizeTikTokPost({})
    expect(result.likesCount).toBe(0)
    expect(result.commentsCount).toBe(0)
    expect(result.sharesCount).toBe(0)
    expect(result.viewsCount).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Aggregate metrics
// ---------------------------------------------------------------------------

describe("computeAggregateMetrics", () => {
  it("returns zeroed metrics for empty posts array", () => {
    const profile = normalizeInstagramProfile({ followers_count: 1000 }, "test")
    const result = computeAggregateMetrics(profile, [])

    expect(result.avgLikesPerPost).toBe(0)
    expect(result.avgCommentsPerPost).toBe(0)
    expect(result.engagementRate).toBe(0)
    expect(result.postingFrequencyPerWeek).toBe(0)
    expect(result.topHashtags).toEqual([])
  })

  it("computes engagement rate correctly", () => {
    const profile = normalizeInstagramProfile({ followers_count: 1000 }, "test")
    const posts = [
      normalizeInstagramPost({ likes_count: 50, comments_count: 10, timestamp: 1700000000 }),
      normalizeInstagramPost({ likes_count: 30, comments_count: 20, timestamp: 1700100000 }),
    ]

    const result = computeAggregateMetrics(profile, posts)

    // avg likes = (50+30)/2 = 40, avg comments = (10+20)/2 = 15
    // engagement = (40+15)/1000 * 100 = 5.5
    expect(result.avgLikesPerPost).toBe(40)
    expect(result.avgCommentsPerPost).toBe(15)
    expect(result.engagementRate).toBe(5.5)
  })

  it("computes top hashtags by frequency", () => {
    const profile = normalizeInstagramProfile({ followers_count: 1000 }, "test")
    const posts = [
      normalizeInstagramPost({ text_tags: ["food", "cafe", "local"] }),
      normalizeInstagramPost({ text_tags: ["food", "cafe"] }),
      normalizeInstagramPost({ text_tags: ["food"] }),
    ]

    const result = computeAggregateMetrics(profile, posts)

    expect(result.topHashtags[0]).toBe("food")
    expect(result.topHashtags[1]).toBe("cafe")
    expect(result.topHashtags[2]).toBe("local")
  })

  it("handles zero followers without division error", () => {
    const profile = normalizeInstagramProfile({ followers_count: 0 }, "test")
    const posts = [normalizeInstagramPost({ likes_count: 50, comments_count: 10 })]

    const result = computeAggregateMetrics(profile, posts)
    expect(result.engagementRate).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// buildSocialSnapshot
// ---------------------------------------------------------------------------

describe("buildSocialSnapshot", () => {
  it("produces a valid v1.0 snapshot with computed metrics", () => {
    const profile = normalizeInstagramProfile({ followers_count: 2000, full_name: "Test" }, "test")
    const posts = [
      normalizeInstagramPost({ likes_count: 100, comments_count: 20, timestamp: 1700000000 }),
    ]

    const snapshot = buildSocialSnapshot(profile, posts)

    expect(snapshot.version).toBe("1.0")
    expect(snapshot.timestamp).toBeTruthy()
    expect(snapshot.profile.followerCount).toBe(2000)
    expect(snapshot.profile.engagementRate).toBeTypeOf("number")
    expect(snapshot.aggregateMetrics.avgLikesPerPost).toBe(100)
    expect(snapshot.recentPosts).toHaveLength(1)
  })
})
