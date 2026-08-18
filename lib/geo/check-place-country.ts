// Server-side country check for a Google place (ALT-606).
//
// The rules live in ./us-only (pure, unit-tested). This is the part that needs the network, kept
// separate so the rules stay testable without it.
//
// WHY RESOLVE SERVER-SIDE AT ALL. The onboarding and add-location forms carry `country` from the
// client, so it can be anything. The ticket is explicit that UI validation is not sufficient,
// because an API client or a future integration takes the server path directly. For any path that
// carries a place id we ask Google what country that place is in and decide on the answer.
//
// THREE OUTCOMES, NOT TWO. The first version had two, and that was wrong in a way worth
// recording. A lookup can fail because the VENDOR is down or because the PLACE does not exist,
// and the original code caught both and fell back to the client's value either way. That left
// the fallback reachable on demand: post a nonsense place id with country "US" and the lookup
// throws, the fallback accepts. No outage required.
//
// It was also wrong about the message. "We cannot resolve this place" is not a country problem,
// and telling an operator in Texas that we only serve United States locations because their
// listing id went stale is a confusing answer to a question they did not ask. So an unverifiable
// place gets its own verdict and its own words.
//
//   resolved + served      → allow
//   resolved + not served  → refuse, US-only message
//   4xx (the place)        → refuse, "we could not look that up" message. NOT a country claim.
//   5xx / network / timeout (the vendor) → fall back to the submitted country
//
// The vendor fallback is still spoofable in principle, and still accepted: it needs a deliberate
// actor who is also waiting out a Google outage, and failing closed on a vendor blip at the top
// of the signup funnel is the worse trade.

import { fetchPlaceDetails, mapPlaceToLocation, PlacesLookupError } from "@/lib/places/google"
import { isServedCountry, normalizeCountry, unsupportedCountryMessage } from "./us-only"

/** Told to the operator when the listing itself will not resolve. Actionable, and not about geography. */
export const UNVERIFIABLE_PLACE_MESSAGE =
  "We could not look up that business listing. Pick it again from the suggestions, and if it still will not go through, try searching for it a different way."

export type PlaceCountryVerdict =
  | { ok: true; countryCode: string; source: "resolved" | "submitted" }
  | { ok: false; reason: "unsupported_country" | "unverifiable_place"; message: string }

/**
 * Whether we serve the country this place sits in.
 *
 * `submittedCountry` is whatever the caller already had (a form field, or a country on an
 * already-mapped place). It is consulted ONLY when the vendor could not answer, never when the
 * vendor answered that the place does not exist.
 */
export async function checkPlaceIsServed(
  placeId: string | null | undefined,
  submittedCountry?: string | null,
): Promise<PlaceCountryVerdict> {
  if (placeId) {
    try {
      const mapped = mapPlaceToLocation(await fetchPlaceDetails(placeId))
      const resolved = normalizeCountry(mapped.country_code ?? mapped.country)
      if (resolved && isServedCountry(resolved)) {
        return { ok: true, countryCode: resolved, source: "resolved" }
      }
      // Google answered. Whatever it said, that answer stands: an unrecognised country from a
      // real lookup is still not a country we serve.
      return { ok: false, reason: "unsupported_country", message: unsupportedCountryMessage(resolved) }
    } catch (err) {
      if (err instanceof PlacesLookupError && err.isPlaceFault) {
        // The place is the problem. Do NOT fall back to the client here: the client is what
        // just supplied an id that names nothing.
        console.warn("[us-only] place could not be resolved:", err.message)
        return { ok: false, reason: "unverifiable_place", message: UNVERIFIABLE_PLACE_MESSAGE }
      }
      // The vendor is the problem. Fall through to the submitted value rather than failing
      // closed on a blip at the top of the funnel.
      console.warn("[us-only] place lookup unavailable, falling back to the submitted country:", err)
    }
  }

  const submitted = normalizeCountry(submittedCountry)
  if (submitted && isServedCountry(submitted)) {
    return { ok: true, countryCode: submitted, source: "submitted" }
  }
  return { ok: false, reason: "unsupported_country", message: unsupportedCountryMessage(submitted) }
}
