// ---------------------------------------------------------------------------
// GET /api/cron/build-brief
// Daily brief scheduling. Two modes:
//   - no params: runs HOURLY (see vercel.json) and ENQUEUES one durable `brief` job per active-org
//     location WHOSE LOCAL CLOCK reads the build hour (default 3 AM, per locations.timezone). This
//     staggers the fleet across time zones — each hourly tick fires only the zone hitting 3 AM, not
//     the whole fleet at once (Vercel crons are UTC-only, so a single fixed time was one big burst
//     that self-contends at scale). The worker builds them — each with its own 800s budget, retries,
//     zombie reclaim, honest pipeline_runs outcomes. (Replaces the inline build-all loop, which hit
//     this route's 800s ceiling at ~8 locations — 2026-06-12 Cane's incident.) The 1-hour-wide local
//     gate enqueues each location exactly once/day; `enqueueBriefIfMissing` guards double-fires.
//   - ?force=1: enqueue ALL active locations NOW regardless of local hour (manual fleet re-render).
//   - ?location_id=...: build that ONE location inline (manual ops lever; fits the budget comfortably).
// Auth: Bearer CRON_SECRET (mirrors /api/cron/daily).
// ---------------------------------------------------------------------------

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { buildDossier } from "@/lib/insights/dossier/build"
import { runBrief } from "@/lib/skills/pipeline"
import { saveBrief, loadPreviousBuild } from "@/lib/insights/daily-brief"
import { loadActiveCooldowns, loadEvergreenPlays } from "@/lib/insights/evergreen"
import { loadPlayTypeMultipliersForLocation, loadShadowPlayTypeMultipliers } from "@/lib/skills/feedback-rollup"
import { PRODUCER_SKILLS } from "@/lib/skills/registry"
import { runStandingQuestion } from "@/lib/ask/history"
import { enqueueBriefIfMissing } from "@/lib/jobs/queue"
import type { SB } from "@/lib/jobs/queue"
import { isTrialActive } from "@/lib/billing/trial"
import { shouldEnqueueBriefNow, resolveBuildHour, resolveCatchupHours, briefJitterSeconds, shouldRunDailyForLocation } from "@/lib/jobs/build-schedule"
import { checkFleetSpend, describeFleetSpend, type FleetBudgetStore } from "@/lib/ai/fleet-budget"
import { postSlackAlert } from "@/lib/ops/slack"

