import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { refreshPhotoFocal, refreshSocialFocal } from "@/lib/jobs/backfill/focal-refresh"

// One-time backfill of focal points onto images analyzed before PR #61 (see focal-refresh.ts).
// Bounded per run + idempotent, so it's safe to call repeatedly until every store drains.
// Trigger: npx tsx scripts/db/cron.mts backfill-focal --base https://app.getticket.ai [--param limit=60]
// NOTE: no `export const dynamic` — this project runs Next.js Cache Components, which forbids it
// (see app/api/health/pipeline/route.ts). Reading request.headers already makes this route dynamic.
export const maxDuration = 300

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Per-store per-run cap on vision calls (keeps us inside the function budget). Chunk across
  // runs by calling again until every store reports updated: 0.
  const limitParam = Number(new URL(request.url).searchParams.get("limit"))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 60

  const admin = createAdminSupabaseClient()
  const own = await refreshPhotoFocal(admin, "location_photos", limit)
  const competitor = await refreshPhotoFocal(admin, "competitor_photos", limit)
  const social = await refreshSocialFocal(admin, limit)

  const done = own.updated === 0 && competitor.updated === 0 && social.updated === 0
  return NextResponse.json({ ok: true, limit, own, competitor, social, done })
}
