// ---------------------------------------------------------------------------
// GET /api/cron/daily
// Daily orchestrator – refreshes all data for active locations
// Designed to be called by Vercel Cron, pg_cron, or any scheduler.
// Auth: requires CRON_SECRET header or valid Supabase service key.
// ---------------------------------------------------------------------------

import { createClient } from "@supabase/supabase-js"
import { isWeeklyFullBuildDay, isSeoDue, shouldRunDailyForLocation } from "@/lib/jobs/build-schedule"
import type { Database } from "@/types/database.types"
import { TIER_LIMITS, asSubscriptionTier, type SubscriptionTier } from "@/lib/billing/tiers"
import { isRunDueToday } from "@/lib/billing/limits"
import { isTrialActive } from "@/lib/billing/trial"
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
    .select("id, name, organization_id, timezone, daily_runs_enabled")
  if (singleLocationId) locationQuery = locationQuery.eq("id", singleLocationId)

  const { data: locations, error: locErr } = await locationQuery

  if (locErr || !locations) {
    return Response.json(
      { error: "Failed to fetch locations", details: locErr?.message },
      { status: 500 }
    )
  }

  const orgIds = [...new Set(locations.map((l) => l.organization_id))]
  const { data: orgs, error: orgErr } = await supabase
    .from("organizations")
    .select("id, subscription_tier, trial_ends_at, payment_state")
    .in("id", orgIds)
    .is("deleted_at", null)
  // ALT-743: unchecked, and this is the ENTITLEMENT ALLOWLIST for the whole nightly sweep. On a
  // read failure both maps came out empty, so every location hit the `!orgTrial` guard below and
  // was reported as "Org deleted or inaccessible". The fleet went dark and the response described
  // it as a normal night where every org happened to be deleted.
  //
  // The guard below is right about soft-deleted orgs and wrong to also absorb this: "this org is
  // gone" and "I could not read any org" are different answers. Fail loudly, matching the
  // `locations` read directly above.
  if (orgErr || !orgs) {
    console.error(`[Cron] entitlement allowlist read failed: ${orgErr?.code ?? ""} ${orgErr?.message ?? "no rows"}`)
    return Response.json(
      { error: "Failed to resolve active organizations", details: orgErr?.message },
      { status: 500 },
    )
  }

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
  let enqueueFailures = 0

  for (const location of locations) {
    // Per-location pause (ALT: beta-rescue 1.1). Mainly for demo orgs: turns off the daily
    // machine without deleting the location/org, so it stops costing money on data pulls.
    // An explicit `?location_id=` request overrides the pause: a deliberate ops action
    // beats the nightly sweep's own opinion, same polarity as the weekly-tier/SEO bypasses
    // below.
    if (!shouldRunDailyForLocation(location.daily_runs_enabled, { explicitLocationId: !!singleLocationId })) {
      jobs.push({
        location_id: location.id,
        location_name: location.name,
        pipelines: [],
        skipped_reason: "Daily runs disabled for this location",
      })
      continue
    }

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

    // An explicitly named single location skips the cadence gate: that request is a
    // deliberate human/ops action, not the nightly sweep deciding whose turn it is.
    //
    // ALT-683 — THIS GATE IS THE PRODUCT DIFFERENCE WE SELL. Skipping here skips the whole
    // location: no pipelines, no brief. So `runCadence` is what makes a Starter location
    // weekly and a Standard location daily, and that gap is the entire justification for the
    // price difference ($23.27/location/month weekly vs $73.25 daily, measured).
    //
    // It used to read `limits.eventsCadence`, a field filed under "internal pipeline tuning
    // (not sold)", while the field named `briefingCadence` in the sold block enforced nothing.
    // Anyone tidying `eventsCadence` down to "only gate the events pipeline" would have
    // silently flipped Starter to daily briefs at 3x cost, with no alert and no test to catch
    // it. There is now one honestly-named field, one pure predicate (`isRunDueToday`, so the
    // gate is testable rather than inlined here), and a test tying that predicate to the
    // billing tiles that promise it. Do not reintroduce a second cadence field for this.
    if (!isRunDueToday(limits.runCadence, dayOfWeek, { forced: !!singleLocationId })) {
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
    // ALT-684 / ALT-688 — no trial bypass. A trial used to force a DAILY search pull, which no
    // paid tier gets at any price (mid is weekly, the old top was biweekly). Confirmed in prod:
    // visibility_runs == locations every single day from 2026-06-18 to 2026-08-19. At the measured
    // $1.13/location-day that is $15.82 of search data per 14-day trial against ~$4.14 at weekly,
    // so ~$11.68 wasted per trial, or roughly $58 per acquired customer at 20% conversion.
    //
    // `singleLocationId` still forces: that is a human asking for one location, not the sweep.
    const seoDue = isSeoDue(limits.seoCadence, dayOfWeek, { force: !!singleLocationId })

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
      // ALT-714: this caught, logged a warning, and then FELL THROUGH to the jobs.push below,
      // which reports the full computed pipeline list. So a location whose enqueue threw was
      // reported as having every pipeline enqueued, and the route still answered ok: true. The
      // response was a description of what we INTENDED to enqueue, not what we enqueued.
      //
      // Now it records the failure against the location and moves on, so the response is a
      // record of what actually happened.
      enqueueFailures++
      console.error(`[Cron] Enqueue failed for ${location.name}:`, err)
      jobs.push({
        location_id: location.id,
        location_name: location.name,
        pipelines: [],
        skipped_reason: `Enqueue failed: ${err instanceof Error ? err.message : "unknown error"}`,
      })
      continue
    }

    jobs.push({
      location_id: location.id,
      location_name: location.name,
      pipelines: wantsInsights ? [...effectivePipelines, "insights"] : [...effectivePipelines],
    })
  }

  // ALT-714: `ok` was a literal. It is now a claim about the run, so an alert or a human reading
  // this can tell a clean sweep from one where every enqueue threw. `enqueued` counts locations
  // that actually got at least one job, which `locationsProcessed` never did: that counts rows in
  // the report, including every skip and every failure.
  return Response.json({
    ok: enqueueFailures === 0,
    dateKey,
    isMonday,
    locationsProcessed: jobs.length,
    enqueued: jobs.filter((j) => j.pipelines.length > 0).length,
    enqueueFailures,
    jobs,
  })
}
