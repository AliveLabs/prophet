// ---------------------------------------------------------------------------
// GET /api/cron/daily
// Daily orchestrator – refreshes all data for active locations
// Designed to be called by Vercel Cron, pg_cron, or any scheduler.
// Auth: requires CRON_SECRET header or valid Supabase service key.
// ---------------------------------------------------------------------------

import { createClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database.types"
import { TIER_LIMITS, asSubscriptionTier, type SubscriptionTier } from "@/lib/billing/tiers"
import { isTrialActive, isTrialing } from "@/lib/billing/trial"
import { enqueueRun } from "@/lib/jobs/queue"

export const maxDuration = 300

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  return createClient<Database>(url, serviceKey, { auth: { persistSession: false } })
}

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = admin()
  const dayOfWeek = new Date().getUTCDay()
  const isMonday = dayOfWeek === 1
  const dateKey = new Date().toISOString().slice(0, 10)
  const runId = crypto.randomUUID() // groups this pass across signal_jobs + pipeline_runs

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
    .select("id, subscription_tier, trial_ends_at, payment_state")
    .in("id", orgIds)

  const orgTierMap = new Map<string, SubscriptionTier>()
  const orgTrialMap = new Map<
    string,
    { trial_ends_at: string | null; subscription_tier: string; payment_state: string | null }
  >()
  for (const org of orgs ?? []) {
    orgTierMap.set(org.id, asSubscriptionTier(org.subscription_tier))
    orgTrialMap.set(org.id, {
      trial_ends_at: org.trial_ends_at,
      subscription_tier: org.subscription_tier ?? "entry",
      payment_state: org.payment_state ?? null,
    })
  }

  const jobs: Array<{
    location_id: string
    location_name: string | null
    pipelines: string[]
    skipped_reason?: string
  }> = []

  for (const location of locations) {
    const orgTrial = orgTrialMap.get(location.organization_id)
    if (orgTrial && !isTrialActive(orgTrial)) {
      jobs.push({
        location_id: location.id,
        location_name: location.name,
        pipelines: [],
        skipped_reason: "Trial expired – no active subscription",
      })
      continue
    }

    const tier = orgTierMap.get(location.organization_id) ?? "entry"
    const limits = TIER_LIMITS[tier]

    // Active TRIALS run daily regardless of tier — a trial is an evaluation, and an
    // evaluator who sees data move only on Mondays churns. (Trials are of the mid
    // tier, which is daily anyway; this keeps legacy clock-trials on lower tiers daily.)
    const inActiveTrial = orgTrial ? isTrialing(orgTrial) : false
    const isWeeklyOnly = limits.eventsCadence === "weekly" && !inActiveTrial
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

    // Social runs daily too. The legacy inline refresh_all ran ALL sub-pipelines
    // implicitly; the durable queue only runs what is enqueued, so list social here.
    pipelines.push("social")

    // Durable enqueue — replaces the fire-and-forget refresh_all that ran all 8
    // pipelines sequentially in one 300s function and was killed mid-run. The worker
    // (/api/cron/worker) drains the queue one pipeline at a time and records honest
    // pipeline_runs outcomes. `insights` is delayed so its data inputs land first.
    try {
      await enqueueRun(supabase, {
        runId,
        organizationId: location.organization_id,
        locationId: location.id,
        pipelines,
      })
      await enqueueRun(supabase, {
        runId,
        organizationId: location.organization_id,
        locationId: location.id,
        pipelines: ["insights"],
        delaySeconds: 15 * 60,
      })
    } catch (err) {
      console.warn(`[Cron] Enqueue failed for ${location.name}:`, err)
    }

    jobs.push({
      location_id: location.id,
      location_name: location.name,
      pipelines: [...pipelines, "insights"],
    })
  }

  return Response.json({
    ok: true,
    dateKey,
    isMonday,
    locationsProcessed: jobs.length,
    jobs,
  })
}
