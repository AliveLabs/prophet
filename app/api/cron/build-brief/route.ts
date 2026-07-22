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
import { shouldEnqueueBriefNow, resolveBuildHour, resolveCatchupHours, briefJitterSeconds } from "@/lib/jobs/build-schedule"

export const maxDuration = 800 // inline single-location mode still does LLM work

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(req.url)
  const single = url.searchParams.get("location_id")
  const sb = createAdminSupabaseClient()

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
    .select("id, organization_id, timezone")
  if (locErr || !locations) {
    return Response.json({ error: "Failed to list locations", details: locErr?.message }, { status: 500 })
  }

  // Most recent brief date_key per location (self-heal gate reads this to skip locations already
  // built for their local "today"). 36h back covers every timezone's current local day.
  const sinceDate = new Date(now.getTime() - 36 * 3600 * 1000).toISOString().slice(0, 10)
  const { data: briefRows } = await sb
    .from("daily_briefs")
    .select("location_id, date_key")
    .gte("date_key", sinceDate)
  const lastBriefByLoc = new Map<string, string>()
  for (const r of briefRows ?? []) {
    const loc = r.location_id as string
    const dk = r.date_key as string
    const cur = lastBriefByLoc.get(loc)
    if (!cur || dk > cur) lastBriefByLoc.set(loc, dk)
  }

  const orgIds = [...new Set(locations.map((l) => l.organization_id))]
  const { data: orgs } = await sb
    .from("organizations")
    .select("id, subscription_tier, trial_ends_at, payment_state")
    .in("id", orgIds)
    .is("deleted_at", null)
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
  for (const loc of locations) {
    if (!activeOrgs.has(loc.organization_id)) {
      inactive++
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
      console.warn(`[build-brief] enqueue failed for ${loc.id}:`, err)
    }
  }

  return Response.json({ ok: true, mode: force ? "enqueue-forced" : "enqueue", buildHour, enqueued, skipped, offHour, inactive })
}
