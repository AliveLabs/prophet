// Onboarding processing status — real signal_jobs statuses for the latest
// first_run batch, so the final step shows honest progress instead of a
// fake timer. Auth: user must be a member of the org that owns the location
// (jobs are then read with the admin client).
//
// Beta rescue 3.1: it now also returns PROGRESSIVE VALUE, not just row statuses.
//   `signals`  what has actually landed so far (who we watch near you, what is on near you,
//              whether you show up in local search), each one honest about whether it is ready,
//              still working, genuinely empty, or unreadable. Rules live in
//              lib/onboarding/first-run-signals.ts (pure, unit-tested); this route only reads.
//   `starter`  the first-run starter insight once its producer has written one.
// Both surfaces that show first-run progress (the onboarding Build step and /home's first-run
// panel) poll this ONE endpoint, so they cannot tell the operator different stories.

import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import {
  summarizeFirstRunSignals,
  upcomingLocalEvents,
  type FirstRunSignal,
  type RawEventRead,
} from "@/lib/onboarding/first-run-signals"
import { STARTER_SNAPSHOT_PROVIDER, parseStoredStarter } from "@/lib/insights/starter-play"
import { selectProgressJobs, type ProgressJobRow } from "@/lib/onboarding/progress-jobs"
import { hasAnyBrief } from "@/lib/insights/daily-brief"
import type { NormalizedRankedKeyword } from "@/lib/seo/types"
import { pickLocalKeywords, localKeywordLabel } from "@/lib/seo/local-keywords"

const EVENTS_PROVIDER = "dataforseo_google_events"
const RANKED_KEYWORDS_PROVIDER = "seo_ranked_keywords"

