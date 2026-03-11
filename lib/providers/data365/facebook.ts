// ---------------------------------------------------------------------------
// Data365 Facebook Adapter
//
// API spec: https://api.data365.co/v1.1/facebook/docs
// Profile: /facebook/profile/{profile_id}/update → /facebook/profile/{profile_id}
// Posts:   /facebook/profile/{profile_id}/{section}/posts
// ---------------------------------------------------------------------------

import { fetchProfile, fetchPosts, type Data365Platform } from "./client"

const PLATFORM: Data365Platform = "facebook"

export type FacebookRawProfile = {
  id?: string
  username?: string
  full_name?: string
  biography?: string
  followers_count?: number
  following_count?: number
  likes_count?: number
  categories?: string[]
  profile_photo_url?: string
  profile_avatar_url?: string
  profile_cover_photo_url?: string
  external_url?: string
  is_verified?: boolean
  address?: string
  phone?: string
  email?: string
  rating?: number
  profile_type?: string
  delegate_page_id?: string
}

export type FacebookRawPost = {
  id?: string
  message?: string
  text?: string
  created_time?: string
  // Facebook uses "attached_image_url" (NOT "attached_media_display_url" like Instagram)
  attached_image_url?: string
  attached_media_display_url?: string // fallback in case some endpoints use this
  post_type?: string
  type?: string // fallback
  comments_count?: number
  shares_count?: number
  // Facebook returns flat reaction counts (NOT nested like we originally assumed)
  reactions_like_count?: number
  reactions_love_count?: number
  reactions_haha_count?: number
  reactions_wow_count?: number
  reactions_sad_count?: number
  reactions_angry_count?: number
  reactions_support_count?: number
  reactions_total_count?: number
  likes_count?: number // fallback
}

type ProfileResponse = {
  data?: FacebookRawProfile
}

type PostsResponse = {
  data?: {
    items?: FacebookRawPost[]
  }
}

export async function fetchFacebookProfile(handle: string): Promise<FacebookRawProfile | null> {
  const res = await fetchProfile<ProfileResponse>(PLATFORM, handle)
  return res.data ?? null
}

export async function fetchFacebookPosts(
  handle: string,
  limit = 20
): Promise<FacebookRawPost[]> {
  const res = await fetchPosts<PostsResponse>(PLATFORM, handle, limit)
  return res.data?.items ?? []
}
