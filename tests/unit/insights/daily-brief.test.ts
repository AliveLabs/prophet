import { describe, it, expect } from "vitest"
import { saveBrief, getBrief } from "@/lib/insights/daily-brief"
import type { Brief } from "@/lib/skills/types"

const brief: Brief = {
  locationId: "loc-1",
  dateKey: "2026-06-26",
  headline: "H",
  deck: "D",
  plays: [],
  asOf: "2026-06-26T06:00:00Z",
}

// Minimal chainable mock of the supabase query builder.
function mockClient(opts: { getReturn?: unknown } = {}) {
  const captured: { table?: string; upsert?: { row: Record<string, unknown>; opts: unknown } } = {}
  const builder: Record<string, unknown> = {
    upsert: (row: Record<string, unknown>, o: unknown) => {
      captured.upsert = { row, opts: o }
      return Promise.resolve({ error: null })
    },
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => Promise.resolve({ data: opts.getReturn ?? null }),
  }
  const client = { from: (t: string) => { captured.table = t; return builder } }
  return { client: client as never, captured }
}

describe("daily-brief persistence", () => {
  it("saveBrief upserts to daily_briefs keyed on (location_id, date_key)", async () => {
    const { client, captured } = mockClient()
    await saveBrief(brief, { client })
    expect(captured.table).toBe("daily_briefs")
    expect(captured.upsert?.row.location_id).toBe("loc-1")
    expect(captured.upsert?.row.date_key).toBe("2026-06-26")
    expect(captured.upsert?.opts).toEqual({ onConflict: "location_id,date_key" })
  })

  it("getBrief returns the stored brief json", async () => {
    const { client } = mockClient({ getReturn: { brief, date_key: "2026-06-26" } })
    const got = await getBrief("loc-1", { client })
    expect(got?.headline).toBe("H")
  })

  it("getBrief returns null when there is no row", async () => {
    const { client } = mockClient({ getReturn: null })
    expect(await getBrief("loc-1", { client })).toBeNull()
  })
})
