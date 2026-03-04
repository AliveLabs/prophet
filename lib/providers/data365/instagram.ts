// ---------------------------------------------------------------------------
// Data365 Instagram Adapter
//
// API spec: https://api.data365.co/v1.1/instagram/docs
// Profile: /instagram/profile/{profile_id}/update → /instagram/profile/{profile_id}
// Posts:   /instagram/profile/{profile_id}/{section}/posts
// ---------------------------------------------------------------------------

import { fetchProfile, fetchPosts, type Data365Platform } from "./client"

const PLATFORM: Data365Platform = "instagram"

export type InstagramRawProfile = {
  id?: string
  username?: string
  full_name?: string
  biography?: string
  followers_count?: number
  followings_count?: number
  posts_count?: number
  is_verified?: boolean
  is_private?: boolean
  is_business_account?: boolean
  profile_photo_url?: string
  profile_avatar_url?: string
  external_url?: string
  business_category?: string[]
  highlight_reels_count?: number
  last_update?: number
}

export type InstagramRawPost = {
  id?: string
  shortcode?: string
  text?: string
  timestamp?: number
  created_time?: string
  attached_media_display_url?: string
  attached_carousel_media_urls?: string[]
  likes_count?: number
  comments_count?: number
  video_views_count?: number
  video_plays_count?: number
  product_type?: string
  is_video?: boolean
  text_tags?: string[]
  text_tagged_users?: string[]
  owner_username?: string
  location_id?: string
}

type ProfileResponse = {
  data?: InstagramRawProfile
}

type PostsResponse = {
  data?: {
    items?: InstagramRawPost[]
  }
}

export async function fetchInstagramProfile(handle: string): Promise<InstagramRawProfile | null> {
  const res = await fetchProfile<ProfileResponse>(PLATFORM, handle)
  return res.data ?? null
}

export async function fetchInstagramPosts(
  handle: string,
  limit = 20
): Promise<InstagramRawPost[]> {
  const res = await fetchPosts<PostsResponse>(PLATFORM, handle, limit)
  return res.data?.items ?? []
}
