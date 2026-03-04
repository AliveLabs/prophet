// ---------------------------------------------------------------------------
// GET /api/cron/daily
// Daily orchestrator – refreshes all data for active locations
// Designed to be called by Vercel Cron, pg_cron, or any scheduler.
// Auth: requires CRON_SECRET header or valid Supabase service key.
// ---------------------------------------------------------------------------

import { createClient } from "@supabase/supabase-js"
import { TIER_LIMITS, type SubscriptionTier } from "@/lib/billing/tiers"

export const maxDuration = 300

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  return createClient(url, serviceKey, { auth: { persistSession: false } })
}

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = admin()
  const dayOfWeek = new Date().getUTCDay()
  const isMonday = dayOfWeek === 1
  const dateKey = new Date().toISOString().slice(0, 10)

  const { data: locations, error: locErr } = await supabase
    .from("locations")
    .select("id, name, organization_id")

  if (locErr || !locations) {
    return Response.json(
      { error: "Failed to fetch locations", details: locErr?.message },
      { status: 500 }
    )
  }

  const orgIds = [...new Set(locations.map((l) => l.organization_id))]
  const { data: orgs } = await supabase
    .from("organizations")
    .select("id, subscription_tier")
    .in("id", orgIds)

  const orgTierMap = new Map<string, SubscriptionTier>()
  for (const org of orgs ?? []) {
    orgTierMap.set(org.id, (org.subscription_tier ?? "free") as SubscriptionTier)
  }

  const jobs: Array<{
    location_id: string
    location_name: string | null
    pipelines: string[]
    skipped_reason?: string
  }> = []

  for (const location of locations) {
    const tier = orgTierMap.get(location.organization_id) ?? "free"
    const limits = TIER_LIMITS[tier]

    const isWeeklyOnly = limits.eventsCadence === "weekly"
    if (isWeeklyOnly && !isMonday) {
      jobs.push({
        location_id: location.id,
        location_name: location.name,
        pipelines: [],
        skipped_reason: "Weekly tier – runs on Mondays only",
      })
      continue
    }

    const pipelines = [
      "content",
      "visibility",
      "events",
      "weather",
    ]

    // Photos and busy_times run weekly regardless of tier
    if (isMonday) {
      pipelines.push("photos", "busy_times")
    }

    pipelines.push("insights")

    // Queue the refresh_all job via internal API
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000"

    try {
      const jobUrl = new URL(`/api/jobs/refresh_all`, baseUrl)
      jobUrl.searchParams.set("location_id", location.id)

      // Fire-and-forget – don't await the full pipeline
      fetch(jobUrl.toString(), {
        headers: {
          cookie: req.headers.get("cookie") ?? "",
          authorization: authHeader ?? "",
        },
      }).catch((err) => {
        console.warn(`[Cron] Failed to trigger refresh for ${location.name}:`, err)
      })
    } catch (err) {
      console.warn(`[Cron] Error building job URL for ${location.name}:`, err)
    }

    jobs.push({
      location_id: location.id,
      location_name: location.name,
      pipelines,
    })

    // Log the orchestration (best-effort)
    try {
      await supabase.from("refresh_jobs").insert({
        organization_id: location.organization_id,
        location_id: location.id,
        job_type: "refresh_all",
        status: "running",
        total_steps: pipelines.length,
        current_step: 0,
        steps: pipelines.map((p) => ({
          name: p,
          label: p,
          status: "queued",
        })),
      })
    } catch { /* non-fatal */ }
  }

  return Response.json({
    ok: true,
    dateKey,
    isMonday,
    locationsProcessed: jobs.length,
    jobs,
  })
}
