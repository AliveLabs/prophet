// ---------------------------------------------------------------------------
// Data365 TikTok Adapter
//
// API spec: https://api.data365.co/v1.1/tiktok/docs
// Profile: /tiktok/profile/{profile_id}/update → /tiktok/profile/{profile_id}
// Posts:   /tiktok/profile/{profile_id}/feed/posts
// ---------------------------------------------------------------------------

import { fetchProfile, fetchPosts, type Data365Platform } from "./client"

const PLATFORM: Data365Platform = "tiktok"

export type TikTokRawProfile = {
  id?: string
  username?: string
  full_name?: string
  signature?: string
  follower_count?: number
  following_count?: number
  heart_count?: number
  video_count?: number
  digg_count?: number
  is_verified?: boolean
  is_private?: boolean
  avatar_url?: string
  profile_avatar_url?: string
  biography_link?: string
}

export type TikTokRawPost = {
  id?: string
  text?: string
  created_time?: string
  timestamp?: number
  video_cover_url_s3?: string
  video?: { cover_url?: string; duration?: number }
  play_count?: number
  digg_count?: number
  comment_count?: number
  share_count?: number
  save_count?: number
  hashtags?: Array<{ name?: string } | string>
  author_username?: string
}

type ProfileResponse = {
  data?: TikTokRawProfile
}

type PostsResponse = {
  data?: {
    items?: TikTokRawPost[]
  }
}

export async function fetchTikTokProfile(handle: string): Promise<TikTokRawProfile | null> {
  const res = await fetchProfile<ProfileResponse>(PLATFORM, handle)
  return res.data ?? null
}

export async function fetchTikTokPosts(
  handle: string,
  limit = 20
): Promise<TikTokRawPost[]> {
  const res = await fetchPosts<PostsResponse>(PLATFORM, handle, limit)
  return res.data?.items ?? []
}
