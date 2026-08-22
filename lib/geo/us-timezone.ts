// ---------------------------------------------------------------------------
// US location -> IANA timezone.
//
// ALT-739. Every `locations` row in production carried `America/New_York`, because both onboarding
// insert paths hardcoded it and the two form paths defaulted to it. Not one of the five was
// actually Eastern: three Texas, one California, one Missouri. So the entire local-morning build
// stagger was defeated. `build-schedule.ts` fires each location's brief when its LOCAL clock reads
// the build hour (3 AM by default), which is the whole point of the timezone column, and with
// every row claiming Eastern:
//
//   - Fog Harbor (San Francisco) built at midnight Pacific, not 3 AM
//   - the three Texas locations and the Missouri one built at 2 AM local
//   - the fleet fired in ONE burst instead of spreading across zones, which is exactly the
//     self-contention the stagger exists to avoid (2026-07-07: 7 simultaneous builds produced
//     timeout-fallbacks on 31% of producer slots)
//
// WHY A TABLE AND NOT A LIBRARY. A real answer needs timezone boundary polygons. The honest
// alternative is a dependency (tz-lookup and friends ship the shapefile), and that is a bigger
// decision than this ticket. The table below is deliberate, and the reason it is good enough is
// the CONSEQUENCE of being wrong: the only consumer is "which hour is 3 AM here", and the build
// window has catch-up hours either side. A boundary miss costs an hour of scheduling, never a
// wrong number in front of a customer.
//
// So this resolves by STATE first, which is exact for 37 of them, and uses longitude only for the
// states a timezone line actually crosses. Anything it cannot place returns the fallback WITH a
// `confidence` the caller can log, rather than silently asserting Eastern, which is the bug.
// ---------------------------------------------------------------------------

export const US_FALLBACK_ZONE = "America/New_York"

export type ZoneConfidence =
  /** The state sits entirely in one zone. Exact. */
  | "state"
  /** A timezone line crosses this state; placed by longitude or latitude. */
  | "split_state"
  /** Region unrecognised. Fell back, and the caller should log it. */
  | "fallback"

export type ResolvedZone = { timezone: string; confidence: ZoneConfidence }

const ET = "America/New_York"
const CT = "America/Chicago"
const MT = "America/Denver"
/** Arizona keeps Mountain Standard year round, so it needs its own zone, not America/Denver. */
const AZ = "America/Phoenix"
const PT = "America/Los_Angeles"
const AK = "America/Anchorage"
const HI = "Pacific/Honolulu"

/** States wholly inside one zone. Key is the 2-letter code. */
const SINGLE: Record<string, string> = {
  AL: CT, AR: CT, AZ: AZ, CA: PT, CO: MT, CT: ET, DC: ET, DE: ET, GA: ET,
  HI: HI, IA: CT, IL: CT, LA: CT, MA: ET, MD: ET, ME: ET, MN: CT, MO: CT,
  MS: CT, MT: MT, NC: ET, NH: ET, NJ: ET, NM: MT, NY: ET, OH: ET, OK: CT,
  PA: ET, RI: ET, SC: ET, UT: MT, VA: ET, VT: ET, WI: CT, WV: ET, WY: MT,
  // Territories we could plausibly see on a US-served place.
  PR: "America/Puerto_Rico", VI: "America/St_Thomas", GU: "Pacific/Guam",
}

/**
 * States a timezone line crosses. Thresholds are approximate on purpose and each names the real
 * boundary it stands in for. Erring by a county costs an hour of build scheduling.
 */
