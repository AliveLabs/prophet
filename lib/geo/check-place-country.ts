// Server-side country check for a Google place (ALT-606).
//
// The rules live in ./us-only (pure, unit-tested). This is the part that needs the network, kept
// separate so the rules stay testable without it.
//
// WHY RESOLVE SERVER-SIDE AT ALL. The onboarding and add-location forms post `country` as a
// form field, which means the value arrives from the client and can be anything. The ticket is
// explicit that UI validation is not sufficient, because an API client or a future integration
// takes the server path directly. So for any path that carries a place id we ask Google what
// country that place is in and decide on the answer, not on the submission.
//
// DEGRADATION, stated rather than discovered later. If the lookup itself fails (timeout, rate
// limit, vendor outage) we fall back to the submitted country string. That is spoofable, and
// accepted on purpose: this guard exists to stop an ACCIDENT, the multi-unit operator with a
// restaurant across a border, not a deliberate attacker who would simply post "US" anyway. The
// alternative is failing closed on a vendor hiccup at the single most important step in the
// funnel. When neither source resolves, we refuse, because an unknown jurisdiction is exactly
// what this guard is for.

import { fetchPlaceDetails, mapPlaceToLocation } from "@/lib/places/google"
import { isServedCountry, normalizeCountry, unsupportedCountryMessage } from "./us-only"

export type PlaceCountryVerdict =
  | { ok: true; countryCode: string }
  | { ok: false; message: string }

/**
 * Whether we serve the country this place sits in.
 *
 * `submittedCountry` is whatever the caller already had (a form field, or a country carried on
 * an already-mapped place). It is used only when the authoritative lookup cannot answer.
 */
export async function checkPlaceIsServed(
  placeId: string | null | undefined,
  submittedCountry?: string | null,
): Promise<PlaceCountryVerdict> {
  let resolved: string | null = null

  if (placeId) {
    try {
      const mapped = mapPlaceToLocation(await fetchPlaceDetails(placeId))
      resolved = normalizeCountry(mapped.country_code ?? mapped.country)
    } catch (err) {
      // Not fatal by itself: fall through to the submitted value.
      console.warn("[us-only] place lookup failed, falling back to the submitted country:", err)
    }
  }

  const country = resolved ?? normalizeCountry(submittedCountry)
  if (country && isServedCountry(country)) return { ok: true, countryCode: country }
  return { ok: false, message: unsupportedCountryMessage(country) }
}
