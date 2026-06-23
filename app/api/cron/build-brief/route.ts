// ---------------------------------------------------------------------------
// GET /api/cron/build-brief
// Daily brief scheduling. Two modes:
//   - no params: ENQUEUE one durable `brief` job per active-org location and
//     return immediately. The worker builds them — each with its own 800s
//     budget, retries, zombie reclaim, and honest pipeline_runs outcomes.
//     (Replaces the inline build-all loop, which hit THIS route's 800s ceiling
//     at ~8 locations and silently skipped the rest — 2026-06-12 Raising
//     Cane's incident: 7 of 14 briefs built, newest location got none.)
//   - ?location_id=...: build that ONE location inline (manual ops lever; one
//     location fits the budget comfortably).
// Auth: Bearer CRON_SECRET (mirrors /api/cron/daily).
// ---------------------------------------------------------------------------

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { buildDossier } from "@/lib/insights/dossier/build"
import { runBrief } from "@/lib/skills/pipeline"
import { saveBrief } from "@/lib/insights/daily-brief"
import { loadActiveCooldowns, loadEvergreenPlays } from "@/lib/insights/evergreen"
import { runStandingQuestion } from "@/lib/ask/history"
import { enqueueBriefIfMissing } from "@/lib/jobs/queue"
import type { SB } from "@/lib/jobs/queue"
import { isTrialActive } from "@/lib/billing/trial"

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
      const [suppressedKeys, evergreen] = await Promise.all([loadActiveCooldowns(single), loadEvergreenPlays(single)])
      const { brief, dropped } = await runBrief(dossier, { suppressedKeys, evergreen })
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

  // ── Scheduled mode: enqueue a brief job per active-org location ──────────
  const { data: locations, error: locErr } = await sb
    .from("locations")
    .select("id, organization_id")
  if (locErr || !locations) {
    return Response.json({ error: "Failed to list locations", details: locErr?.message }, { status: 500 })
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
  for (const loc of locations) {
    if (!activeOrgs.has(loc.organization_id)) {
      inactive++
      continue
    }
    try {
      const result = await enqueueBriefIfMissing(sb as unknown as SB, {
        organizationId: loc.organization_id,
        locationId: loc.id,
        // The daily rebuild must enqueue even though yesterday's job exists;
        // only an ACTIVE (queued/running) job should skip.
        recentWindowMinutes: 0,
      })
      if (result === "enqueued") enqueued++
      else skipped++
    } catch (err) {
      console.warn(`[build-brief] enqueue failed for ${loc.id}:`, err)
    }
  }

  return Response.json({ ok: true, mode: "enqueue", enqueued, skipped, inactive })
}
