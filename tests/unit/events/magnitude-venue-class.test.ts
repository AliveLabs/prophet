// ALT-572 — the magnitude classifier dropped real stadium and amphitheatre events to "minor".
//
// Every case below is a REAL ROW from prod on 2026-08-22, with the magnitude it was actually
// assigned. None of it is invented:
//
//   title                                    venue                 was      capacityHigh
//   "Los Angeles Angels at Texas Rangers"    Globe Life Field      minor    null
//   "Double Trouble Double Vision Tour 2026" Dos Equis Pavilion    minor    null
//   "Extreme"                                Dos Equis Pavilion    minor    null
//   "Jack Johnson"                           Morton Amphitheater   minor    null
//   "Kansas City Chiefs vs Seattle Seahawks" Arrowhead Stadium     major    85000  (0 tickets!)
//
// TWO DISTINCT CAUSES, both fixed here.
//
// 1. Missing venue words. `pavilion`, `ballpark`, `dome` and a standalone `field` were absent from
//    MAJOR_VENUE, so an MLB ballpark and a 20k amphitheatre read as ordinary rooms.
//
// 2. `ticketsAndInfo.length >= 2` was the deciding signal, and it is a SCRAPE ARTIFACT. In one day
//    of prod rows the same fixture class at the same venue carried 1, 2 and 0 ticket links. The
//    Chiefs game at Arrowhead carried ZERO and survived only because the venue catalog knew the
//    capacity. Globe Life Field and Dos Equis Pavilion have no catalog row, so nothing rescued them.
//
// The asymmetry that matters: a noisy signal may PROMOTE (an over-called event costs a little
// attention) but must never DEMOTE (a demoted event is invisible, which is the whole failure).

import { describe, expect, it } from "vitest"
import { classifyEventMagnitude } from "@/lib/events/relevance"
import type { NormalizedEvent } from "@/lib/events/types"

const ev = (title: string, venueName: string, tickets = 0): NormalizedEvent =>
  ({
    title,
    venue: { name: venueName },
    ticketsAndInfo: Array.from({ length: tickets }, (_, i) => ({ url: `u${i}` })),
  }) as unknown as NormalizedEvent

describe("the four prod rows that were wrongly minor", () => {
  it("an MLB fixture at a ballpark named 'Field' is no longer minor", () => {
    // Globe Life Field, 40k seats. "field house" was in the pattern; a bare "Field" was not.
    const m = classifyEventMagnitude(ev("Los Angeles Angels at Texas Rangers", "Globe Life Field", 1))
    expect(m).not.toBe("minor")
  })

  it("a touring act at a Pavilion is no longer minor", () => {
    // Dos Equis Pavilion, ~20k. "pavilion" was missing entirely, and 0 ticket links finished it off.
    expect(classifyEventMagnitude(ev("Double Trouble Double Vision Tour 2026", "Dos Equis Pavilion"))).not.toBe("minor")
    expect(classifyEventMagnitude(ev("Extreme", "Dos Equis Pavilion"))).not.toBe("minor")
  })

  it("a named artist at an Amphitheater is no longer minor", () => {
    // `amphitheat` was already in the pattern, so this one failed purely on the ticket count.
    expect(classifyEventMagnitude(ev("Jack Johnson", "Morton Amphitheater"))).not.toBe("minor")
  })
})

describe("zero ticket links must not demote a large venue", () => {
  // The Chiefs-at-Arrowhead row carried ZERO ticket links. It only came out major because the
  // catalog had a capacity; where the catalog is silent, nothing caught it.
  for (const venue of ["Arrowhead Stadium", "Globe Life Field", "Dos Equis Pavilion", "Toyota Stadium"]) {
    it(`"${venue}" with no ticket links is at least moderate`, () => {
      const m = classifyEventMagnitude(ev("Some Real Show", venue, 0))
      expect(m, venue).not.toBe("minor")
    })
  }

  it("a sports fixture in a large venue is major with NO ticket links at all", () => {
    expect(classifyEventMagnitude(ev("Kansas City Chiefs vs Seattle Seahawks", "Arrowhead Stadium", 0))).toBe("major")
  })

  it("ticket count does not change a sports fixture's verdict, since it is noise", () => {
    // Same event class, three observed counts, one answer.
    for (const n of [0, 1, 2, 5]) {
      expect(classifyEventMagnitude(ev("Royals vs Blue Jays", "Kauffman Stadium", n)), `${n} links`).toBe("major")
    }
  })
})

describe("the floor is moderate, not major", () => {
  it("an unremarkable event at a large venue is moderate, because capacity is unknown", () => {
    // Honest: without a capacity we cannot tell a 2,000-seat pavilion from a 20,000-seat one. The
    // catalog upgrade in annotate.ts promotes to major once capacity is known.
    expect(classifyEventMagnitude(ev("Community Blood Drive", "Dos Equis Pavilion"))).toBe("moderate")
  })

  it("promotion still works: ticket links at a large venue reach major", () => {
    // The marquee case the engine exists for.
    expect(classifyEventMagnitude(ev("BTS WORLD TOUR 'ARIRANG'", "AT&T Stadium", 2))).toBe("major")
  })
})

describe("what must NOT be promoted", () => {
  it("a facility listing stays minor however stadium-shaped its venue", () => {
    // isNonDrawListing runs first and is not affected by any of this.
    expect(classifyEventMagnitude(ev("AT&T Stadium Self-Guided Tour", "AT&T Stadium Tours", 2))).toBe("minor")
    expect(classifyEventMagnitude(ev("Behind-the-Scenes Tour", "Arrowhead Stadium", 2))).toBe("minor")
  })

  it("a small club show is untouched", () => {
    // "The Warfield" (cap 3,000 in the catalog) matches no large-venue word, so it stays minor.
    expect(classifyEventMagnitude(ev("Bikini Kill with Alice Bag", "The Warfield"))).toBe("minor")
  })

  it("the narrow LARGE_VENUE list does not set a floor off the loose words", () => {
    // MAJOR_VENUE also carries `center`, `bowl` and `field`, which appear in names that are not
    // large rooms. Those stay useful as one signal among several and must not floor on their own,
    // or every leisure centre in the metro becomes a moderate draw.
    expect(classifyEventMagnitude(ev("Toddler Swim Lessons", "Frisco Athletic Center Waterpark"))).toBe("minor")
    expect(classifyEventMagnitude(ev("Quiet Book Club", "Willow Bend Center of the Arts"))).toBe("minor")
  })

  it("an event with no venue at all does not crash or get promoted", () => {
    expect(classifyEventMagnitude(ev("Mystery Event", ""))).toBe("minor")
  })
})
