// ---------------------------------------------------------------------------
// Social Media Normalizers
//
// Transform raw Data365 platform-specific responses into
// normalized social types.
// ---------------------------------------------------------------------------

import type { InstagramRawProfile, InstagramRawPost } from "@/lib/providers/data365/instagram"
import type { FacebookRawProfile, FacebookRawPost } from "@/lib/providers/data365/facebook"
import type { TikTokRawProfile, TikTokRawPost } from "@/lib/providers/data365/tiktok"
import type {
  NormalizedSocialProfile,
  NormalizedSocialPost,
  SocialAggregateMetrics,
  SocialSnapshotData,
  SocialMediaType,
} from "./types"

// ---------------------------------------------------------------------------
// Instagram normalizers
// ---------------------------------------------------------------------------

export function normalizeInstagramProfile(
  raw: InstagramRawProfile,
  handle: string
): NormalizedSocialProfile {
  return {
    platform: "instagram",
    handle,
    displayName: raw.full_name ?? raw.username ?? handle,
    bio: raw.biography ?? null,
    followerCount: raw.followers_count ?? 0,
    followingCount: raw.followings_count ?? 0,
    postCount: raw.posts_count ?? 0,
    isVerified: raw.is_verified ?? false,
    avatarUrl: raw.profile_photo_url ?? raw.profile_avatar_url ?? null,
    engagementRate: null,
  }
}

