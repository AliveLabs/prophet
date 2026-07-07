// The brief-build step is CRITICAL: if it fails (e.g. a transient saveBrief error), the job must fail
// and retry — sibling-step progress must not launder a missing brief into "done" (2026-07-07: Cane's
// saveBrief failed, the notify step succeeded, job marked done, customer saw yesterday's brief).

import { describe, it, expect } from "vitest"
import { buildBriefSteps } from "@/lib/jobs/pipelines/brief"

describe("brief pipeline step criticality", () => {
  it("marks build_and_save_brief critical so a failed save fails (and retries) the job", () => {
    const steps = buildBriefSteps()
    const build = steps.find((s) => s.name === "build_and_save_brief")
    expect(build?.critical).toBe(true)
  })
  it("leaves the notify step best-effort (an email hiccup must NOT rebuild the whole brief)", () => {
    const notify = buildBriefSteps().find((s) => s.name === "notify_first_brief")
    expect(notify?.critical).toBeUndefined()
  })
})
