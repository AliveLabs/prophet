// ---------------------------------------------------------------------------
// Screenshot storage helpers – upload to Supabase Storage + signed URLs
// ---------------------------------------------------------------------------

import { createAdminSupabaseClient } from "@/lib/supabase/admin"

const BUCKET = "screenshots"

// ---------------------------------------------------------------------------
// Upload a base64 screenshot to Supabase Storage
// ---------------------------------------------------------------------------

export async function uploadScreenshot(
  base64Data: string,
  storagePath: string
): Promise<string | null> {
  try {
    const admin = createAdminSupabaseClient()

    // Strip data:image/...;base64, prefix if present
    const raw = base64Data.replace(/^data:image\/\w+;base64,/, "")
    const buffer = Buffer.from(raw, "base64")

    // Determine content type from path extension
    const ext = storagePath.split(".").pop()?.toLowerCase() ?? "png"
    const contentType =
      ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : ext === "webp"
          ? "image/webp"
          : "image/png"

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
