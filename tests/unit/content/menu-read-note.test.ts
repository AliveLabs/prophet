// ALT-610 : a vendor name shipped to customers in "How we read it".
//
// `lib/ai/gemini.ts` wrote `notes: ["Google Search grounding: N items across M categories"]` into
// the menu snapshot, and `parseMeta.notes` renders straight to the operator under "How we read it"
// on /content. Two rule violations in one string: it cites a vendor as OUR data source, and
// "grounding" is internal jargon that means nothing to a restaurant owner.
//
// It was the SECOND time this exact field leaked a vendor. PR #227 fixed the scraping side, which
// said "Extracted via <the scraping vendor> JSON mode". Two files, same mistake, made
// independently, because each writer phrased its own note.
//
// WHY THE EXISTING STATIC SCAN CAUGHT NEITHER, which is the part worth remembering:
//
//   1. SCOPE. tests/unit/ops/provenance-copy.test.ts scans `app/(dashboard)` and `components`.
//      These strings are BUILT in lib/ and only RENDERED in the dashboard. Scanning the render
//      site can never see a string assembled upstream.
//   2. And it would have missed the grounded one even in scope. "Google" is deliberately absent
//      from FORBIDDEN_PROVIDER_TERMS, because a customer's own Google Business Profile has to be
//      nameable ("update your Google Business Profile"). What is banned is citing Google as our
//      SOURCE, and no term list can tell those two uses apart.
//
// So this guard is shaped differently: one builder produces every note, and the test enumerates
// its entire output space rather than sampling files. A new read method is a compile error in the
// switch and a new row here, not a string somebody has to remember to check.

import { describe, expect, it } from "vitest"
import { MENU_READ_METHODS, menuReadNote } from "@/lib/content/menu-read-note"
import { namesProvider } from "@/lib/ops/provenance-copy"

/** Every note the builder can emit, across methods and a spread of counts. */
const everyNote = () =>
  MENU_READ_METHODS.flatMap((m) =>
    [
      [0, 0],
      [1, 1],
      [9, 3],
      [63, 12],
    ].map(([items, cats]) => ({ method: m, note: menuReadNote(m, items!, cats!) })),
  )

describe("the string that leaked", () => {
  it("no note says 'Google Search grounding'", () => {
    for (const { method, note } of everyNote()) {
      expect(note, method).not.toMatch(/google/i)
      expect(note, method).not.toMatch(/grounding/i)
    }
  })

  it("the grounded path now describes the method, not the supplier", () => {
    expect(menuReadNote("published_sources", 12, 4)).toBe(
      "Found the menu published elsewhere (12 items across 4 categories)",
    )
  })
})

describe("no note names a provider or an internal system", () => {
  it("passes the shared provenance check", () => {
    // Reuses lib/ops/provenance-copy.ts rather than a second list, so there is one definition of
    // "which names are banned" and narrowing it cannot silently weaken this test.
    for (const { method, note } of everyNote()) {
      expect(namesProvider(note), `${method}: ${note}`).toBe(false)
    }
  })

  it("names no vendor we buy from, including ones absent from the term list", () => {
    // The term list cannot ban "Google" (a customer's own Business Profile must be nameable), so
    // the vendors that render as a SOURCE are checked here over the builder's whole output.
    const asSource = /\b(google|gemini|firecrawl|dataforseo|openweather|serpapi|apify|outscraper)\b/i
    for (const { method, note } of everyNote()) {
      expect(asSource.test(note), `${method}: ${note}`).toBe(false)
    }
  })

  it("uses no internal jargon", () => {
    // Words that describe our machinery rather than the operator's restaurant. "extraction model"
    // is deliberately allowed: it is the reliability distinction the note exists to communicate.
    for (const { method, note } of everyNote()) {
      expect(note, method).not.toMatch(/\b(grounding|grounded|scrape[dr]?|scraping|JSON|API|SERP|pipeline|snapshot)\b/i)
    }
  })
})

describe("every method is covered, so a new one cannot slip through unphrased", () => {
  it("returns a distinct, non-empty note for each method", () => {
    const notes = MENU_READ_METHODS.map((m) => menuReadNote(m, 10, 2))
    expect(new Set(notes).size).toBe(MENU_READ_METHODS.length)
    for (const n of notes) expect(n.length).toBeGreaterThan(10)
  })

  it("MENU_READ_METHODS lists every method the type allows", () => {
    // If a method is added to MenuReadMethod but not to this array, the enumeration above stops
    // covering it and every assertion here would pass vacuously for the new one.
    expect([...MENU_READ_METHODS].sort()).toEqual(
      ["extraction_model", "page", "published_sources"].sort(),
    )
  })

  it("states the scale so an operator can judge the read", () => {
    for (const m of MENU_READ_METHODS) {
      expect(menuReadNote(m, 63, 12)).toContain("63 items across 12 categories")
    }
  })
})

describe("the two page methods stay distinguishable", () => {
  it("says which one read the page, because that IS the reliability story", () => {
    const direct = menuReadNote("page", 40, 6)
    const model = menuReadNote("extraction_model", 40, 6)
    expect(direct).not.toBe(model)
    expect(direct).toMatch(/directly/i)
    expect(model).toMatch(/extraction model/i)
  })
})
