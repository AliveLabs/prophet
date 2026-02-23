// ---------------------------------------------------------------------------
// Screenshot storage helpers – upload to Supabase Storage + signed URLs
// ---------------------------------------------------------------------------

import { createAdminSupabaseClient } from "@/lib/supabase/admin"

const BUCKET = "screenshots"

// ---------------------------------------------------------------------------
// Upload a screenshot to Supabase Storage
// Handles both URL (Firecrawl returns URLs) and base64 data
// ---------------------------------------------------------------------------

export async function uploadScreenshot(
  screenshotData: string,
  storagePath: string
): Promise<string | null> {
  try {
    const admin = createAdminSupabaseClient()
    let buffer: Buffer
    let contentType = "image/png"

    if (screenshotData.startsWith("http://") || screenshotData.startsWith("https://")) {
      // Firecrawl returns screenshots as hosted URLs – download the image
      const response = await fetch(screenshotData)
      if (!response.ok) {
        console.warn("Screenshot download failed:", response.status, screenshotData)
        return null
      }
      const ct = response.headers.get("content-type")
      if (ct && ct.startsWith("image/")) contentType = ct
      const arrayBuffer = await response.arrayBuffer()
      buffer = Buffer.from(arrayBuffer)
    } else if (screenshotData.startsWith("data:image/")) {
      // base64 data URL
      const raw = screenshotData.replace(/^data:image\/\w+;base64,/, "")
      buffer = Buffer.from(raw, "base64")
      const match = screenshotData.match(/^data:(image\/\w+);/)
      if (match) contentType = match[1]
    } else {
      // Raw base64 string (no prefix)
      buffer = Buffer.from(screenshotData, "base64")
    }

    if (buffer.length === 0) {
      console.warn("Screenshot buffer is empty")
      return null
    }

    const { error } = await admin.storage.from(BUCKET).upload(storagePath, buffer, {
      contentType,
      upsert: true,
    })

    if (error) {
      console.warn("Screenshot upload error:", error.message)
      return null
    }

    return storagePath
  } catch (err) {
    console.warn("Screenshot upload exception:", err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Generate a signed URL for a stored screenshot (1 hour expiry)
// ---------------------------------------------------------------------------

export async function getScreenshotUrl(storagePath: string): Promise<string | null> {
  try {
    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, 3600) // 1 hour

    if (error || !data?.signedUrl) {
      return null
    }

    return data.signedUrl
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Build a storage path for a screenshot
// ---------------------------------------------------------------------------

export function buildScreenshotPath(
  orgId: string,
  entityType: "locations" | "competitors",
  entityId: string,
  filename: string
): string {
  return `org/${orgId}/${entityType}/${entityId}/${filename}`
}
