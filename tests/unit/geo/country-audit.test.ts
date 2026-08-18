// ALT-606 detector — re-check what is ALREADY in the database.
//
// The entry guard refuses a non-US location when it is added. This is the other half, and the
// reason it exists is that `locations.country` cannot be trusted to find a row that slipped
// through: on the one path where the guard degrades, the stored country IS the client-supplied
// value. So the audit re-resolves the place id and reads Google's answer instead.

import { describe, it, expect, vi, beforeEach } from "vitest"

const fetchPlaceDetails = vi.fn()

vi.mock("@/lib/places/google", async () => {
  const actual = await vi.importActual<typeof import("@/lib/places/google")>("@/lib/places/google")
  return { ...actual, fetchPlaceDetails: (...a: unknown[]) => fetchPlaceDetails(...a) }
})

const { auditLocation, auditLocationCountries, summarizeCountryAudit, countryMismatches } =
  await import("@/lib/geo/country-audit")
const { PlacesLookupError } = await import("@/lib/places/google")

function placeIn(countryCode: string) {
  return {
    id: "p1",
    displayName: { text: "Somewhere" },
    addressComponents: [{ longText: "Country", shortText: countryCode, types: ["country"] }],
  }
}

const row = (over: Record<string, unknown> = {}) => ({
  id: "loc-1",
  name: "Test Diner",
  country: "US",
  primary_place_id: "p1",
  organization_id: "org-1",
  ...over,
})

// Block body, NOT a concise arrow: mockReset() returns the mock, and an arrow that implicitly
// returns a FUNCTION registers it as vitest's teardown hook. That called the mock after every
// test, producing an unhandled rejection that failed three unrelated cases.
beforeEach(() => {
  fetchPlaceDetails.mockReset()
})

describe("auditLocation", () => {
  it("passes a location that really is in the US", async () => {
    fetchPlaceDetails.mockResolvedValue(placeIn("US"))
    expect((await auditLocation(row())).verdict).toBe("served")
  })

  it("CATCHES a row that says US but resolves to Canada", async () => {
    // The whole point. A row that slipped through says "US" precisely because someone said so.
    fetchPlaceDetails.mockResolvedValue(placeIn("CA"))
    const f = await auditLocation(row({ country: "US" }))
    expect(f.verdict).toBe("unsupported")
    expect(f.storedCountry).toBe("US")
    expect(f.resolvedCountry).toBe("CA")
  })

  it("does not flag a US row just because the spelling differs", async () => {
    // "United States" and "US" are the same country; the column holds both.
    fetchPlaceDetails.mockResolvedValue(placeIn("US"))
    expect((await auditLocation(row({ country: "United States" }))).verdict).toBe("served")
  })

  it("reports a dead listing as unverifiable rather than as a violation", async () => {
    fetchPlaceDetails.mockRejectedValue(new PlacesLookupError("gone", 404, "NOT_FOUND"))
    expect((await auditLocation(row())).verdict).toBe("unverifiable")
  })

  it("reports a vendor outage as unverifiable too, and never throws", async () => {
    fetchPlaceDetails.mockRejectedValue(new PlacesLookupError("boom", 503, "UNAVAILABLE"))
    const f = await auditLocation(row())
    expect(f.verdict).toBe("unverifiable")
    expect(f.resolvedCountry).toBeNull()
  })

  it("is unverifiable when the row has no place id to check", async () => {
    const f = await auditLocation(row({ primary_place_id: null }))
    expect(f.verdict).toBe("unverifiable")
    expect(fetchPlaceDetails).not.toHaveBeenCalled()
  })

  it("carries the org id, because remediation starts with stopping that org's email", async () => {
    fetchPlaceDetails.mockResolvedValue(placeIn("MX"))
    expect((await auditLocation(row())).organizationId).toBe("org-1")
  })
})

describe("summarizeCountryAudit", () => {
  it("separates what a human must act on from what is merely unresolved", async () => {
    fetchPlaceDetails
      .mockResolvedValueOnce(placeIn("US"))
      .mockResolvedValueOnce(placeIn("CA"))
      .mockRejectedValueOnce(new PlacesLookupError("gone", 404, "NOT_FOUND"))
    const findings = await auditLocationCountries([row({ id: "a" }), row({ id: "b" }), row({ id: "c" })])
    const s = summarizeCountryAudit(findings)
    expect(s.served).toBe(1)
    expect(s.unsupported.map((f) => f.locationId)).toEqual(["b"])
    expect(s.unverifiable.map((f) => f.locationId)).toEqual(["c"])
  })
})

describe("countryMismatches", () => {
  it("fingerprints a stored country that disagrees with Google", async () => {
    fetchPlaceDetails.mockResolvedValue(placeIn("CA"))
    const findings = await auditLocationCountries([row({ country: "US" })])
    expect(countryMismatches(findings)).toHaveLength(1)
  })

  it("does not call an unresolvable row a mismatch: we have nothing to compare it to", async () => {
    fetchPlaceDetails.mockRejectedValue(new PlacesLookupError("gone", 404, "NOT_FOUND"))
    const findings = await auditLocationCountries([row()])
    expect(countryMismatches(findings)).toHaveLength(0)
  })
})
