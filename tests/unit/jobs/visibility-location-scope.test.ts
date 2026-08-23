// ALT-636 — every SEO fetch in the visibility pipeline must go through seoCall(), so it asks about
// the location's market instead of about the United States.
//
// This is a SOURCE assertion, and the reasoning for that is worth stating because source scans are
// usually the wrong tool. The alternative would be running the pipeline and inspecting the request
// bodies, which needs a Supabase mock for thirteen different step shapes. What actually goes wrong
// here is someone adding a fourteenth fetch and forgetting the wrapper, and that is a syntactic
// property: the fetch call itself.
//
// So it matches the CALL FORM (`await fetchX(`), never a bare identifier. A bare name would match
// the import line and every comment mentioning it, which is exactly how a scan like this ends up
// asserting nothing.

import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const SRC = readFileSync(
  join(resolve(__dirname, "..", "..", ".."), "lib/jobs/pipelines/visibility.ts"),
  "utf8",
)

/** The DataForSEO fetches that take a location argument. */
const LOCATION_AWARE_FETCHES = [
  "fetchDomainRankOverview",
  "fetchRankedKeywords",
  "fetchKeywordsForSite",
  "fetchCompetitorsDomain",
  "fetchDomainIntersection",
  "fetchSerpOrganic",
  "fetchAdsSearch",
  "fetchRelevantPages",
  "fetchSubdomains",
  "fetchHistoricalRankOverview",
] as const

describe("every location-aware SEO fetch goes through seoCall", () => {
  for (const fn of LOCATION_AWARE_FETCHES) {
    it(`${fn} is never awaited directly`, () => {
      // `await fetchX(` is the unwrapped form. Wrapped calls read `seoCall(c, (loc) => fetchX({`.
      const unwrapped = new RegExp(`await\\s+${fn}\\(`, "g")
      const hits = SRC.match(unwrapped) ?? []
      expect(hits.length, `${fn} awaited directly ${hits.length} time(s)`).toBe(0)
    })
  }

  it("each one is actually still called, so this does not pass by deletion", () => {
    // A guard that passes because the call vanished is worse than no guard.
    for (const fn of LOCATION_AWARE_FETCHES) {
      expect(SRC.includes(`${fn}({`), fn).toBe(true)
    }
  })

  it("every fetch inside a seoCall spreads the location argument", () => {
    // The wrapper is useless if the closure ignores `loc`. Count the seoCall closures and require
    // each to spread it.
    const closures = SRC.match(/seoCall\(c, \(loc\) =>[\s\S]*?\}\)\)/g) ?? []
    expect(closures.length).toBeGreaterThanOrEqual(LOCATION_AWARE_FETCHES.length)
    for (const c of closures) {
      expect(c, c.slice(0, 60)).toMatch(/\.\.\.loc\b/)
    }
  })
})

describe("the pipeline reads the fields it needs to be local", () => {
  it("selects city, region and country for the location", () => {
    // Without these the name cannot be built and every call silently falls back to national, which
    // is the bug wearing the fix's clothes.
    expect(SRC).toMatch(/\.select\("id, name, website, primary_place_id, organization_id, city, region, country"\)/)
  })

  it("passes them onto the context", () => {
    for (const field of ["city:", "region:", "country:"]) {
      expect(SRC.includes(field), field).toBe(true)
    }
  })
})
