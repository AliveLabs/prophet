import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { refreshLocationReviews } from "@/lib/jobs/backfill/reviews-refresh"

// Weekly Outscraper review backfill: seed each location's real review history once,
// then newest-N top-ups (see lib/jobs/backfill/reviews-refresh). Bounded per run +
// idempotent, so the Monday schedule (0 8-11 * * 1) can fire a few times and drain
// via `done` — a marker snapshot per location prevents same-week re-pulls.
// Mirrors app/api/cron/backfill-focal/route.ts.
// NOTE: no `export const dynamic` — this project runs Next.js Cache Components, which
// forbids it; reading request.headers already makes this route dynamic.
export const maxDuration = 300

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Optional overrides (?max, ?seedLimit, ?topupLimit). `max` bounds locations per
  // run to stay inside the function budget; call again until `done` for the rest.
  const params = new URL(request.url).searchParams
  const num = (k: string) => {
    const n = Number(params.get(k))
    return Number.isFinite(n) && n > 0 ? n : undefined
  }

  const admin = createAdminSupabaseClient()
  const result = await refreshLocationReviews(admin, {
    max: num("max"),
    seedLimit: num("seedLimit"),
    topupLimit: num("topupLimit"),
  })
  return NextResponse.json({ ok: true, ...result })
}
