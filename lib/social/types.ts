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

export type SocialPostAnalysis = {
  contentCategory:
    | "food_dish" | "drink_cocktail" | "interior_ambiance" | "exterior_facade"
    | "patio_outdoor" | "event_live" | "staff_team" | "behind_the_scenes"
    | "customer_ugc" | "menu_promo" | "seasonal_holiday" | "repost_meme"
    | "product_merchandise" | "community_collab" | "other"
  subcategory: string
  tags: string[]
  extractedText: string
  foodPresentation: {
    platingQuality: "high" | "medium" | "low" | "n/a"
    portionAppeal: "generous" | "standard" | "small" | "n/a"
    colorVibrancy: "vibrant" | "muted" | "n/a"
  }
  visualQuality: {
    lighting: "professional" | "natural_good" | "amateur" | "poor"
    composition: "professional" | "decent" | "casual" | "poor"
    editing: "polished" | "filtered" | "minimal" | "none"
  }
  brandSignals: {
    logoVisible: boolean
    brandColorsPresent: boolean
    visualStyleConsistency: "on_brand" | "neutral" | "off_brand"
  }
  atmosphereSignals: {
    crowdLevel: "packed" | "busy" | "moderate" | "empty" | "n/a"
    energy: "high" | "relaxed" | "intimate" | "n/a"
    timeOfDay: "day" | "evening" | "night" | "unknown"
  }
  promotionalContent: boolean
  promotionalDetails: string
  confidence: number
  // ── §4.4 (P12) additive post-anatomy dimensions ────────────────────────────
  // OPTIONAL + back-compat: legacy stored analyses (and the deterministic default)
  // omit these; every existing parse keeps working. The social-counter producer
  // (lib/skills/social-counter) reads them to complete the winning-pattern teardown —
  // "posts with people / owner+staff / steam+motion outperform" is the highest-signal
  // cluster a F&B feed has, and a trending sound is the single biggest Reels/TikTok
  // discovery lever. The Gemini tagger (visual-analysis.ts) now emits them.
  /** A recognizable PERSON is present in frame (a human face/figure, not just hands or a logo). */
  peoplePresent?: boolean
  /** The person present reads as the OWNER or a STAFF MEMBER (uniform, behind the counter/pass,
   *  "meet the team" framing) rather than a customer — the authentic owner/BOH content cluster. */
  ownerOrStaffPresent?: boolean
  /** Visible STEAM, sizzle, pour, flame, or motion-implied freshness — the "it's alive" cue that
   *  reliably out-engages a static, plated, over-styled shot. */
  steamOrMotion?: boolean
  /** VIDEO-ONLY: the clip rides a trending/popular audio track (a discovery lever on Reels/TikTok).
   *  Undefined/false for static images and videos with original/no notable audio. */
  trendingSound?: boolean
  /** VIDEO-ONLY: a short plain-words description of the FIRST FRAME / thumbnail (the scroll-stopper
   *  the operator must nail), e.g. "close-up of cheese pull". Empty/omitted for static images. */
  firstFrame?: string
  /** Normalized 0..1 focal point of the main subject, for anchoring cover-crops of the post
   *  image (x: 0=left→1=right, y: 0=top→1=bottom). Optional; consumers default to center. */
  focalPoint?: { x: number; y: number }
}

export type EntityVisualProfile = {
  entityType: "location" | "competitor"
  entityId: string
  entityName: string
  platform: SocialPlatform
  contentMix: Record<string, number>
  avgVisualQualityScore: number
  professionalContentPct: number
  foodPresentationScore: number
  brandConsistencyScore: number
  promotionalContentPct: number
  crowdSignalScore: number
  postAnalyses: Array<{
    postId: string
    analysis: SocialPostAnalysis
    engagement: number
  }>
}

export type NormalizedSocialPost = {
  platformPostId: string
  platform: SocialPlatform
  text: string | null
  mediaUrl: string | null
  mediaType: SocialMediaType
  /** Permalink to the ORIGINAL post on the platform, when derivable from the raw payload
   *  (ALT-174). Built in the normalizer from the platform's stable id/shortcode/username.
   *  Absent on legacy snapshots captured before this field existed — they self-heal on the
   *  next daily pull. Renderers must hide the "open original" affordance when this is null. */
  postUrl?: string | null
  likesCount: number
  commentsCount: number
  sharesCount: number
  viewsCount: number | null
  hashtags: string[]
  createdTime: string
  visualAnalysis?: SocialPostAnalysis
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
  /** Per-post engagement when posts happen — NOT a measure of recent activity.
   *  Copy must phrase it conditionally ("when you post, engagement averages X%"). */
  engagementRate: number
  /** Posts/week over the last `postingWindowDays` days (legacy snapshots:
   *  account-lifetime average — the 2026-06-11 review's false-positive bug). */
  postingFrequencyPerWeek: number
  /** Window the frequency was computed over. Absent on legacy stored snapshots,
   *  which self-correct on the next daily pull. */
  postingWindowDays?: number
  postsInWindow?: number
  postsLast30Days?: number
  lastPostAt?: string | null
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