function metersToMiles(meters: unknown): number | null {
  return typeof meters === "number" && Number.isFinite(meters) ? meters * 0.000621371 : null
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const locationId = searchParams.get("location_id")?.trim()
  if (!locationId) {
    return new Response(JSON.stringify({ ok: false, message: "Missing location_id" }), {
      status: 400,
    })
  }

  const supabase = await createServerSupabaseClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) {
    return new Response(JSON.stringify({ ok: false, message: "Unauthorized" }), {
      status: 401,
    })
  }

  const admin = createAdminSupabaseClient()
  const { data: location } = await admin
    .from("locations")
    .select("organization_id, city, region, postal_code, website")
    .eq("id", locationId)
    .maybeSingle()

  if (!location) {
    return new Response(JSON.stringify({ ok: false, message: "Location not found" }), {
      status: 404,
    })
  }

  const { data: membership } = await admin
    .from("organization_members")
    .select("id")
    .eq("organization_id", location.organization_id)
    .eq("user_id", auth.user.id)
    .maybeSingle()

  if (!membership) {
    return new Response(JSON.stringify({ ok: false, message: "Forbidden" }), {
      status: 403,
    })
  }

  // Newest job whose scope is first_run identifies the latest first-run batch.
  const { data: jobs, error } = await admin
    .from("signal_jobs")
    .select("run_id, pipeline, status, cursor, created_at")
    .eq("location_id", locationId)
    .order("created_at", { ascending: false })
    .limit(60)

  if (error) {
    return new Response(JSON.stringify({ ok: false, message: error.message }), {
      status: 500,
    })
  }

  // Which rows describe the first run — including the brief job, which usually lives under a
  // DIFFERENT run_id (the ALT-674 dedupe skips the same-run chain whenever /home's self-healing
  // enqueuer got there first). Rule is pure and pinned in lib/onboarding/progress-jobs.ts; when it
  // was run_id-only, the panel could never see the brief finish and never auto-swapped (Chris,
  // 2026-08-25: 22 minutes on "Queued" while the brief was already built).
  //
  // ALT-660: `runStartedAt` is the run's real start (earliest job in the batch), so the elapsed
  // clock is TOTAL run time, continuous across onboarding and /home, never time-since-mount.
  const { runJobs, runStartedAt } = selectProgressJobs((jobs ?? []) as ProgressJobRow[])

  // ── progressive value ──
  // Reads run together. They are cheap (indexed single-location lookups) and the payload
  // is what makes this screen worth watching.
  //
  // `briefReady` is the ground truth for "can the operator read a brief right now": a daily_briefs
  // row exists. The panel only renders while getBrief() returns null, so ANY row means a refresh
  // swaps it for the real brief. Job statuses stay the honest progress story; this is the swap/CTA
  // gate, because a brief can also arrive via a path whose job row the batch filter cannot see
  // (the build-brief cron), and the gate must not depend on which path won.
  const todayKey = new Date().toISOString().slice(0, 10)
  const [competitorRows, snapshotRows, briefReady] = await Promise.all([
    admin
      .from("competitors")
      .select("name, metadata, is_active")
      .eq("location_id", locationId)
      .eq("is_active", true),
    admin
      .from("location_snapshots")
      .select("provider, raw_data, date_key")
      .eq("location_id", locationId)
      .in("provider", [EVENTS_PROVIDER, RANKED_KEYWORDS_PROVIDER, STARTER_SNAPSHOT_PROVIDER])
      .order("date_key", { ascending: false }),
    hasAnyBrief(locationId),
  ])

  const competitors = (competitorRows.data ?? [])
    .filter((c) => (c.metadata as Record<string, unknown> | null)?.status === "approved")
    .map((c) => ({
      name: (c.name as string) ?? "Competitor",
      distanceMi: metersToMiles((c.metadata as Record<string, unknown> | null)?.distanceMeters),
    }))

  // Newest row per provider (rows are date desc, so first seen wins).
  const latestByProvider = new Map<string, Record<string, unknown>>()
  for (const row of snapshotRows.data ?? []) {
    const provider = row.provider as string
    if (latestByProvider.has(provider)) continue
    latestByProvider.set(provider, (row.raw_data as Record<string, unknown>) ?? {})
  }

  const eventsRaw = latestByProvider.get(EVENTS_PROVIDER)
  const events = eventsRaw
    ? upcomingLocalEvents(((eventsRaw.events as RawEventRead[]) ?? []), todayKey)
    : null

  const keywordsRaw = latestByProvider.get(RANKED_KEYWORDS_PROVIDER)
  const rankedKeywords = keywordsRaw ? ((keywordsRaw.keywords as NormalizedRankedKeyword[]) ?? []) : null
  // ALT-623: the card is titled "local search", so only searches that name this operator's area
  // (or ask for something near the searcher) may appear under it. The rule is in lib/seo/
  // local-keywords.ts, pure and unit-tested. The COUNT still covers every ranking; only the
  // examples are filtered, and each carries its position so the pill says something.
  const localSearch = rankedKeywords
    ? {
        rankedKeywordCount: rankedKeywords.length,
        localKeywords: pickLocalKeywords(rankedKeywords, {
          city: location.city as string | null,
          region: (location as Record<string, unknown>).region as string | null,
          postalCode: (location as Record<string, unknown>).postal_code as string | null,
        }).map(localKeywordLabel),
      }
    : null

  const signals: FirstRunSignal[] = summarizeFirstRunSignals({
    jobStatus: Object.fromEntries(runJobs.map((j) => [j.pipeline, j.status])),
    competitors,
    city: (location.city as string | null) ?? null,
    events,
    localSearch,
    hasWebsite: !!(location.website as string | null),
  })

  const starter = parseStoredStarter(latestByProvider.get(STARTER_SNAPSHOT_PROVIDER))

  return new Response(
    JSON.stringify({
      ok: true,
      jobs: runJobs,
      runStartedAt,
      briefReady,
      signals,
      starter: starter ? { play: starter.play, generatedAt: starter.generatedAt } : null,
    }),
    { status: 200 },
  )
}
