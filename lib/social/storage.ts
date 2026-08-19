// ---------------------------------------------------------------------------
// Social media image storage helpers
//
// Downloads post images from platform CDN URLs (which expire quickly) and
// uploads them to the `social-media` Supabase Storage bucket, returning a
// permanent public URL.
//
// ── Why this file counts its own outcomes (ALT-666) ────────────────────────
// The mirror broke fleet-wide on 2026-07-24 and nobody noticed for three and a
// half weeks. There WAS a counter: the social pipeline computed `savedCount` by
// re-inspecting the returned URL for the substring "supabase". When Storage moved
// to the custom domain `auth.getticket.ai`, that substring vanished, so the
// counter read zero while the mirror kept succeeding at ~97%.
//
// The lesson is the design rule this file now enforces: A HEALTH METRIC MAY NOT
// BE DERIVED FROM THE SAME PREDICATE AS THE BEHAVIOUR IT MEASURES. A counter that
// can only be wrong in the same direction as the code is not instrumentation.
//
// So success and failure are counted HERE, at the one place that actually knows
// which happened, and the tally is returned to the caller rather than
// reconstructed downstream. `persistPostImage` returns a discriminated result for
// the same reason: `string | null` cannot say WHY, and "why" is the difference
// between normal expired-URL churn and a real outage.
// ---------------------------------------------------------------------------

import type { NormalizedSocialPost } from "./types"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

const BUCKET = "social-media"
const DOWNLOAD_TIMEOUT_MS = 15_000

/**
 * Why one mirror attempt failed. Stable strings — they are persisted onto
 * `pipeline_runs.signals.mirror.failures` and read back by the health detector,
 * so treat them as a wire format and add rather than rename.
 *
 *   `http_<status>`  the CDN refused the download (403 = expired URL, the normal case)
 *   `content_type`   we got a 200 that wasn't an image (interstitial / error page)
 *   `too_small`      a body too small to be a real image (usually a 1px sentinel)
 *   `upload_error`   the download worked; Supabase Storage rejected the upload
 *   `timeout`        the download exceeded DOWNLOAD_TIMEOUT_MS
 *   `error`          anything else thrown
 */
export type MirrorFailureReason =
  | `http_${number}`
  | "content_type"
  | "too_small"
  | "upload_error"
  | "timeout"
  | "error"

export type MirrorResult =
  | { ok: true; url: string }
  | { ok: false; reason: MirrorFailureReason }

/** Mirror outcomes for one pull, countable and mergeable. */
export type MirrorTally = {
  /** Posts that HAD a mediaUrl and were therefore attempted. Posts without one are not attempts. */
  attempted: number
  succeeded: number
  failed: number
  /** reason → count, e.g. `{ http_403: 4, timeout: 1 }`. Empty when nothing failed. */
  failures: Partial<Record<MirrorFailureReason, number>>
}

export function emptyMirrorTally(): MirrorTally {
  return { attempted: 0, succeeded: 0, failed: 0, failures: {} }
}

/** Sum tallies (per profile → per run → per fleet). Pure; safe on an empty list. */
export function mergeMirrorTallies(tallies: readonly MirrorTally[]): MirrorTally {
  const out = emptyMirrorTally()
  for (const t of tallies) {
    out.attempted += t.attempted
    out.succeeded += t.succeeded
    out.failed += t.failed
    for (const [reason, count] of Object.entries(t.failures)) {
      const key = reason as MirrorFailureReason
      out.failures[key] = (out.failures[key] ?? 0) + (count ?? 0)
    }
  }
  return out
}

/**
 * Did the mirror COLLAPSE, as opposed to losing a few images?
 *
 * The distinction is the whole point of ALT-666 item 3, and it is also the
 * alerting-overhaul precedent: individual expired CDN URLs are routine and must
 * never page anyone. Zero successes across a run that genuinely tried is a
 * different thing — that is either the provider or our own upload path being
 * down, and it is what the 2026-07-24 regression looked like from the outside.
 *
 * `minAttempts` guards the small-sample case: 0 of 1 is a bad image, not an outage.
 */
export function isMirrorCollapse(t: MirrorTally, minAttempts: number): boolean {
  return t.attempted >= minAttempts && t.succeeded === 0
}

/** Human-readable failure breakdown, worst first: `403 × 12, timeout × 2`. */
export function describeMirrorFailures(t: MirrorTally): string {
  const parts = Object.entries(t.failures)
    .filter(([, n]) => (n ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([reason, n]) => `${reason} × ${n}`)
  return parts.length > 0 ? parts.join(", ") : "none"
}

/**
 * Download a single image URL and upload to Supabase Storage.
 * Uses the admin (service-role) client to bypass RLS.
 *
 * Returns a discriminated result so the caller can count WHY, not just whether.
 */
export async function persistPostImage(
  mediaUrl: string,
  storagePath: string
): Promise<MirrorResult> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)

    const response = await fetch(mediaUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "Vatic/1.0" },
    })
    clearTimeout(timer)

    if (!response.ok) {
      console.warn(`[Social Storage] Download failed (${response.status}) for ${mediaUrl.slice(0, 80)}...`)
      return { ok: false, reason: `http_${response.status}` }
    }

    const contentType = response.headers.get("content-type") ?? "image/jpeg"
    if (!contentType.startsWith("image/")) {
      console.warn(`[Social Storage] Unexpected content-type: ${contentType}`)
      return { ok: false, reason: "content_type" }
    }

    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    if (buffer.length < 500) {
      console.warn(`[Social Storage] Image too small (${buffer.length} bytes), likely invalid`)
      return { ok: false, reason: "too_small" }
    }

    const admin = createAdminSupabaseClient()

    const { error } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, buffer, { contentType, upsert: true })

    if (error) {
      console.warn(`[Social Storage] Upload error: ${error.message}`)
      return { ok: false, reason: "upload_error" }
    }

    const { data: urlData } = admin.storage
      .from(BUCKET)
      .getPublicUrl(storagePath)

    return { ok: true, url: urlData.publicUrl }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // An abort is our own timeout firing, not an error worth logging every time.
    if (msg.includes("abort")) return { ok: false, reason: "timeout" }
    console.warn(`[Social Storage] Failed: ${msg}`)
    return { ok: false, reason: "error" }
  }
}

/**
 * For an array of normalized posts, download each image and replace
 * the temporary CDN `mediaUrl` with a permanent Supabase Storage URL.
 *
 * Posts without a mediaUrl or where the download fails keep their
 * original value (the display component already handles broken URLs
 * with a graceful fallback).
 *
 * Returns the tally alongside the posts. Read the counts from here — do not
 * recompute them by inspecting the returned URLs (see the file header).
 */
export async function persistPostImages(
  posts: NormalizedSocialPost[],
  profileHandle: string,
  platform: string
): Promise<{ posts: NormalizedSocialPost[]; tally: MirrorTally }> {
  const results: NormalizedSocialPost[] = []
  const tally = emptyMirrorTally()

  for (const post of posts) {
    if (!post.mediaUrl) {
      results.push(post)
      continue
    }

    const ext = guessExtension(post.mediaUrl)
    const storagePath = `${platform}/${profileHandle}/${post.platformPostId}.${ext}`

    tally.attempted++
    const result = await persistPostImage(post.mediaUrl, storagePath)
    if (result.ok) {
      tally.succeeded++
    } else {
      tally.failed++
      tally.failures[result.reason] = (tally.failures[result.reason] ?? 0) + 1
    }

    results.push({
      ...post,
      mediaUrl: result.ok ? result.url : post.mediaUrl,
    })
  }

  return { posts: results, tally }
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
