// Venue NAME vs venue IDENTITY (2026-08-10).
//
// A catalog swept during the 2026 World Cup captured AT&T Stadium as "Dallas Stadium", the
// tournament rebrand. Two months later briefs still said "Dallas Stadium" while the live
// event source reported "AT&T Stadium" in the same record. Identity (coordinate match on a
// stable place_id) was always correct; only the cached NAME string was stale.

import { describe, it, expect } from "vitest"
import { preferLiveVenueName, venueNameDiverges } from "@/lib/events/validate"
import { fillSignal } from "@/lib/events/impact"
import type { NormalizedEvent } from "@/lib/events/types"

const ev = (venueName?: string) =>
  ({ venue: venueName ? { name: venueName } : undefined }) as unknown as NormalizedEvent

describe("preferLiveVenueName — freshest attestation wins for the LABEL", () => {
  it("shows the live name over a stale catalog rebrand", () => {
    expect(preferLiveVenueName(ev("AT&T Stadium"), "Dallas Stadium")).toBe("AT&T Stadium")
  })

  it("falls back to the catalog when the source has no usable name", () => {
    expect(preferLiveVenueName(ev(undefined), "Dallas Stadium")).toBe("Dallas Stadium")
    expect(preferLiveVenueName(ev("  "), "Dallas Stadium")).toBe("Dallas Stadium")
    expect(preferLiveVenueName(ev("X"), "Dallas Stadium")).toBe("Dallas Stadium")
  })

  it("never promotes an ancillary facility name over the real venue", () => {
    // The event geocoded onto the stadium; the source calling it the tours desk must not win.
    expect(preferLiveVenueName(ev("AT&T Stadium Tours"), "Dallas Stadium")).toBe("Dallas Stadium")
  })
})

describe("venueNameDiverges — the rename detector", () => {
  it("flags the real prod rename", () => {
    expect(venueNameDiverges("AT&T Stadium", "Dallas Stadium")).toBe(true)
  })

  it("does NOT flag formatting differences", () => {
    expect(venueNameDiverges("AT&T Stadium", "AT&T Stadium")).toBe(false)
    expect(venueNameDiverges("AT&T Stadium, Arlington", "AT&T Stadium")).toBe(false)
    expect(venueNameDiverges("at&t stadium", "AT&T Stadium")).toBe(false)
  })

  it("stays quiet when either side is missing", () => {
    expect(venueNameDiverges(null, "Dallas Stadium")).toBe(false)
    expect(venueNameDiverges("AT&T Stadium", null)).toBe(false)
  })
})

describe("fillSignal — ticket-link count is not demand", () => {
  it("a single emitted link no longer suppresses the estimate", () => {
    // BTS (1 link) modeled 54,000 at a 90k venue while another show (2 links) modeled 76,500,
    // and won the surge slot. The sold-out one lost, on a scrape artifact.
    expect(fillSignal(1)).toBe(fillSignal(0))
  })

  it("a real sold-out signal still pins it to full", () => {
    expect(fillSignal(0, true)).toBe(1.0)
    expect(fillSignal(5, true)).toBe(1.0)
  })

  it("multiple independent sources remain weak corroboration", () => {
    expect(fillSignal(2)).toBeGreaterThan(fillSignal(1))
  })

  it("stays within a sane range", () => {
    for (const n of [0, 1, 2, 9]) {
      expect(fillSignal(n)).toBeGreaterThan(0)
      expect(fillSignal(n)).toBeLessThanOrEqual(1)
    }
  })
})
