import { describe, it, expect } from "vitest"
import { normalizeGroundedDate } from "@/lib/events/date-normalize"

describe("normalizeGroundedDate", () => {
  it("passes through a clean ISO date", () => {
    expect(normalizeGroundedDate("2026-07-31")).toBe("2026-07-31")
  })

  it("keeps the local time off an ISO datetime, ignoring a spurious offset", () => {
    // The "+00:00" is a wall-clock label, not a real UTC offset — keep 19:30 as written.
    expect(normalizeGroundedDate("2026-07-31T19:30:00+00:00")).toBe("2026-07-31T19:30")
    expect(normalizeGroundedDate("2026-07-10T19:00")).toBe("2026-07-10T19:00")
  })

  it("parses 'Month DD, YYYY' with a time", () => {
    expect(normalizeGroundedDate("July 31, 2026 at 7:30 PM")).toBe("2026-07-31T19:30")
    expect(normalizeGroundedDate("August 2, 2026")).toBe("2026-08-02")
  })

  it("parses a weekday-prefixed long form", () => {
    expect(normalizeGroundedDate("Saturday, August 2, 2026 at 8 PM")).toBe("2026-08-02T20:00")
  })

  it("parses 'DD Month YYYY' and 'M/D/YYYY'", () => {
    expect(normalizeGroundedDate("31 July 2026")).toBe("2026-07-31")
    expect(normalizeGroundedDate("7/31/2026")).toBe("2026-07-31")
    expect(normalizeGroundedDate("7/31/2026 7pm")).toBe("2026-07-31T19:00")
  })

  it("DROPS an ambiguous date with no year (never guesses)", () => {
    // "July 31" / "7/31 7pm" are exactly the wrong-year risk this migration kills.
    expect(normalizeGroundedDate("July 31")).toBeNull()
    expect(normalizeGroundedDate("7/31 7pm")).toBeNull()
  })

  it("DROPS impossible / unparseable dates", () => {
    expect(normalizeGroundedDate("2026-02-30")).toBeNull() // Feb 30
    expect(normalizeGroundedDate("2026-13-01")).toBeNull() // month 13
    expect(normalizeGroundedDate("next Saturday")).toBeNull()
    expect(normalizeGroundedDate("")).toBeNull()
    expect(normalizeGroundedDate(null)).toBeNull()
    expect(normalizeGroundedDate(undefined)).toBeNull()
  })

  it("accepts a leap day in a leap year, rejects it otherwise", () => {
    expect(normalizeGroundedDate("2028-02-29")).toBe("2028-02-29")
    expect(normalizeGroundedDate("2027-02-29")).toBeNull()
  })

  it("is deterministic (same input → same output)", () => {
    expect(normalizeGroundedDate("July 31, 2026")).toBe(normalizeGroundedDate("July 31, 2026"))
  })
})
