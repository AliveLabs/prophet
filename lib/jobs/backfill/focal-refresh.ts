// One-time backfill: add a focal point to photos/posts analyzed BEFORE focal detection
// existed (PR #61). The normal photo + social pipelines skip already-analyzed items, so
// they never revisit these rows — this pass re-runs the vision analyzer over stored images
// and MERGES the focal point into the existing analysis (preserving category/tags/etc).
//
// Runs on the deployed app via /api/cron/backfill-focal (correct prod creds + Gemini key).
// Idempotent + bounded per run: rows that already have a focal point are skipped, so a
// backlog drains naturally across repeated runs with no cursor. Merges focal only — it does
// not overwrite the rest of the stored analysis.

import { analyzePhoto } from "@/lib/providers/photos"
import { analyzeSocialPostImage } from "@/lib/social/visual-analysis"

// Loose client — location_photos / competitor_photos aren't in the generated DB types yet
// (same pattern as lib/cache/photos.ts). We only touch id / image_url / analysis_result.
type LooseClient = {
  from: (t: string) => {
    select: (c: string) => {
      not: (c: string, op: string, v: unknown) => { limit: (n: number) => Promise<{ data: unknown[] | null }> }
      limit: (n: number) => Promise<{ data: unknown[] | null }>
    }
    update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<{ error: unknown }> }
  }
}

export type RefreshResult = { scanned: number; updated: number }

/** Download a public image URL → bytes + mime type (null on any failure). */
async function download(url: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg"
    return { buffer: Buffer.from(await res.arrayBuffer()), mimeType }
  } catch {
    return null
  }
}

type StoredPhotoRow = { id: string; image_url: string | null; analysis_result: Record<string, unknown> | null }

/** Re-analyze own/competitor Google photos that have an analysis but no focal point. */
export async function refreshPhotoFocal(
  client: unknown,
  table: "location_photos" | "competitor_photos",
  limit: number,
): Promise<RefreshResult> {
  const db = client as LooseClient
  const { data } = await db.from(table).select("id, image_url, analysis_result").not("image_url", "is", null).limit(1000)
  const rows = (data ?? []) as StoredPhotoRow[]
  const needing = rows
    .filter((r) => r.image_url && r.analysis_result && typeof r.analysis_result === "object" && !("focal_point" in r.analysis_result))
    .slice(0, limit)

  let updated = 0
  for (const r of needing) {
    const dl = await download(r.image_url!)
    if (!dl) continue
    const fresh = await analyzePhoto(dl.buffer, dl.mimeType)
    const merged = { ...(r.analysis_result as Record<string, unknown>), focal_point: fresh.focal_point ?? { x: 0.5, y: 0.5 } }
    const { error } = await db.from(table).update({ analysis_result: merged }).eq("id", r.id)
    if (!error) updated++
  }
  return { scanned: needing.length, updated }
}

type SnapshotRow = { id: string; raw_data: { recentPosts?: Array<Record<string, unknown>> } | null }

/** Re-analyze social posts whose stored visual analysis predates focal detection. Merges
 *  focalPoint into each post's visualAnalysis and rewrites the snapshot's raw_data. */
export async function refreshSocialFocal(client: unknown, limit: number): Promise<RefreshResult> {
  const db = client as LooseClient
  const { data } = await db.from("social_snapshots").select("id, raw_data").limit(500)
  const snaps = (data ?? []) as SnapshotRow[]

  let budget = limit
  let updated = 0
  let scanned = 0
  for (const snap of snaps) {
    if (budget <= 0) break
    const posts = snap.raw_data?.recentPosts
    if (!Array.isArray(posts)) continue
    let changed = false
    for (const p of posts) {
      if (budget <= 0) break
      const va = p.visualAnalysis as (Record<string, unknown> & { focalPoint?: unknown }) | undefined
      const mediaUrl = typeof p.mediaUrl === "string" ? p.mediaUrl : null
      if (!va || va.focalPoint || !mediaUrl || !mediaUrl.includes("supabase")) continue
      scanned++
      const dl = await download(mediaUrl)
      if (!dl) continue
      const platform = typeof p.platform === "string" ? p.platform : "instagram"
      const text = typeof p.text === "string" ? p.text : null
      const fresh = await analyzeSocialPostImage(dl.buffer, dl.mimeType, text, platform)
      if (fresh.focalPoint) {
        va.focalPoint = fresh.focalPoint
        changed = true
        updated++
        budget--
      }
    }
    if (changed) await db.from("social_snapshots").update({ raw_data: snap.raw_data as Record<string, unknown> }).eq("id", snap.id)
  }
  return { scanned, updated }
}
