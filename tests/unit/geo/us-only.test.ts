// ALT-606 — Ticket serves United States locations only, and the guard must not be fooled by the
// inconsistent country data already in production.
//
// `locations.country` holds BOTH "United States" (Google Places writes longText) and the literal
// "US" (every insert's fallback) for the same country, which is why the check moved to the ISO
// code. These lock in that both still resolve, that an unknown country is refused rather than
// assumed American, and that the five inhabited territories are served on purpose.

import { describe, it, expect } from "vitest"
import {
  isServedCountry,
  normalizeCountry,
  unsupportedCountryMessage,
  unsupportedCompetitorMessage,
  SERVED_COUNTRY_CODES,
} from "@/lib/geo/us-only"

describe("normalizeCountry", () => {
  it("accepts the ISO code in any case", () => {
    expect(normalizeCountry("US")).toBe("US")
    expect(normalizeCountry("us")).toBe("US")
    expect(normalizeCountry("  Us  ")).toBe("US")
  })

  it("accepts the long names Places actually writes", () => {
    expect(normalizeCountry("United States")).toBe("US")
    expect(normalizeCountry("United States of America")).toBe("US")
    expect(normalizeCountry("Puerto Rico")).toBe("PR")
  })

  it("returns null for unknown, and NEVER guesses US", () => {
    for (const v of ["", "   ", "Atlantis", "United Kingdom of somewhere", null, undefined]) {
      expect(normalizeCountry(v as string | null), String(v)).toBeNull()
    }
  })

  it("passes through a foreign two-letter code rather than swallowing it", () => {
    // It must normalize to CA so the refusal can NAME the country. Returning null here would
    // make a Canadian address indistinguishable from a missing one.
    expect(normalizeCountry("CA")).toBe("CA")
  })
})

describe("isServedCountry", () => {
  it("serves the United States by code and by name", () => {
    expect(isServedCountry("US")).toBe(true)
    expect(isServedCountry("United States")).toBe(true)
  })

  it("refuses the near neighbours that make this happen by accident", () => {
    // A multi-unit operator with a restaurant across a border is the realistic path.
    for (const c of ["CA", "MX", "GB", "FR", "DE", "AU"]) {
      expect(isServedCountry(c), c).toBe(false)
    }
  })

  it("refuses an unknown or absent country instead of defaulting to US", () => {
    // The bug this replaces: every insert did `country || "US"`, turning "we do not know where
    // this is" into "this is American" — on the one field the whole guard depends on.
    expect(isServedCountry(null)).toBe(false)
    expect(isServedCountry("")).toBe(false)
    expect(isServedCountry("Atlantis")).toBe(false)
  })

  it("serves the five inhabited territories, deliberately", () => {
    // Google returns these under their OWN codes, never "US", so an allowlist of ["US"] alone
    // would silently refuse Puerto Rico. US federal law reaches them, which is the entire basis
    // of the restriction, so they are in scope by decision rather than by accident.
    for (const c of ["PR", "GU", "VI", "AS", "MP"]) {
      expect(isServedCountry(c), c).toBe(true)
    }
    expect(SERVED_COUNTRY_CODES.size).toBe(6)
  })
})

describe("the refusal message", () => {
  it("does not promise this is temporary", () => {
    const m = unsupportedCountryMessage("CA")
    expect(m).not.toMatch(/yet|soon|for now|currently working|coming/i)
  })

  it("names the country when we know it, so they know which address was the problem", () => {
    expect(unsupportedCountryMessage("CA")).toContain("CA")
  })

  it("says nothing about a country it could not determine", () => {
    const m = unsupportedCountryMessage(null)
    expect(m).toContain("United States locations only")
    expect(m).not.toMatch(/This address is in/)
  })

  it("uses no em dash", () => {
    expect(unsupportedCountryMessage("CA")).not.toMatch(/—/)
    expect(unsupportedCompetitorMessage("MX")).not.toMatch(/—/)
  })

  it("words the competitor refusal as a competitor, not as the operator's own location", () => {
    const m = unsupportedCompetitorMessage("MX")
    expect(m).toContain("tracks United States businesses only")
    expect(m).not.toMatch(/your address|use that address/i)
  })
})
