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
  attached_media_display_url?: string
  type?: string
  likes_count?: number
  comments_count?: number
  shares_count?: number
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
