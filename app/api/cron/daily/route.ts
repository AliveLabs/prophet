// ---------------------------------------------------------------------------
// GET /api/cron/daily
// Daily orchestrator – refreshes all data for active locations
// Designed to be called by Vercel Cron, pg_cron, or any scheduler.
// Auth: requires CRON_SECRET header or valid Supabase service key.
// ---------------------------------------------------------------------------

import { createClient } from "@supabase/supabase-js"
import { isWeeklyFullBuildDay, isSeoDue } from "@/lib/jobs/build-schedule"
import type { Database } from "@/types/database.types"
import { TIER_LIMITS, asSubscriptionTier, type SubscriptionTier } from "@/lib/billing/tiers"
import { isTrialActive, isTrialing } from "@/lib/billing/trial"
import { enqueueRun, DAILY_PIPELINES } from "@/lib/jobs/queue"

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

  // ── Manual scoping levers (2026-08-10) ────────────────────────────────────
  // This route used to be all-or-nothing: it enqueued every active location's full
  // pipeline set, with no way to refresh ONE restaurant. During the events-source
  // outage that meant the only way to recover a single location was a fleet-wide run.
  // It is also the shape real per-client work needs ("re-pull just this store").
  //
  //   ?location_id=<uuid>          scope to one location
  //   ?pipelines=events,weather    scope which pipelines run (comma-separated)
  //
  // An explicitly requested single location BYPASSES the weekly-tier cadence gate:
  // asking for a named location by hand is a deliberate act, not the nightly sweep.
  // Unknown pipeline names are rejected rather than silently dropped, so a typo
  // cannot quietly produce a no-op run that looks like a success.
  const url = new URL(req.url)
  const singleLocationId = url.searchParams.get("location_id")
  const pipelinesParam = url.searchParams.get("pipelines")
  const pipelineOverride = pipelinesParam
    ? pipelinesParam.split(",").map((p) => p.trim()).filter(Boolean)
    : null

  if (pipelineOverride) {
    const unknown = pipelineOverride.filter(
      (p) => !(DAILY_PIPELINES as readonly string[]).includes(p) && p !== "photos" && p !== "busy_times",
    )
    if (unknown.length > 0) {
      return Response.json(
        { error: "Unknown pipeline(s)", unknown, allowed: [...DAILY_PIPELINES, "photos", "busy_times"] },
        { status: 400 },
      )
    }
  }

  let locationQuery = supabase
    .from("locations")
    .select("id, name, organization_id, timezone")
  if (singleLocationId) locationQuery = locationQuery.eq("id", singleLocationId)

  const { data: locations, error: locErr } = await locationQuery

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
    .is("deleted_at", null)

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
    // Allowlist: the orgs query excludes soft-deleted (deleted_at) orgs, so an absent entry
    // means "don't process". Without this guard a deleted org would fall through to the
    // 'entry' default and run the full pipeline (matches build-brief / weekly-digest).
    if (!orgTrial) {
      jobs.push({
        location_id: location.id,
        location_name: location.name,
        pipelines: [],
        skipped_reason: "Org deleted or inaccessible",
      })
      continue
    }
    if (!isTrialActive(orgTrial)) {
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
    // An explicitly named single location skips the cadence gate: that request is a
    // deliberate human/ops action, not the nightly sweep deciding whose turn it is.
    const isWeeklyOnly = limits.eventsCadence === "weekly" && !inActiveTrial && !singleLocationId
    if (isWeeklyOnly && !isMonday) {
      jobs.push({
        location_id: location.id,
        location_name: location.name,
        pipelines: [],
        skipped_reason: "Weekly tier – runs on Mondays only",
      })
      continue
    }

    // SEO/visibility ran DAILY for every location while every tier declared it weekly, and while
    // the cost model priced it weekly. `seoCadence` existed in TIER_LIMITS and was read by exactly
    // one thing: lib/billing/cost-model.ts, to PROJECT cost. No pipeline code enforced it, so the
    // projection and the bill were describing different systems.
    //
    // Measured 2026-08-10: 127 snapshots per SEO provider across ~9 days for 14 locations, i.e. one
    // per location per day, against RUNS_PER_MONTH { daily: 30, weekly: 4.3 }. Roughly 7x the
    // modelled rate on the largest vendor line, which is what a $50 balance recharging every 3-5
    // days was actually paying for.
    //
    // Honor the tier here. Nothing customer-facing reads DataForSEO live: the /visibility page and
    // the seo_* insight rules both read stored snapshots, so this changes freshness, not features.
    //   weekly   → Mondays
    //   biweekly → "2x / week" per the type comment: Mondays + Thursdays
    // Trials and an explicitly requested single location bypass, exactly like the events gate above.
    const seoDue = isSeoDue(limits.seoCadence, dayOfWeek, {
      force: inActiveTrial || !!singleLocationId,
    })

    const pipelines = [
      ...(seoDue ? ["visibility"] : []),
      "events",
      "weather",
    ]

    // Differential builds Phase 2 — content is the heaviest chain (map site → scrape+screenshot →
    // LLM menu extract → Google enrichment → competitor menus) for data that changes ~monthly, yet it
    // ran DAILY. Now: weekly, on the Sunday-local full-refresh day (Bryan 2026-07-07; same day the
    // brief engine does its full non-differential rebuild). Onboarding (first_run) still does a full
    // content pull, so a new signup never waits for Sunday; a mid-week menu change lands ≤7 days.
    if (isWeeklyFullBuildDay(location.timezone, new Date())) {
      pipelines.unshift("content")
    }

    // Photos and busy_times run weekly regardless of tier
    if (isMonday) {
      pipelines.push("photos", "busy_times")
    }

    // Social runs daily too. The legacy inline refresh_all ran ALL sub-pipelines
    // implicitly; the durable queue only runs what is enqueued, so list social here.
    pipelines.push("social")

    // `?pipelines=` replaces the computed set entirely, so a targeted refresh runs ONLY
    // what was asked for (e.g. `events` alone) instead of dragging the full daily sweep
    // along with it. `insights` is handled separately below and is filtered out here.
    const effectivePipelines = pipelineOverride
      ? pipelineOverride.filter((p) => p !== "insights")
      : pipelines
    const wantsInsights = pipelineOverride ? pipelineOverride.includes("insights") : true
    if (effectivePipelines.length === 0 && !wantsInsights) {
      jobs.push({
        location_id: location.id,
        location_name: location.name,
        pipelines: [],
        skipped_reason: "Pipeline filter matched nothing for this location",
      })
      continue
    }

    // Durable enqueue — replaces the fire-and-forget refresh_all that ran all 8
    // pipelines sequentially in one 300s function and was killed mid-run. The worker
    // (/api/cron/worker) drains the queue one pipeline at a time and records honest
    // pipeline_runs outcomes. `insights` is delayed so its data inputs land first.
    try {
      if (effectivePipelines.length > 0) {
        await enqueueRun(supabase, {
          runId,
          organizationId: location.organization_id,
          locationId: location.id,
          pipelines: effectivePipelines,
        })
      }
      if (wantsInsights) {
        await enqueueRun(supabase, {
          runId,
          organizationId: location.organization_id,
          locationId: location.id,
          pipelines: ["insights"],
          // A targeted single-location refresh should not wait 15 minutes for its
          // insights; the data pipelines ahead of it are a handful of jobs, not a fleet.
          delaySeconds: singleLocationId ? 60 : 15 * 60,
        })
      }
    } catch (err) {
      console.warn(`[Cron] Enqueue failed for ${location.name}:`, err)
    }

    jobs.push({
      location_id: location.id,
      location_name: location.name,
      pipelines: wantsInsights ? [...effectivePipelines, "insights"] : [...effectivePipelines],
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
