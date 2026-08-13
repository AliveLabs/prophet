// ---------------------------------------------------------------------------
// POST /api/onboarding/first-run — the first-run fast path (beta rescue 3.1).
//
// Drains ONE brand-new location's first-run jobs immediately instead of waiting for the */5 cron
// tick and its place in the fleet-wide, created_at-ordered queue. See lib/jobs/first-run-drain.ts
// for why that ordering strands a new signup, and for why this is the same worker rather than a
// second one.
//
// FIRST RUN ONLY, three ways: the drain can only claim jobs scoped `first_run`, `enqueueFirstRun`
// creates those once per location, and this route refuses outright once the location has a brief.
// A location that already has briefs therefore behaves exactly as it does today.
//
// AUTH: the signed-in operator whose org owns the location (this is called from their own build
// screen), or CRON_SECRET for ops. Membership is checked against the location's org — never
// against a caller-supplied org id.
//
// SPEND: gated by the SAME fleet daily cap the build-brief cron checks, for the same reason —
// this is an entry point that starts model work, and once the fleet tripwire is out nothing
// should keep spending. It fails OPEN on a query error, like every other read of that cap.
// ---------------------------------------------------------------------------

import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { hasAnyBrief } from "@/lib/insights/daily-brief"
import { drainFirstRun } from "@/lib/jobs/first-run-drain"
import { checkFleetSpend, describeFleetSpend } from "@/lib/ai/fleet-budget"

// Same budget as the cron worker: this runs whole pipelines, including the brief synthesis.
export const maxDuration = 800

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

export async function POST(request: Request) {
  const url = new URL(request.url)
  const locationId =
    url.searchParams.get("location_id")?.trim() ||
    (await request
      .json()
      .then((b: unknown) => (b as { location_id?: string } | null)?.location_id?.trim() ?? "")
      .catch(() => ""))
  if (!locationId) return json({ ok: false, message: "Missing location_id" }, 400)

  const admin = createAdminSupabaseClient()

  const { data: location } = await admin
    .from("locations")
    .select("organization_id")
    .eq("id", locationId)
    .maybeSingle()
  if (!location) return json({ ok: false, message: "Location not found" }, 404)

  // ── auth ──
  const cronSecret = process.env.CRON_SECRET
  const isCron = !!cronSecret && request.headers.get("authorization") === `Bearer ${cronSecret}`
  if (!isCron) {
    const supabase = await createServerSupabaseClient()
    const { data: auth } = await supabase.auth.getUser()
    if (!auth?.user) return json({ ok: false, message: "Unauthorized" }, 401)
    const { data: membership } = await admin
      .from("organization_members")
      .select("id")
      .eq("organization_id", location.organization_id)
      .eq("user_id", auth.user.id)
      .maybeSingle()
    if (!membership) return json({ ok: false, message: "Forbidden" }, 403)
  }

  // ── first-run only ──
  if (await hasAnyBrief(locationId)) {
    return json({ ok: true, ran: 0, moreWork: false, reason: "already_briefed" })
  }

  // ── fleet daily cap (hard stop, fails open) ──
  const spend = await checkFleetSpend(admin)
  if (spend.exceeded) {
    console.error(`[first-run] HALTED for ${locationId}: ${describeFleetSpend(spend)}`)
    return json({ ok: true, ran: 0, moreWork: true, halted: "fleet_daily_cap" })
  }

  try {
    const result = await drainFirstRun(admin, locationId)
    console.log(
      `[first-run] ${locationId}: ran=${result.ran.length} deferred=${result.deferred} moreWork=${result.moreWork}`,
      result.ran.map((r) => `${r.pipeline}:${r.outcome}/${r.disposition}`).join(" "),
    )
    return json({
      ok: true,
      ran: result.ran.length,
      deferred: result.deferred,
      moreWork: result.moreWork,
      pipelines: result.ran.map((r) => ({ pipeline: r.pipeline, outcome: r.outcome })),
    })
  } catch (err) {
    console.error(`[first-run] fatal for ${locationId}:`, err)
    // Never fatal for the operator: the cron worker still drains this location on its next tick.
    return json({ ok: false, message: err instanceof Error ? err.message : "drain failed" }, 500)
  }
}
