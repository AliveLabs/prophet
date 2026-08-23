// ALT-771 : a GUESSED venue capacity was promoting 730 events to "major".
//
// annotate.ts did `isMajorCapacity(e.capacityHigh) ? "major" : baseMagnitude` and never looked at
// `capacityConfidence`, even though every other consumer does (insights.ts gates its capacity
// CLAIM on measured, and maps prior to medium confidence).
//
// Measured against prod on 2026-08-23, 14 days of `dataforseo_google_events` snapshots:
//
//   686 catalog venues, of which ONE has a measured capacity.
//   582 of the 685 priors clear MAJOR_CAPACITY_THRESHOLD, so they force "major" unconditionally.
//   801 of 1,449 events (55%) came out major. 776 via a catalog match, 730 of those on a PRIOR.
//   46 major events had a measured capacity.
//
// Every venue and capacity quoted below is a real prod row, not an invented case.

import { describe, expect, it } from "vitest"
import {
  MAJOR_CAPACITY_THRESHOLD,
  isMajorCapacity,
  magnitudeWithCapacity,
} from "@/lib/events/venue-catalog"

const prior = (capacityHigh: number) => ({ capacityHigh, capacityConfidence: "prior" as const })
const measured = (capacityHigh: number) => ({
  capacityHigh,
  capacityConfidence: "measured" as const,
})

describe("the prod rows that were wrongly major", () => {
  // These four all matched a catalog row whose capacity is a Places TYPE prior, and all four came
  // out "major", which fed attendancePrior() a 15,000-person crowd and flagged them high-signal.
  const cases = [
    { title: "Throwback Field Trips: Roughriders Game", venue: "Barney & Me Boxing Gym", cap: 20000 },
    { title: "Screeching Weasel", venue: "Academy of Art University Recreation & Gym", cap: 30000 },
    { title: "McKinney Farmers Market", venue: "Chestnut Square Historic Village", cap: 5000 },
    { title: "Friday Hops & Shops at TUPPS Brewery", venue: "McKinney Silo Mural Project", cap: 5000 },
  ]

  for (const c of cases) {
    it(`"${c.title}" at "${c.venue}" is no longer major`, () => {
      // baseMagnitude "minor" is what the title/venue regexes actually return for these.
      expect(magnitudeWithCapacity("minor", prior(c.cap))).not.toBe("major")
    })
  }

  it("a boxing gym's 20,000-person prior cannot manufacture a headline", () => {
    expect(magnitudeWithCapacity("minor", prior(20000))).toBe("moderate")
  })

  it("not even the 85,000 stadium prior, which 88 venues carry", () => {
    // 88 rows hold capacity_high 85000 off the `stadium` search, including "Lady Eagles Softball
    // Field" and "Ballpark Orientation Bldg.".
    expect(magnitudeWithCapacity("minor", prior(85000))).toBe("moderate")
  })
})

describe("a MEASURED capacity keeps its override", () => {
  it("promotes to major from any base", () => {
    // The whole point of the catalog: "Dallas Stadium" at a measured 90,000 is the one row in prod
    // with a real number, and it is also the rebrand case the title regex cannot catch.
    expect(magnitudeWithCapacity("minor", measured(90000))).toBe("major")
    expect(magnitudeWithCapacity("moderate", measured(90000))).toBe("major")
    expect(magnitudeWithCapacity("major", measured(90000))).toBe("major")
  })

  it("but only above the threshold", () => {
    expect(magnitudeWithCapacity("minor", measured(MAJOR_CAPACITY_THRESHOLD))).toBe("major")
    expect(magnitudeWithCapacity("minor", measured(MAJOR_CAPACITY_THRESHOLD - 1))).toBe("minor")
  })
})

describe("the floor a prior IS allowed to set", () => {
  it("lifts minor to moderate, because a catalog match is real evidence of a crowd-sized room", () => {
    // "Pokémon Worlds Night" at Oracle Park: no major-event word, and `park` cannot go in the
    // venue regex without matching every city park. Without this floor it lands on minor.
    expect(magnitudeWithCapacity("minor", prior(85000))).toBe("moderate")
  })

  it("never LOWERS a magnitude the regexes already earned", () => {
    // The asymmetry from ALT-572 carried forward: a noisy signal may promote, never demote.
    expect(magnitudeWithCapacity("major", prior(85000))).toBe("major")
    expect(magnitudeWithCapacity("moderate", prior(85000))).toBe("moderate")
  })

  it("a below-threshold prior changes nothing at all", () => {
    for (const base of ["major", "moderate", "minor"] as const) {
      expect(magnitudeWithCapacity(base, prior(2800)), base).toBe(base)
    }
  })
})

describe("no capacity at all is left entirely to the regexes", () => {
  it("passes the base magnitude straight through", () => {
    for (const base of ["major", "moderate", "minor"] as const) {
      expect(magnitudeWithCapacity(base, {}), base).toBe(base)
      expect(magnitudeWithCapacity(base, { capacityHigh: null }), base).toBe(base)
      expect(magnitudeWithCapacity(base, { capacityHigh: undefined }), base).toBe(base)
    }
  })

  it("does not treat a missing confidence as measured", () => {
    // An event that never matched the catalog has no capacity and returns above. Reaching here
    // with a capacity but no confidence means a row we cannot vouch for, so it takes the prior
    // path. Failing the other way is how the original bug read.
    expect(magnitudeWithCapacity("minor", { capacityHigh: 85000 })).toBe("moderate")
    expect(magnitudeWithCapacity("minor", { capacityHigh: 85000, capacityConfidence: null })).toBe(
      "moderate",
    )
  })
})

describe("isMajorCapacity itself is unchanged", () => {
  // It still answers "is this room big", which is the right question for probe INCLUSION in
  // keywords.ts. What changed is that magnitude no longer treats that answer as sufficient.
  it("keeps its existing contract", () => {
    expect(isMajorCapacity(80000)).toBe(true)
    expect(isMajorCapacity(8000)).toBe(true)
    expect(isMajorCapacity(400)).toBe(false)
    expect(isMajorCapacity(null)).toBe(false)
  })
})

describe("the shape of the change, stated as a rule", () => {
  it("an above-threshold PRIOR never produces major from a base that was not already major", () => {
    for (const base of ["moderate", "minor"] as const) {
      expect(magnitudeWithCapacity(base, prior(85000)), base).not.toBe("major")
    }
  })

  it("an above-threshold MEASURED capacity produces major from every base", () => {
    for (const base of ["major", "moderate", "minor"] as const) {
      expect(magnitudeWithCapacity(base, measured(85000)), base).toBe("major")
    }
  })

  it("the function is idempotent: re-applying it changes nothing", () => {
    // annotate.ts runs once per event, but a re-annotate (the manual /events refresh path shares
    // this code) must not ratchet a magnitude upward on each pass.
    for (const cap of [prior(85000), measured(85000), prior(100), {}]) {
      for (const base of ["major", "moderate", "minor"] as const) {
        const once = magnitudeWithCapacity(base, cap)
        expect(magnitudeWithCapacity(once, cap), `${base} ${JSON.stringify(cap)}`).toBe(once)
      }
    }
  })
})
