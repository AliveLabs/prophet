// Onboarding processing status — real signal_jobs statuses for the latest
// first_run batch, so the final step shows honest progress instead of a
// fake timer. Auth: user must be a member of the org that owns the location
// (jobs are then read with the admin client).

import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

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
    .select("organization_id")
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

  return new Response(JSON.stringify({ ok: true, jobs: runJobs }), { status: 200 })
}
