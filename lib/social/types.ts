// ---------------------------------------------------------------------------
// Normalized Social Media Types
//
// Platform-agnostic types used across the social intelligence pipeline.
// Raw Data365 responses are normalized into these structures.
// ---------------------------------------------------------------------------

export type SocialPlatform = "instagram" | "facebook" | "tiktok"

export type NormalizedSocialProfile = {
  platform: SocialPlatform
  handle: string
  displayName: string
  bio: string | null
  followerCount: number
  followingCount: number
  postCount: number
  isVerified: boolean
  avatarUrl: string | null
  engagementRate: number | null
  extraMetrics?: {
    heartCount?: number    // TikTok total hearts
    diggCount?: number     // TikTok total diggs
    likesCount?: number    // Facebook page likes
  }
}

export type SocialMediaType = "image" | "video" | "carousel" | "reel" | "link" | "status"

export type NormalizedSocialPost = {
  platformPostId: string
  platform: SocialPlatform
  text: string | null
  mediaUrl: string | null
  mediaType: SocialMediaType
  likesCount: number
  commentsCount: number
  sharesCount: number
  viewsCount: number | null
  hashtags: string[]
  createdTime: string
  reactions?: {
    like?: number
    love?: number
    haha?: number
    wow?: number
    sad?: number
    angry?: number
    support?: number
  }
}

export type SocialAggregateMetrics = {
  avgLikesPerPost: number
  avgCommentsPerPost: number
  avgSharesPerPost: number
  avgViewsPerPost: number | null
  engagementRate: number
  postingFrequencyPerWeek: number
  topHashtags: string[]
}

export type SocialSnapshotData = {
  version: "1.0"
  timestamp: string
  profile: NormalizedSocialProfile
  recentPosts: NormalizedSocialPost[]
  aggregateMetrics: SocialAggregateMetrics
}

export type SocialProfileRow = {
  id: string
  entity_type: "location" | "competitor"
  entity_id: string
  platform: SocialPlatform
  handle: string
  profile_url: string | null
  discovery_method: "auto_scrape" | "data365_search" | "manual"
  is_verified: boolean
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}
