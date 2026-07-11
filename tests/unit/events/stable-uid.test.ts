import { describe, it, expect } from "vitest"
import { computeStableEventUid } from "@/lib/events/hash"

describe("computeStableEventUid (grounded, differential-build safe)", () => {
  const base = {
    title: "Texas Rangers vs Houston Astros",
    startDatetime: "2026-07-10T19:05",
    venueName: "Globe Life Field",
    venueAddress: "734 Stadium Dr, Arlington, TX",
  }

  it("is identical across two runs of the same event", () => {
    expect(computeStableEventUid(base)).toBe(computeStableEventUid({ ...base }))
  })

  it("ignores start-TIME drift (same day → same uid)", () => {
    // A generative source often re-writes the time by 30 min run-to-run; the uid must not churn.
    const drifted = { ...base, startDatetime: "2026-07-10T19:35" }
    expect(computeStableEventUid(drifted)).toBe(computeStableEventUid(base))
  })

  it("ignores edition/year noise in the title", () => {
    const a = computeStableEventUid({ title: "5th Annual Spring Fest 2026", startDatetime: "2026-04-04", venueName: "City Park" })
    const b = computeStableEventUid({ title: "Spring Fest", startDatetime: "2026-04-04", venueName: "City Park" })
    expect(a).toBe(b)
  })

  it("changes when the DATE changes", () => {
    expect(computeStableEventUid({ ...base, startDatetime: "2026-07-11T19:05" })).not.toBe(computeStableEventUid(base))
  })

  it("changes when the VENUE changes", () => {
    expect(computeStableEventUid({ ...base, venueName: "Dickies Arena" })).not.toBe(computeStableEventUid(base))
  })

  it("changes when the TITLE changes", () => {
    expect(computeStableEventUid({ ...base, title: "Rangers vs Yankees" })).not.toBe(computeStableEventUid(base))
  })

  it("returns a 16-char hex uid", () => {
    expect(computeStableEventUid(base)).toMatch(/^[0-9a-f]{16}$/)
  })
})
