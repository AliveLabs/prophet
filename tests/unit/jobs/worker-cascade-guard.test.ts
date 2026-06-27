// Regression: a worker that already claimed a job must bail (no writes) when the org/location was
// cleared or (soft-)deleted, so a cascade delete can't be raced by a live pipeline writing orphan
// rows. (Code review 2026-06-26 — clearOrgData TODO.)

import { describe, it, expect } from "vitest"
import { locationStillActive } from "@/lib/jobs/worker"
import type { SB } from "@/lib/jobs/queue"

// Minimal chainable mock of the supabase client surface locationStillActive uses:
//   from(table).select(cols).eq(c, v).eq(c, v).maybeSingle() -> { data, error }
function mockSb(opts: { loc?: unknown; org?: unknown; throwOn?: "locations" | "organizations" }): SB {
  const build = (table: string) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => {
        if (opts.throwOn === table) throw new Error("transient read error")
        if (table === "locations") return { data: opts.loc ?? null, error: null }
        if (table === "organizations") return { data: opts.org ?? null, error: null }
        return { data: null, error: null }
      },
    }
    return builder
  }
  return { from: (t: string) => build(t) } as unknown as SB
}

describe("locationStillActive — cascade-delete race guard", () => {
  it("active: location exists for the org and the org is not soft-deleted", async () => {
    const sb = mockSb({ loc: { id: "loc-1" }, org: { deleted_at: null } })
    expect(await locationStillActive(sb, "loc-1", "org-1")).toBe(true)
  })

  it("inactive: location was cleared/deleted (cascade) — bail", async () => {
    const sb = mockSb({ loc: null, org: { deleted_at: null } })
    expect(await locationStillActive(sb, "loc-1", "org-1")).toBe(false)
  })

  it("inactive: org hard-deleted", async () => {
    const sb = mockSb({ loc: { id: "loc-1" }, org: null })
    expect(await locationStillActive(sb, "loc-1", "org-1")).toBe(false)
  })

  it("inactive: org soft-deleted (deleted_at set)", async () => {
    const sb = mockSb({ loc: { id: "loc-1" }, org: { deleted_at: "2026-06-26T00:00:00Z" } })
    expect(await locationStillActive(sb, "loc-1", "org-1")).toBe(false)
  })

  it("fails OPEN on a read error — never drops a legitimate job over a transient blip", async () => {
    const sb = mockSb({ throwOn: "locations" })
    expect(await locationStillActive(sb, "loc-1", "org-1")).toBe(true)
  })
})
