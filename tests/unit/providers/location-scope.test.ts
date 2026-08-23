// ALT-636 — "local search visibility" was measuring the United States.
//
// Ten DataForSEO endpoints did `location_code: input.locationCode ?? 2840`, and 2840 is the whole
// country. No caller anywhere in the app ever passed a `locationCode`: every call site sent only
// `target` and `limit`. So a card titled "whether you show up in local search" was populated with
// national rankings by construction, and Chris's "these pills are not related to my area" was
// correct about the DATA, not just the sort order.
//
// The shape here is copied from google-events.ts, which already got this right: send
// `location_name`, and fall back when DataForSEO does not recognise the place rather than losing the
// call. That fallback is not hypothetical: "McKinney,Texas,United States" is refused with status
// 40501 while Forney and Arlington are accepted.

import { describe, expect, it, vi } from "vitest"
import {
  LOCATION_CODE_US,
  buildLocationName,
  isUnknownLocationError,
  locationTask,
  withLocationScope,
} from "@/lib/providers/dataforseo/location-scope"
import { DataForSEOError } from "@/lib/providers/dataforseo/client"

const unknownLocation = () =>
  new DataForSEOError("DataForSEO ranked_keywords error: 40501 Invalid Field: 'location_name'", undefined, 40501)

describe("buildLocationName", () => {
  it("builds the format DataForSEO expects", () => {
    expect(buildLocationName({ city: "Arlington", region: "Texas", country: "United States" })).toBe(
      "Arlington,Texas,United States",
    )
  })

  it("defaults the country, since the product is US-only", () => {
    expect(buildLocationName({ city: "Forney", region: "Texas" })).toBe("Forney,Texas,United States")
    expect(buildLocationName({ city: "Forney", region: "Texas", country: "" })).toBe("Forney,Texas,United States")
  })

  it("returns null with no city, rather than a state-wide query dressed up as local", () => {
    // "Texas,United States" is not a local search. A caller that cannot be local must say so.
    expect(buildLocationName({ region: "Texas", country: "United States" })).toBeNull()
    expect(buildLocationName({ city: "   " })).toBeNull()
    expect(buildLocationName({ city: null })).toBeNull()
  })

  it("NEVER THROWS on a missing location object, and that is load-bearing", () => {
    // Every SEO call site sits inside a try/catch that soft-degrades a non-payment error. If
    // building the name could throw, that throw would be caught there and reported as "this call
    // failed", swallowing a genuine DataForSEO payment outage the worker needs to see. A test caught
    // exactly that during this change: a 402 came back as a clean skip.
    expect(buildLocationName(null)).toBeNull()
    expect(buildLocationName(undefined)).toBeNull()
    expect(buildLocationName({})).toBeNull()
  })

  it("trims, because a stray space makes DataForSEO reject the whole name", () => {
    expect(buildLocationName({ city: " Dallas ", region: " Texas " })).toBe("Dallas,Texas,United States")
  })
})

describe("locationTask sends exactly one location field", () => {
  it("prefers the name when there is one", () => {
    // DataForSEO requires EXACTLY ONE of location_name / location_coordinate / location_code.
    // Sending both is a 40501, so this must never be two independent optional fields.
    expect(locationTask({ locationName: "Forney,Texas,United States" })).toEqual({
      location_name: "Forney,Texas,United States",
    })
  })

  it("falls back to the code, and to national when no code is given", () => {
    expect(locationTask({ locationCode: 1026339 })).toEqual({ location_code: 1026339 })
    expect(locationTask({})).toEqual({ location_code: LOCATION_CODE_US })
  })

  it("never emits both keys", () => {
    for (const arg of [{ locationName: "x" }, { locationCode: 1 }, {}]) {
      const t = locationTask(arg)
      expect(Object.keys(t).length, JSON.stringify(arg)).toBe(1)
    }
  })

  it("an empty name is not a name", () => {
    expect(locationTask({ locationName: "" })).toEqual({ location_code: LOCATION_CODE_US })
  })
})

describe("isUnknownLocationError narrows to exactly one refusal", () => {
  it("recognises the 40501 location_name refusal", () => {
    expect(isUnknownLocationError(unknownLocation())).toBe(true)
  })

  it("does NOT match a 40501 about a different field", () => {
    const other = new DataForSEOError("error: 40501 Invalid Field: 'target'", undefined, 40501)
    expect(isUnknownLocationError(other)).toBe(false)
  })

  it("does NOT match a payment outage, a rate limit, or a plain error", () => {
    // The whole point. These must keep reaching the vendor-health detector as themselves.
    expect(isUnknownLocationError(new DataForSEOError("out of credits", 402, 40200))).toBe(false)
    expect(isUnknownLocationError(new DataForSEOError("rate limited", 429))).toBe(false)
    expect(isUnknownLocationError(new Error("location_name is bad"))).toBe(false)
    expect(isUnknownLocationError("40501 location_name")).toBe(false)
  })
})

describe("withLocationScope", () => {
  it("asks about the location's own market and reports local", async () => {
    const call = vi.fn().mockResolvedValue("ok")
    const out = await withLocationScope("Forney,Texas,United States", call)
    expect(call).toHaveBeenCalledWith({ locationName: "Forney,Texas,United States" })
    expect(out).toEqual({ result: "ok", scope: "local" })
  })

  it("goes straight to national with no name, without burning a doomed call", async () => {
    // A call with no city is certain to be refused, so spending a request to learn that is waste on
    // our largest vendor line.
    const call = vi.fn().mockResolvedValue("ok")
    const out = await withLocationScope(null, call)
    expect(call).toHaveBeenCalledTimes(1)
    expect(call).toHaveBeenCalledWith({ locationCode: LOCATION_CODE_US })
    expect(out.scope).toBe("national")
  })

  it("falls back to national when DataForSEO does not know the place", async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce(unknownLocation())
      .mockResolvedValueOnce("national data")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const out = await withLocationScope("McKinney,Texas,United States", call)
    expect(out).toEqual({ result: "national data", scope: "national" })
    expect(call).toHaveBeenNthCalledWith(2, { locationCode: LOCATION_CODE_US })
    // The fallback must be visible. Falling back silently is how the original bug survived.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("not recognised"))
    warn.mockRestore()
  })

  it("PROPAGATES a payment outage instead of laundering it into a national retry", async () => {
    // The most important assertion in this file. A 402 must reach the worker so it can stamp
    // signals.vendor; turning it into a quiet retry that succeeds would hide a fleet-wide outage.
    const err = new DataForSEOError("out of credits", 402, 40200)
    const call = vi.fn().mockRejectedValue(err)
    await expect(withLocationScope("Forney,Texas,United States", call)).rejects.toBe(err)
    expect(call).toHaveBeenCalledTimes(1) // no retry
  })

  it("propagates any other error untouched, and does not retry", async () => {
    for (const err of [new DataForSEOError("boom", 500), new Error("network"), new DataForSEOError("bad target", undefined, 40501)]) {
      const call = vi.fn().mockRejectedValue(err)
      await expect(withLocationScope("Forney,Texas,United States", call)).rejects.toBe(err)
      expect(call).toHaveBeenCalledTimes(1)
    }
  })

  it("does not retry a SECOND failure into an infinite loop", async () => {
    // If the national retry also fails, that error is the answer.
    const second = new DataForSEOError("boom", 500)
    const call = vi.fn().mockRejectedValueOnce(unknownLocation()).mockRejectedValueOnce(second)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(withLocationScope("McKinney,Texas,United States", call)).rejects.toBe(second)
    expect(call).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})