export const maxDuration = 800 // inline single-location mode still does LLM work

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(req.url)
  const single = url.searchParams.get("location_id")
  const sb = createAdminSupabaseClient()

  // ── Fleet daily spend cap (ALT-543 step 7) ───────────────────────────────
  // Gated HERE, where builds are started, rather than inside the pipeline: the build step is
  // `critical: true`, so throwing there would fail the job and retry it forever against a cap that
  // is not going to move until tomorrow. Refusing to start is the clean hard stop.
  //
  // A hard stop, unlike the per-brief ceiling's degrade: fleet-wide, something is already wrong, and
  // the useful behaviour is to stop digging and tell a human. Disabled unless the env var is set,
  // and fails OPEN on any query problem (see lib/ai/fleet-budget.ts).
  // `?ignoreCap=1` is a deliberate human override, kept separate from `?force=1` so a routine fleet
  // re-render cannot silently blow through the tripwire.
  if (url.searchParams.get("ignoreCap") !== "1") {
    const spend = await checkFleetSpend(sb as unknown as FleetBudgetStore)
    if (spend.exceeded) {
      const msg = `Ticket build-brief HALTED for today: ${describeFleetSpend(spend)}. No briefs will build until the UTC day rolls over or the cap is raised (ANTHROPIC_FLEET_DAILY_CAP_USD), or re-run with ?ignoreCap=1.`
      console.error(`[build-brief] ${msg}`)
      await postSlackAlert(msg)
      return Response.json({ halted: "fleet_daily_cap", spentUsd: spend.spentUsd, capUsd: spend.capUsd, briefs: spend.briefs }, { status: 200 })
    }
    if (spend.capUsd !== null) console.log(`[build-brief] ${describeFleetSpend(spend)}`)
  }

  // ── Inline mode: build one location now ──────────────────────────────────
  if (single) {
    try {
      const dossier = await buildDossier(single)
      // P7a/P7b: dismissal cooldown + evergreen resurfacing (both fail-soft).
      // P15: distilled click-feedback multiplier lookup (fail-soft → neutral pre-migration).
      // P17a: shadow multiplier set (shadow feedback_pattern learnings) — replayed + logged, never served.
      const skillIds = PRODUCER_SKILLS.map((s) => s.id)
      const [suppressedKeys, evergreen, playTypeMultipliers, shadow] = await Promise.all([
        loadActiveCooldowns(single),
        loadEvergreenPlays(single),
        loadPlayTypeMultipliersForLocation(single, skillIds),
        loadShadowPlayTypeMultipliers(skillIds, { locationId: single }),
      ])
      // Differential builds: ?fullBuild=1 forces every expert to run (all other gates inside).
      const previous = await loadPreviousBuild(single, dossier.dateKey, { force: url.searchParams.get("fullBuild") === "1" })
      const { brief, dropped } = await runBrief(dossier, {
        previous,
        suppressedKeys,
        evergreen,
        playTypeMultipliers,
        shadowMultipliers: shadow.lookup,
        shadowSignalCount: shadow.signalCount,
      })
      await saveBrief(brief)
      // Pinned standing question re-runs on the fresh signals, right after the brief.
      const standing = await runStandingQuestion(single)
      return Response.json({
        built: 1,
        results: [{ locationId: single, ok: true, headline: brief.headline, plays: brief.plays.length, dropped: dropped.length, standing }],
      })
    } catch (err) {
      return Response.json({
        built: 0,
        results: [{ locationId: single, ok: false, error: err instanceof Error ? err.message : "failed" }],
      })
    }
  }

  // ── Scheduled mode: enqueue a brief job per active-org location AT ITS LOCAL BUILD HOUR ──────────
  // Runs hourly; `force=1` bypasses the local-hour gate to enqueue the whole fleet now (manual re-render).
  const force = url.searchParams.get("force") === "1"
  const now = new Date()
  const buildHour = resolveBuildHour()
  const catchupHours = resolveCatchupHours()
  const { data: locations, error: locErr } = await sb
    .from("locations")
    .select("id, organization_id, timezone, daily_runs_enabled")
  if (locErr || !locations) {
    return Response.json({ error: "Failed to list locations", details: locErr?.message }, { status: 500 })
  }

  // Most recent brief date_key per location (self-heal gate reads this to skip locations already
  // built for their local "today"). 36h back covers every timezone's current local day.
  const sinceDate = new Date(now.getTime() - 36 * 3600 * 1000).toISOString().slice(0, 10)
  const { data: briefRows, error: briefErr } = await sb
    .from("daily_briefs")
    .select("location_id, date_key")
    .gte("date_key", sinceDate)
  // ALT-746: this read was unchecked, and it is the SELF-HEAL GATE's only memory of what has
  // already been built. On a read failure the map came out empty, every location looked unbuilt,
  // and every remaining catch-up hour in the window rebuilt the same brief at full model cost
  // (~$1.77 each, up to 3 extra per location per day).
  //
  // Deliberately FAIL-OPEN rather than 500, and for the same reason the fleet cap fails open:
  // refusing to build because a SELECT failed is a worse outage than the overspend it prevents.
  // But it must be VISIBLE, which is the part that was missing. A duplicate-build storm with no
  // trace is indistinguishable from the pipeline simply being expensive.
  if (briefErr) {
    console.error(
      `[build-brief] SELF-HEAL GATE BLIND: daily_briefs read failed (${briefErr.code ?? ""} ${briefErr.message}). ` +
        `Proceeding, but every location will look unbuilt, so this tick may rebuild briefs that already exist.`,
    )
  }
  const lastBriefByLoc = new Map<string, string>()
  for (const r of briefRows ?? []) {
    const loc = r.location_id as string
    const dk = r.date_key as string
    const cur = lastBriefByLoc.get(loc)
    if (!cur || dk > cur) lastBriefByLoc.set(loc, dk)
  }

  const orgIds = [...new Set(locations.map((l) => l.organization_id))]
  const { data: orgs, error: orgErr } = await sb
    .from("organizations")
    .select("id, subscription_tier, trial_ends_at, payment_state")
    .in("id", orgIds)
    .is("deleted_at", null)
  // ALT-743: this read was unchecked, and it is the ENTITLEMENT ALLOWLIST. On failure `orgs` came
  // back null, `activeOrgs` came out EMPTY, every location failed the `activeOrgs.has(...)` test,
  // and the route returned `ok: true` with `enqueued: 0` and `inactive: <the whole fleet>`. One
  // transient failure on one read silently produced zero briefs fleet-wide, and the response said
  // it worked. "Nobody is entitled" and "I could not find out who is entitled" are different
  // answers and this collapsed them.
  //
  // 500 rather than fail-open, matching the `locations` read twenty lines above, which already
  // does exactly this. Fail-open here would mean treating every org as entitled and building
  // briefs for orgs that are not paying, so neither direction is safe silently. This is NOT the
  // deliberate fail-open CLAUDE.md protects: that one is the fleet spend cap at the top of this
  // file, a different read, and it is left alone.
  if (orgErr || !orgs) {
    console.error(`[build-brief] entitlement allowlist read failed: ${orgErr?.code ?? ""} ${orgErr?.message ?? "no rows"}`)
    return Response.json(
      { error: "Failed to resolve active organizations", details: orgErr?.message },
      { status: 500 },
    )
  }
  const activeOrgs = new Set(
    (orgs ?? [])
      .filter((o) =>
        isTrialActive({
          subscription_tier: o.subscription_tier ?? "entry",
          trial_ends_at: o.trial_ends_at,
          payment_state: o.payment_state ?? null,
        })
      )
      .map((o) => o.id)
  )

  let enqueued = 0
  let skipped = 0
  let inactive = 0
  let offHour = 0
  let paused = 0
  let failed = 0
  for (const loc of locations) {
    if (!activeOrgs.has(loc.organization_id)) {
      inactive++
      continue
    }
    // Per-location pause (beta-rescue 1.1): scheduled mode honors it so a paused demo
    // location stops costing brief-build spend. `force=1` (fleet re-render) is a scoped
    // scheduling bypass, not a per-location one, so it does NOT override the pause.
    // Only an explicit `?location_id=` inline build (handled above, before this loop) does.
    if (!shouldRunDailyForLocation(loc.daily_runs_enabled)) {
      paused++
      continue
    }
    // Timezone stagger + self-heal: enqueue when the location's local clock is within the catch-up
    // window opening at its build hour AND it hasn't built for its local "today" yet (unless forced).
    // Normal day: the build-hour tick enqueues, later ticks skip (already built). Missed/blipped tick:
    // the next tick in the window catches it up SAME day, instead of the whole zone skipping until
    // tomorrow (the recurring "no brief in 26h" page).
    if (
      !force &&
      !shouldEnqueueBriefNow(loc.timezone, now, {
        buildHour,
        catchupHours,
        lastBriefDateKey: lastBriefByLoc.get(loc.id) ?? null,
      })
    ) {
      offHour++
      continue
    }
    try {
      const result = await enqueueBriefIfMissing(sb as unknown as SB, {
        organizationId: loc.organization_id,
        locationId: loc.id,
        // The daily rebuild must enqueue even though yesterday's job exists;
        // only an ACTIVE (queued/running) job should skip.
        recentWindowMinutes: 0,
        // WITHIN-zone stagger: space this tick's jobs a few minutes apart so one zone's build hour
        // doesn't build every brief at once (2026-07-07: 7 simultaneous builds → sustained burst →
        // timeout-fallbacks on 31% of producer slots). Forced runs are manual → no delay.
        delaySeconds: force ? 0 : briefJitterSeconds(enqueued),
      })
      if (result === "enqueued") enqueued++
      else skipped++
    } catch (err) {
      // ALT-714's shape, in build-brief: a throwing enqueue was counted as NEITHER enqueued nor
      // skipped, and the response still said ok: true. A location that silently failed to enqueue
      // every hour looked identical to one that was correctly off-hour.
      failed++
      console.warn(`[build-brief] enqueue failed for ${loc.id}:`, err)
    }
  }

  // `ok` now means what it says. A caller (or an alert) that trusted ok:true could not previously
  // tell a clean fleet-wide run from one where every single enqueue threw.
  return Response.json({
    ok: failed === 0,
    mode: force ? "enqueue-forced" : "enqueue",
    buildHour,
    enqueued,
    skipped,
    offHour,
    inactive,
    paused,
    failed,
    ...(briefErr ? { selfHealGateBlind: true } : {}),
  })
}
