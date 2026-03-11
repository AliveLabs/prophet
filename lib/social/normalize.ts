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

  return {
    platformPostId: raw.id ?? raw.shortcode ?? "",
    platform: "instagram",
    text: raw.text ?? null,
    mediaUrl: raw.attached_media_display_url ?? null,
    mediaType,
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

  return {
    platformPostId: raw.id ?? "",
    platform: "facebook",
    text,
    mediaUrl,
    mediaType,
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

  return {
    platformPostId: raw.id ?? "",
    platform: "tiktok",
    text: raw.text ?? null,
    mediaUrl: coverUrl,
    mediaType: "video",
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

  // Posting frequency: estimate from post timestamps
  const timestamps = posts
    .map((p) => new Date(p.createdTime).getTime())
    .filter((t) => !isNaN(t))
    .sort((a, b) => a - b)

  let freqPerWeek = 0
  if (timestamps.length >= 2) {
    const spanMs = timestamps[timestamps.length - 1] - timestamps[0]
    const spanWeeks = spanMs / (7 * 24 * 60 * 60 * 1000)
    freqPerWeek = spanWeeks > 0 ? Math.round((timestamps.length / spanWeeks) * 10) / 10 : 0
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
