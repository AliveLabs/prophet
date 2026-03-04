export type {
  SocialPlatform,
  NormalizedSocialProfile,
  NormalizedSocialPost,
  SocialAggregateMetrics,
  SocialSnapshotData,
  SocialProfileRow,
  SocialMediaType,
} from "./types"

export {
  normalizeInstagramProfile,
  normalizeInstagramPost,
  normalizeFacebookProfile,
  normalizeFacebookPost,
  normalizeTikTokProfile,
  normalizeTikTokPost,
  computeAggregateMetrics,
  buildSocialSnapshot,
} from "./normalize"

export { generateSocialInsights } from "./insights"
export { generateCrossSignalInsights } from "./cross-signal"
export { discoverSocialHandles, discoverFromWebsite, discoverFromSearch } from "./enrich"
