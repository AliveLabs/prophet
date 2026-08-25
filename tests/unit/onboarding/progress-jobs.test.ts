// The progress endpoint's job-selection rule (lib/onboarding/progress-jobs.ts).
//
// The incident these pin (Chris, 2026-08-25): the endpoint filtered jobs strictly by the first-run
// batch's run_id, but the brief job usually lives under a DIFFERENT run_id — /home's self-healing
// ensureBriefQueued mints a fresh one, and the worker's same-run chain then dedupes itself away
// (ALT-674). So the payload carried nine done jobs and no brief row: the panel said "Everything
// has landed" over a brief row reading "Queued", enabled the CTA early, and its auto-swap trigger
// (brief job done) was unreachable. 22 minutes on a stale screen while the brief was already built.

import { describe, it, expect } from "vitest"
import { selectProgressJobs, type ProgressJobRow } from "@/lib/onboarding/progress-jobs"

const FR = { mode: "first_run" }

/** Rows NEWEST FIRST, matching the route's `order created_at desc`. */
function rows(...r: Array<Partial<ProgressJobRow> & { pipeline: string }>): ProgressJobRow[] {
  return r.map((x, i) => ({
    run_id: x.run_id ?? "run-a",
    status: x.status ?? "done",
    cursor: x.cursor === undefined ? FR : x.cursor,
    created_at: x.created_at ?? `2026-08-25T10:00:${String(59 - i).padStart(2, "0")}Z`,
    pipeline: x.pipeline,
  }))
}

describe("selectProgressJobs: the brief job is reported regardless of its run_id", () => {
  it("adopts the location's newest brief job when the batch has none (the ALT-674 shape)", () => {
    const { runJobs } = selectProgressJobs(
      rows(
        // ensureBriefQueued's standalone brief: fresh run_id, NO first_run cursor.
        { pipeline: "brief", run_id: "run-b", cursor: null, status: "running" },
        { pipeline: "insights", status: "done" },
        { pipeline: "content", status: "done" },
        { pipeline: "starter", status: "done" },
      ),
    )
    const brief = runJobs.find((j) => j.pipeline === "brief")
    expect(brief).toBeDefined()
    expect(brief?.status).toBe("running")
    expect(runJobs).toHaveLength(4)
  })

  it("keeps the batch's own brief job when the chain won, without duplicating", () => {
    const { runJobs } = selectProgressJobs(
      rows(
        { pipeline: "brief", status: "queued" }, // chained: same run_id, first_run cursor
        { pipeline: "insights", status: "done" },
      ),
    )
    expect(runJobs.filter((j) => j.pipeline === "brief")).toHaveLength(1)
    expect(runJobs.find((j) => j.pipeline === "brief")?.status).toBe("queued")
  })

  it("adopts the NEWEST brief job when several exist (rows arrive newest first)", () => {
    const { runJobs } = selectProgressJobs(
      rows(
        { pipeline: "brief", run_id: "run-c", cursor: null, status: "running" },
        { pipeline: "brief", run_id: "run-b", cursor: null, status: "failed" },
        { pipeline: "insights", status: "done" },
      ),
    )
    expect(runJobs.filter((j) => j.pipeline === "brief")).toHaveLength(1)
    expect(runJobs.find((j) => j.pipeline === "brief")?.status).toBe("running")
  })

  it("returns nothing without a first-run batch — a lone healed brief is not a first run", () => {
    expect(
      selectProgressJobs(rows({ pipeline: "brief", run_id: "run-z", cursor: null, status: "queued" })),
    ).toEqual({ runJobs: [], runStartedAt: null })
  })

  it("ALT-660: runStartedAt is the batch's earliest job, never the adopted brief", () => {
    const { runStartedAt } = selectProgressJobs([
      { run_id: "run-b", pipeline: "brief", status: "queued", cursor: null, created_at: "2026-08-25T10:20:00Z" },
      { run_id: "run-a", pipeline: "insights", status: "done", cursor: FR, created_at: "2026-08-25T10:05:00Z" },
      { run_id: "run-a", pipeline: "starter", status: "done", cursor: FR, created_at: "2026-08-25T10:00:00Z" },
    ])
    expect(runStartedAt).toBe("2026-08-25T10:00:00Z")
  })
})
