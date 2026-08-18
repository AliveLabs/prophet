// ALT-606 follow-up — "Google is down" and "Google says there is no such place" are different
// answers and must not be treated alike.
//
// The first version caught both and fell back to the client's country either way, which left the
// fallback reachable ON DEMAND: post a nonsense place id with country "US" and the lookup throws,
// the fallback accepts. No outage required. It also gave a Texas operator with a stale listing id
// a message about the United States, which is an answer to a question they did not ask.

import { describe, it, expect, vi, beforeEach } from "vitest"

const fetchPlaceDetails = vi.fn()

vi.mock("@/lib/places/google", async () => {
  const actual = await vi.importActual<typeof import("@/lib/places/google")>("@/lib/places/google")
  return {
    ...actual,
    fetchPlaceDetails: (...args: unknown[]) => fetchPlaceDetails(...args),
  }
})

const { checkPlaceIsServed, UNVERIFIABLE_PLACE_MESSAGE } = await import("@/lib/geo/check-place-country")
const { PlacesLookupError } = await import("@/lib/places/google")

/** A Places details payload with the given country component. */
function placeIn(countryCode: string) {
  return {
    id: "p1",
    displayName: { text: "Somewhere" },
    addressComponents: [{ longText: "Country", shortText: countryCode, types: ["country"] }],
  }
}

beforeEach(() => {
  fetchPlaceDetails.mockReset()
})

describe("when Google answers", () => {
  it("allows a US place and records that the answer was authoritative", async () => {
    fetchPlaceDetails.mockResolvedValue(placeIn("US"))
    const v = await checkPlaceIsServed("p1", "US")
    expect(v).toEqual({ ok: true, countryCode: "US", source: "resolved" })
  })

  it("refuses a Canadian place even when the client insists it is American", async () => {
    // The spoof attempt, with the vendor healthy: Google's answer wins.
    fetchPlaceDetails.mockResolvedValue(placeIn("CA"))
    const v = await checkPlaceIsServed("p1", "US")
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.reason).toBe("unsupported_country")
      expect(v.message).toContain("CA")
    }
  })

  it("allows a territory", async () => {
    fetchPlaceDetails.mockResolvedValue(placeIn("PR"))
    expect((await checkPlaceIsServed("p1", null)).ok).toBe(true)
  })
})

describe("when the PLACE is the problem (4xx)", () => {
  it("refuses, and does NOT fall back to the client's country", async () => {
    // This is the on-demand hole the split closes.
    fetchPlaceDetails.mockRejectedValue(new PlacesLookupError("no such place", 404, "NOT_FOUND"))
    const v = await checkPlaceIsServed("bogus", "US")
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe("unverifiable_place")
  })

  it("says the listing could not be looked up, NOT that the country is unsupported", async () => {
    // A US operator whose place id went stale must never be told they are outside the US.
    fetchPlaceDetails.mockRejectedValue(new PlacesLookupError("no such place", 404, "NOT_FOUND"))
    const v = await checkPlaceIsServed("stale", "US")
    if (!v.ok) {
      expect(v.message).toBe(UNVERIFIABLE_PLACE_MESSAGE)
      expect(v.message).not.toMatch(/United States locations only/)
    }
  })

  it("treats a malformed id the same way", async () => {
    fetchPlaceDetails.mockRejectedValue(new PlacesLookupError("bad", 400, "INVALID_ARGUMENT"))
    const v = await checkPlaceIsServed("!!", "US")
    if (!v.ok) expect(v.reason).toBe("unverifiable_place")
  })
})

describe("when the VENDOR is the problem (5xx, timeout, rate limit)", () => {
  it("falls back to the submitted country so a blip cannot block signups", async () => {
    fetchPlaceDetails.mockRejectedValue(new PlacesLookupError("boom", 503, "UNAVAILABLE"))
    const v = await checkPlaceIsServed("p1", "US")
    expect(v).toEqual({ ok: true, countryCode: "US", source: "submitted" })
  })

  it("treats 429 as the vendor, not the place: rate limiting says nothing about the listing", async () => {
    fetchPlaceDetails.mockRejectedValue(new PlacesLookupError("slow down", 429, "RESOURCE_EXHAUSTED"))
    const v = await checkPlaceIsServed("p1", "US")
    expect(v.ok).toBe(true)
  })

  it("falls back on a plain network error too", async () => {
    fetchPlaceDetails.mockRejectedValue(new Error("ECONNRESET"))
    expect((await checkPlaceIsServed("p1", "US")).ok).toBe(true)
  })

  it("still refuses a NON-US submitted country during an outage", async () => {
    // The accidental case, which the fallback never weakened: an honest client reports Canada.
    fetchPlaceDetails.mockRejectedValue(new PlacesLookupError("boom", 500, null))
    const v = await checkPlaceIsServed("p1", "Canada")
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe("unsupported_country")
  })

  it("refuses when neither source can answer", async () => {
    fetchPlaceDetails.mockRejectedValue(new PlacesLookupError("boom", 500, null))
    expect((await checkPlaceIsServed("p1", null)).ok).toBe(false)
  })
})

describe("with no place id at all", () => {
  it("decides on the submitted country without calling Places", async () => {
    const v = await checkPlaceIsServed(null, "US")
    expect(v.ok).toBe(true)
    expect(fetchPlaceDetails).not.toHaveBeenCalled()
  })
})
