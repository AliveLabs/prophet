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
import type { NormalizedRankedKeyword } from "@/lib/seo/types"

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
    .select("organization_id, city, website")
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
    .select("run_id, pipeline, status, cursor")
    .eq("location_id", locationId)
    .order("created_at", { ascending: false })
    .limit(60)

  if (error) {
    return new Response(JSON.stringify({ ok: false, message: error.message }), {
      status: 500,
    })
  }

  const isFirstRun = (cursor: unknown) =>
    typeof cursor === "object" &&
    cursor !== null &&
    (cursor as { mode?: string }).mode === "first_run"

  const latest = (jobs ?? []).find((j) => isFirstRun(j.cursor))
  const runJobs = latest
    ? (jobs ?? [])
        .filter((j) => j.run_id === latest.run_id)
        .map((j) => ({ pipeline: j.pipeline, status: j.status }))
    : []

  // ── progressive value ──
  // Three reads, run together. They are cheap (indexed single-location lookups) and the payload
  // is what makes this screen worth watching.
  const todayKey = new Date().toISOString().slice(0, 10)
  const [competitorRows, snapshotRows] = await Promise.all([
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
  const localSearch = rankedKeywords
    ? {
        rankedKeywordCount: rankedKeywords.length,
        topKeywords: rankedKeywords
          .slice()
          .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
          .slice(0, 3)
          .map((k) => k.keyword)
          .filter(Boolean),
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
      signals,
      starter: starter ? { play: starter.play, generatedAt: starter.generatedAt } : null,
    }),
    { status: 200 },
  )
}
