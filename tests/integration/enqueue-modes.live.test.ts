import { describe, it, expect } from "vitest"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { enqueueFirstRun, enqueueAdhocPlatform } from "@/lib/jobs/queue"

// Live check (cheap — enqueue + inspect, NO worker run / no provider cost): the pull
// modes write the right jobs + scope to signal_jobs. Cleans up after itself.
describe("enqueue modes (live): correct jobs + scope on the queue", () => {
  it("first-run + ad-hoc-platform enqueue the expected pipelines and cursor scope", async () => {
    const sb = createAdminSupabaseClient()
    const { data: loc } = await sb.from("locations").select("id, organization_id").ilike("name", "%wagyu%").limit(1).maybeSingle()
    expect(loc).toBeTruthy()
    const org = loc!.organization_id as string
    const locId = loc!.id as string

    // First-run
    const runId = crypto.randomUUID()
    await enqueueFirstRun(sb, { organizationId: org, locationId: locId, runId })
    const { data: frJobs } = await sb.from("signal_jobs").select("pipeline, cursor, scheduled_for").eq("run_id", runId)
    const pipelines = (frJobs ?? []).map((j) => j.pipeline).sort()
    expect(pipelines).toContain("social")
    expect(pipelines).toContain("photos")
    expect(pipelines).toContain("insights")
    const social = (frJobs ?? []).find((j) => j.pipeline === "social")
    expect((social!.cursor as { mode?: string; force?: boolean })?.mode).toBe("first_run")
    expect((social!.cursor as { force?: boolean })?.force).toBe(true)
    console.log(`[enqueue-modes] first-run jobs: ${pipelines.join(", ")}`)

    // Ad-hoc by network
    await enqueueAdhocPlatform(sb, { organizationId: org, locationId: locId, platforms: ["instagram"] })
    const { data: adhocSocial } = await sb
      .from("signal_jobs")
      .select("pipeline, cursor, run_id")
      .eq("pipeline", "social")
      .neq("run_id", runId)
      .order("created_at", { ascending: false })
      .limit(1)
    const ad = adhocSocial?.[0]
    const adScope = ad?.cursor as { mode?: string; platforms?: string[] }
    expect(adScope?.mode).toBe("adhoc")
    expect(adScope?.platforms).toEqual(["instagram"])
    console.log(`[enqueue-modes] ad-hoc social scope: ${JSON.stringify(adScope)}`)

    // cleanup both runs
    await sb.from("signal_jobs").delete().eq("run_id", runId)
    if (ad?.run_id) await sb.from("signal_jobs").delete().eq("run_id", ad.run_id)
  })
})