const SPLIT: Record<string, (lat: number, lng: number) => string> = {
  // Panhandle west of the Apalachicola River is Central.
  FL: (_lat, lng) => (lng < -85.0 ? CT : ET),
  // The four western Upper Peninsula counties (Gogebic, Iron, Dickinson, Menominee) are Central.
  MI: (_lat, lng) => (lng < -87.0 ? CT : ET),
  // Northwest (Gary) and southwest (Evansville) corners are Central; the rest of the state is Eastern.
  IN: (lat, lng) => (lng < -87.3 && (lat > 41.0 || lat < 38.5) ? CT : ET),
  // Western Kentucky and western Tennessee are Central.
  KY: (_lat, lng) => (lng < -85.6 ? CT : ET),
  TN: (_lat, lng) => (lng < -85.4 ? CT : ET),
  // The Dakotas, Nebraska and Kansas split roughly on the 100th meridian.
  ND: (_lat, lng) => (lng < -100.5 ? MT : CT),
  SD: (_lat, lng) => (lng < -100.0 ? MT : CT),
  NE: (_lat, lng) => (lng < -100.5 ? MT : CT),
  KS: (_lat, lng) => (lng < -101.5 ? MT : CT),
  // Only El Paso and Hudspeth counties, in the far west, are Mountain.
  TX: (_lat, lng) => (lng < -105.0 ? MT : CT),
  // The Idaho panhandle above the Salmon River is Pacific.
  ID: (lat) => (lat > 45.5 ? PT : MT),
  // Malheur County, in the southeast corner, is Mountain.
  OR: (lat, lng) => (lng > -117.6 && lat < 45.0 ? MT : PT),
  // West Wendover, on the Utah line, is Mountain.
  NV: (lat, lng) => (lng > -114.2 && lat > 40.5 && lat < 41.5 ? MT : PT),
  // Most of Alaska is one zone; the far-western Aleutians are not.
  AK: (_lat, lng) => (lng > 0 || lng < -169.5 ? "America/Adak" : AK),
  // Arizona is deliberately NOT split. The Navajo Nation observes DST while the rest of the state
  // does not, but its restaurants are few and America/Phoenix is right for essentially all of AZ.
}

const FULL_NAME_TO_CODE: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY", "puerto rico": "PR", "u.s. virgin islands": "VI", guam: "GU",
}

/** Washington state is Pacific; kept out of SINGLE only to avoid the DC/WA code confusion. */
const WA = PT

/** Every code this module can place. Built from the tables so it cannot drift from them. */
const KNOWN_CODES = new Set([...Object.keys(SINGLE), ...Object.keys(SPLIT), "WA"])

/** Normalise "Texas", "TX", "  tx  " to a 2-letter code, or null.
 *
 *  Validates against KNOWN_CODES rather than just shape: a bare `/^[A-Za-z]{2}$/` test happily
 *  returned "XX" as if it were a state, which made a nonsense region look resolved one layer up. */
export function toStateCode(region: string | null | undefined): string | null {
  if (!region) return null
  const raw = region.trim()
  if (!raw) return null
  if (/^[A-Za-z]{2}$/.test(raw)) {
    const code = raw.toUpperCase()
    return KNOWN_CODES.has(code) ? code : null
  }
  return FULL_NAME_TO_CODE[raw.toLowerCase()] ?? null
}

/**
 * The IANA zone for a US location. `region` may be a state code or full name (Google Places
 * returns the full name, e.g. "Texas"). Coordinates are only consulted for the states a timezone
 * line crosses, so a missing lat/lng still resolves correctly for most of the country.
 *
 * NEVER returns Eastern by accident. A fallback is reported as one.
 */
export function resolveUsTimezone(input: {
  region?: string | null
  lat?: number | null
  lng?: number | null
}): ResolvedZone {
  const code = toStateCode(input.region)
  if (!code) return { timezone: US_FALLBACK_ZONE, confidence: "fallback" }

  if (code === "WA") return { timezone: WA, confidence: "state" }

  const single = SINGLE[code]
  if (single) return { timezone: single, confidence: "state" }

  const split = SPLIT[code]
  if (split) {
    const lat = typeof input.lat === "number" && Number.isFinite(input.lat) ? input.lat : null
    const lng = typeof input.lng === "number" && Number.isFinite(input.lng) ? input.lng : null
    // Without coordinates we cannot place a split state. Use the zone the majority of that state
    // sits in rather than the national fallback, and say it was approximate.
    if (lat == null || lng == null) {
      return { timezone: MAJORITY_ZONE[code] ?? US_FALLBACK_ZONE, confidence: "split_state" }
    }
    return { timezone: split(lat, lng), confidence: "split_state" }
  }

  return { timezone: US_FALLBACK_ZONE, confidence: "fallback" }
}

/** Where most of a split state sits, for when we have no coordinates. */
const MAJORITY_ZONE: Record<string, string> = {
  FL: ET, MI: ET, IN: ET, KY: ET, TN: CT, ND: CT, SD: CT, NE: CT, KS: CT,
  TX: CT, ID: MT, OR: PT, NV: PT, AK: AK,
}
