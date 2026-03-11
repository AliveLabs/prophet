// ---------------------------------------------------------------------------
// Social media image storage helpers
//
// Downloads post images from platform CDN URLs (which expire quickly) and
// uploads them to the `social-media` Supabase Storage bucket, returning a
// permanent public URL.
// ---------------------------------------------------------------------------

import type { NormalizedSocialPost } from "./types"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

const BUCKET = "social-media"
const DOWNLOAD_TIMEOUT_MS = 15_000

/**
 * Download a single image URL and upload to Supabase Storage.
 * Uses the admin (service-role) client to bypass RLS.
 * Returns the permanent public URL, or null if the download/upload failed.
 */
export async function persistPostImage(
  mediaUrl: string,
  storagePath: string
): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)

    const response = await fetch(mediaUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "Prophet/1.0" },
    })
    clearTimeout(timer)

    if (!response.ok) {
      console.warn(`[Social Storage] Download failed (${response.status}) for ${mediaUrl.slice(0, 80)}...`)
      return null
    }

    const contentType = response.headers.get("content-type") ?? "image/jpeg"
    if (!contentType.startsWith("image/")) {
      console.warn(`[Social Storage] Unexpected content-type: ${contentType}`)
      return null
    }

    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    if (buffer.length < 500) {
      console.warn(`[Social Storage] Image too small (${buffer.length} bytes), likely invalid`)
      return null
    }

    const admin = createAdminSupabaseClient()

    const { error } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, buffer, { contentType, upsert: true })

    if (error) {
      console.warn(`[Social Storage] Upload error: ${error.message}`)
      return null
    }

    const { data: urlData } = admin.storage
      .from(BUCKET)
      .getPublicUrl(storagePath)

    return urlData.publicUrl
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!msg.includes("abort")) {
      console.warn(`[Social Storage] Failed: ${msg}`)
    }
    return null
  }
}

/**
 * For an array of normalized posts, download each image and replace
 * the temporary CDN `mediaUrl` with a permanent Supabase Storage URL.
 *
 * Posts without a mediaUrl or where the download fails keep their
 * original value (the display component already handles broken URLs
 * with a graceful fallback).
 */
export async function persistPostImages(
  posts: NormalizedSocialPost[],
  profileHandle: string,
  platform: string
): Promise<NormalizedSocialPost[]> {
  const results: NormalizedSocialPost[] = []

  for (const post of posts) {
    if (!post.mediaUrl) {
      results.push(post)
      continue
    }

    const ext = guessExtension(post.mediaUrl)
    const storagePath = `${platform}/${profileHandle}/${post.platformPostId}.${ext}`

    const publicUrl = await persistPostImage(post.mediaUrl, storagePath)

    results.push({
      ...post,
      mediaUrl: publicUrl ?? post.mediaUrl,
    })
  }

  return results
}

function guessExtension(url: string): string {
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    if (pathname.includes(".png")) return "png"
    if (pathname.includes(".webp")) return "webp"
    if (pathname.includes(".gif")) return "gif"
  } catch { /* ignore */ }
  return "jpg"
}