export function normalizeInstagramPost(raw: InstagramRawPost): NormalizedSocialPost {
  let mediaType: SocialMediaType = "image"
  if (raw.product_type === "clips" || raw.is_video) mediaType = "reel"
  else if (raw.product_type === "carousel_container" || raw.attached_carousel_media_urls?.length) mediaType = "carousel"

  // ALT-174: permalink to the original post. Instagram's shortcode is the stable public
  // slug (/p/{shortcode}/ resolves reels too); null when the payload omits it.
  const postUrl = raw.shortcode ? `https://www.instagram.com/p/${raw.shortcode}/` : null

  return {
    platformPostId: raw.id ?? raw.shortcode ?? "",
    platform: "instagram",
    text: raw.text ?? null,
    mediaUrl: raw.attached_media_display_url ?? null,
    mediaType,
    postUrl,
    likesCount: raw.likes_count ?? 0,
    commentsCount: raw.comments_count ?? 0,
    sharesCount: 0,
    viewsCount: raw.video_views_count ?? raw.video_plays_count ?? null,
    hashtags: raw.text_tags ?? extractHashtags(raw.text),
    createdTime: raw.created_time
      ? raw.created_time
      : raw.timestamp
        ? new Date(raw.timestamp * 1000).toISOString()
        : new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Facebook normalizers
// ---------------------------------------------------------------------------

export function normalizeFacebookProfile(
  raw: FacebookRawProfile,
  handle: string
): NormalizedSocialProfile {
  return {
    platform: "facebook",
    handle,
    displayName: raw.full_name ?? raw.username ?? handle,
    bio: raw.biography ?? null,
    followerCount: raw.followers_count ?? 0,
    followingCount: raw.following_count ?? 0,
    postCount: 0,
    isVerified: raw.is_verified ?? false,
    avatarUrl: raw.profile_photo_url ?? raw.profile_avatar_url ?? null,
    engagementRate: null,
    extraMetrics: {
      likesCount: raw.likes_count ?? undefined,
    },
  }
}

export function normalizeFacebookPost(raw: FacebookRawPost): NormalizedSocialPost {
  const postType = raw.post_type ?? raw.type
  let mediaType: SocialMediaType = "status"
  if (postType === "photo" || postType === "image") mediaType = "image"
  else if (postType === "video") mediaType = "video"
  else if (postType === "link") mediaType = "link"

  const totalReactions =
    (raw.reactions_like_count ?? 0) +
    (raw.reactions_love_count ?? 0) +
    (raw.reactions_haha_count ?? 0) +
    (raw.reactions_wow_count ?? 0) +
    (raw.reactions_sad_count ?? 0) +
    (raw.reactions_angry_count ?? 0) +
    (raw.reactions_support_count ?? 0)

  const text = raw.message ?? raw.text ?? null
  const mediaUrl = raw.attached_image_url ?? raw.attached_media_display_url ?? null

  // ALT-174: permalink to the original post. Facebook post ids are of the form
  // "{pageId}_{postId}"; facebook.com/{pageId}/posts/{postId} resolves the public post.
  // A bare numeric id (no underscore) isn't reliably linkable, so we leave it null
  // rather than emit a dead link.
  const fbId = raw.id ?? ""
  const fbParts = fbId.split("_")
  const postUrl =
    fbParts.length === 2 && fbParts[0] && fbParts[1]
      ? `https://www.facebook.com/${fbParts[0]}/posts/${fbParts[1]}`
      : null

  return {
    platformPostId: raw.id ?? "",
    platform: "facebook",
    text,
    mediaUrl,
    mediaType,
    postUrl,
    likesCount: raw.reactions_total_count ?? totalReactions ?? raw.likes_count ?? 0,
    commentsCount: raw.comments_count ?? 0,
    sharesCount: raw.shares_count ?? 0,
    viewsCount: null,
    hashtags: extractHashtags(text),
    createdTime: raw.created_time ?? new Date().toISOString(),
    reactions: {
      like: raw.reactions_like_count,
      love: raw.reactions_love_count,
      haha: raw.reactions_haha_count,
      wow: raw.reactions_wow_count,
      sad: raw.reactions_sad_count,
      angry: raw.reactions_angry_count,
      support: raw.reactions_support_count,
    },
  }
}

// ---------------------------------------------------------------------------
// TikTok normalizers
// ---------------------------------------------------------------------------

export function normalizeTikTokProfile(
  raw: TikTokRawProfile,
  handle: string
): NormalizedSocialProfile {
  return {
    platform: "tiktok",
    handle,
    displayName: raw.full_name ?? raw.username ?? handle,
    bio: raw.signature ?? null,
    followerCount: raw.follower_count ?? 0,
    followingCount: raw.following_count ?? 0,
    postCount: raw.video_count ?? 0,
    isVerified: raw.is_verified ?? false,
    avatarUrl: raw.avatar_url ?? raw.profile_avatar_url ?? null,
    engagementRate: null,
    extraMetrics: {
      heartCount: raw.heart_count,
      diggCount: raw.digg_count,
    },
  }
}

export function normalizeTikTokPost(raw: TikTokRawPost): NormalizedSocialPost {
  const coverUrl = raw.video_cover_url_s3 ?? raw.video?.cover_url ?? null

  const hashtags = (raw.hashtags ?? []).map((h) =>
    typeof h === "string" ? h : (h.name ?? "")
  ).filter(Boolean)

  // ALT-174: permalink to the original post. TikTok video URLs are
  // tiktok.com/@{username}/video/{id}; null when either part is missing.
  const postUrl =
    raw.author_username && raw.id
      ? `https://www.tiktok.com/@${raw.author_username}/video/${raw.id}`
      : null

  return {
    platformPostId: raw.id ?? "",
    platform: "tiktok",
    text: raw.text ?? null,
    mediaUrl: coverUrl,
    mediaType: "video",
    postUrl,
    likesCount: raw.digg_count ?? 0,
    commentsCount: raw.comment_count ?? 0,
    sharesCount: raw.share_count ?? 0,
    viewsCount: raw.play_count ?? null,
    hashtags: hashtags.length > 0 ? hashtags : extractHashtags(raw.text),
    createdTime: raw.created_time
      ? raw.created_time
      : raw.timestamp
        ? new Date(raw.timestamp * 1000).toISOString()
        : new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Aggregate metrics computation
// ---------------------------------------------------------------------------

// Posting frequency is computed over this window, not the account lifetime.
// Lifetime averaging produced false positives (review 2026-06-11: an account
// dark for 1,615 days read as "posting 2x/week").
export const POSTING_FREQUENCY_WINDOW_DAYS = 90

export function computeAggregateMetrics(
  profile: NormalizedSocialProfile,
  posts: NormalizedSocialPost[]
): SocialAggregateMetrics {
  if (posts.length === 0) {
    return {
      avgLikesPerPost: 0,
      avgCommentsPerPost: 0,
      avgSharesPerPost: 0,
      avgViewsPerPost: null,
      engagementRate: 0,
      postingFrequencyPerWeek: 0,
      postingWindowDays: POSTING_FREQUENCY_WINDOW_DAYS,
      postsInWindow: 0,
      postsLast30Days: 0,
      lastPostAt: null,
      topHashtags: [],
    }
  }

  const totalLikes = posts.reduce((s, p) => s + p.likesCount, 0)
  const totalComments = posts.reduce((s, p) => s + p.commentsCount, 0)
  const totalShares = posts.reduce((s, p) => s + p.sharesCount, 0)
  const viewPosts = posts.filter((p) => p.viewsCount != null)
  const totalViews = viewPosts.reduce((s, p) => s + (p.viewsCount ?? 0), 0)
  const n = posts.length

  const avgLikes = totalLikes / n
  const avgComments = totalComments / n
  const avgShares = totalShares / n

  // Engagement rate = (avg likes + avg comments) / follower count * 100
  const engagement =
    profile.followerCount > 0
      ? ((avgLikes + avgComments) / profile.followerCount) * 100
      : 0

  // Posting frequency over the recency window — a dark account must read 0,
  // not its historical average.
  const timestamps = posts
    .map((p) => new Date(p.createdTime).getTime())
    .filter((t) => !isNaN(t))
    .sort((a, b) => a - b)

  const nowMs = Date.now()
  const weekMs = 7 * 24 * 60 * 60 * 1000
  const windowStart = nowMs - POSTING_FREQUENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const inWindow = timestamps.filter((t) => t >= windowStart)
  const last30 = timestamps.filter((t) => t >= nowMs - 30 * 24 * 60 * 60 * 1000)
  const lastPostAt =
    timestamps.length > 0 ? new Date(timestamps[timestamps.length - 1]).toISOString() : null

  let freqPerWeek = 0
  if (inWindow.length > 0) {
    // Cadence = in-window posts over the span since the oldest IN-WINDOW post
    // (min 1 week). This reads a corrected account honestly — dark 6 months
    // then 3x/week for 8 weeks computes 3.0, not a flattened window average —
    // and young or API-truncated histories aren't understated.
    const effectiveMs = Math.max(nowMs - inWindow[0], weekMs)
    freqPerWeek = Math.round((inWindow.length / (effectiveMs / weekMs)) * 10) / 10
  }

  // Top hashtags
  const hashtagCounts = new Map<string, number>()
  for (const post of posts) {
    for (const tag of post.hashtags) {
      const lower = tag.toLowerCase().replace(/^#/, "")
      if (lower) hashtagCounts.set(lower, (hashtagCounts.get(lower) ?? 0) + 1)
    }
  }
  const topHashtags = Array.from(hashtagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag]) => tag)

  return {
    avgLikesPerPost: Math.round(avgLikes),
    avgCommentsPerPost: Math.round(avgComments * 10) / 10,
    avgSharesPerPost: Math.round(avgShares * 10) / 10,
    avgViewsPerPost: viewPosts.length > 0 ? Math.round(totalViews / viewPosts.length) : null,
    engagementRate: Math.round(engagement * 100) / 100,
    postingFrequencyPerWeek: freqPerWeek,
    postingWindowDays: POSTING_FREQUENCY_WINDOW_DAYS,
    postsInWindow: inWindow.length,
    postsLast30Days: last30.length,
    lastPostAt,
    topHashtags,
  }
}

/**
 * Build a full snapshot from normalized profile + posts.
 */
export function buildSocialSnapshot(
  profile: NormalizedSocialProfile,
  posts: NormalizedSocialPost[]
): SocialSnapshotData {
  const metrics = computeAggregateMetrics(profile, posts)
  return {
    version: "1.0",
    timestamp: new Date().toISOString(),
    profile: { ...profile, engagementRate: metrics.engagementRate },
    recentPosts: posts,
    aggregateMetrics: metrics,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractHashtags(text: string | null | undefined): string[] {
  if (!text) return []
  const matches = text.match(/#[\w\u00C0-\u024F]+/g) ?? []
  return matches.map((m) => m.slice(1))
}
