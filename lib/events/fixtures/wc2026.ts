// ---------------------------------------------------------------------------
// FIFA World Cup 2026 — authoritative in-code fixture seed (Events Validation Gate · P13)
//
// WHY THIS EXISTS: the live bug — the events engine trusted a scraped event TITLE and
// geocoded the title text, mis-locating + mis-dating a World Cup match. The fix is to
// cross-check any scheduled-league listing against an AUTHORITATIVE schedule keyed by
// (venue, local date, kickoff). This seed is that authority for WC2026.
//
// GROUNDING: the 16 host venues (city, official stadium name, FIFA event-time alias,
// lat/lng) + the 72-match GROUP-STAGE schedule (local date + local kickoff + venue) are
// public + finalized, sourced from the official FIFA schedule release and corroborating
// outlets (Al Jazeera/ESPN/NBC/Wikipedia, June 2026). Knockout fixtures (R32→final) are
// NOT seeded as match rows — their venue is determined by bracket progression and the
// pairing isn't fixed in advance; we seed the tournament DATE WINDOW so a knockout listing
// at a host venue inside the window can still resolve the VENUE (never a fabricated pairing).
//
// SAFETY: the validator only ever surfaces VALIDATED fields. Partial data is SAFE — a match
// we didn't seed simply doesn't get the league cross-check upgrade (it falls back to the
// venue-identity gate), never a wrong claim. The seed is data, not behavior.
//
// Aliases mirror lib/events/venue-catalog.ts KNOWN_ALIASES (FIFA drops corporate names):
// "AT&T Stadium" → "Dallas Stadium", etc. The cross-check resolves a listing under EITHER
// the physical name or the FIFA alias to the same venue identity.
// ---------------------------------------------------------------------------

/** A host venue with a stable identity. `placeName` is the physical/official name (matches
 *  venue_catalog + KNOWN_ALIASES keys); `aliases` are the FIFA event-time names listings use. */
export type FixtureVenue = {
  /** Stable internal id for this venue (kebab of the physical name). */
  venueId: string
  /** Physical/official stadium name — the KNOWN_ALIASES key in venue-catalog.ts. */
  placeName: string
  city: string
  /** FIFA event-time aliases (sponsor-free names the listings use). */
  aliases: string[]
  lat: number
  lng: number
  /** IANA-ish local timezone label (informational; kickoffs below are already LOCAL). */
  tz: string
}

/** One authoritative scheduled match: venue + LOCAL date + LOCAL kickoff. */
export type FixtureMatch = {
  /** FK to FixtureVenue.venueId. */
  venueId: string
  /** Local calendar date at the venue, YYYY-MM-DD. */
  localDate: string
  /** Local kickoff, 24h HH:MM at the venue. */
  localKickoff: string
  /** Round, for provenance. */
  round: "group" | "r32" | "r16" | "qf" | "sf" | "third" | "final"
  /** Human label for provenance only — NEVER interpolated into customer copy. */
  label: string
}

export type FixtureCompetition = {
  competitionId: string
  displayName: string
  /** Inclusive tournament window (local dates) — lets a knockout listing at a host venue
   *  inside the window resolve the VENUE even when we didn't seed the exact pairing. */
  window: { start: string; end: string }
  venues: FixtureVenue[]
  matches: FixtureMatch[]
}

// ── 16 host venues ────────────────────────────────────────────────────────
// Coordinates are best-effort (public stadium locations); the validator matches a listing's
// catalog venue_id, so coordinate precision here is for documentation/fallback only.
export const WC2026_VENUES: FixtureVenue[] = [
  { venueId: "sofi-stadium", placeName: "SoFi Stadium", city: "Los Angeles", aliases: ["Los Angeles Stadium"], lat: 33.9535, lng: -118.3392, tz: "America/Los_Angeles" },
  { venueId: "metlife-stadium", placeName: "MetLife Stadium", city: "New York / New Jersey", aliases: ["New York New Jersey Stadium"], lat: 40.8138, lng: -74.0743, tz: "America/New_York" },
  { venueId: "att-stadium", placeName: "AT&T Stadium", city: "Dallas", aliases: ["Dallas Stadium"], lat: 32.7473, lng: -97.0945, tz: "America/Chicago" },
  { venueId: "nrg-stadium", placeName: "NRG Stadium", city: "Houston", aliases: ["Houston Stadium"], lat: 29.6847, lng: -95.4107, tz: "America/Chicago" },
  { venueId: "arrowhead-stadium", placeName: "Arrowhead Stadium", city: "Kansas City", aliases: ["Kansas City Stadium"], lat: 39.0489, lng: -94.4839, tz: "America/Chicago" },
  { venueId: "levis-stadium", placeName: "Levi's Stadium", city: "San Francisco Bay Area", aliases: ["San Francisco Bay Area Stadium"], lat: 37.4033, lng: -121.9694, tz: "America/Los_Angeles" },
  { venueId: "lincoln-financial-field", placeName: "Lincoln Financial Field", city: "Philadelphia", aliases: ["Philadelphia Stadium"], lat: 39.9008, lng: -75.1675, tz: "America/New_York" },
  { venueId: "mercedes-benz-stadium", placeName: "Mercedes-Benz Stadium", city: "Atlanta", aliases: ["Atlanta Stadium"], lat: 33.7553, lng: -84.4006, tz: "America/New_York" },
  { venueId: "lumen-field", placeName: "Lumen Field", city: "Seattle", aliases: ["Seattle Stadium"], lat: 47.5952, lng: -122.3316, tz: "America/Los_Angeles" },
  { venueId: "hard-rock-stadium", placeName: "Hard Rock Stadium", city: "Miami", aliases: ["Miami Stadium"], lat: 25.958, lng: -80.2389, tz: "America/New_York" },
  { venueId: "gillette-stadium", placeName: "Gillette Stadium", city: "Boston", aliases: ["Boston Stadium"], lat: 42.0909, lng: -71.2643, tz: "America/New_York" },
  { venueId: "bc-place", placeName: "BC Place", city: "Vancouver", aliases: ["Vancouver Stadium"], lat: 49.2768, lng: -123.1119, tz: "America/Vancouver" },
  { venueId: "bmo-field", placeName: "BMO Field", city: "Toronto", aliases: ["Toronto Stadium"], lat: 43.6332, lng: -79.4186, tz: "America/Toronto" },
  { venueId: "estadio-akron", placeName: "Estadio Akron", city: "Guadalajara", aliases: ["Guadalajara Stadium"], lat: 20.6817, lng: -103.4626, tz: "America/Mexico_City" },
  { venueId: "estadio-bbva", placeName: "Estadio BBVA", city: "Monterrey", aliases: ["Monterrey Stadium"], lat: 25.6692, lng: -100.2444, tz: "America/Monterrey" },
  { venueId: "estadio-azteca", placeName: "Estadio Azteca", city: "Mexico City", aliases: ["Mexico City Stadium", "Estadio Ciudad de Mexico"], lat: 19.3028, lng: -99.1505, tz: "America/Mexico_City" },
]

// ── Group-stage match schedule (72 matches, local date + local kickoff) ─────
// Local kickoffs from the official schedule (converted to 24h local). Labels are provenance
// only. Knockout rounds are intentionally NOT enumerated (bracket-dependent venues).
export const WC2026_MATCHES: FixtureMatch[] = [
  // Thu Jun 11
  { venueId: "estadio-azteca", localDate: "2026-06-11", localKickoff: "13:00", round: "group", label: "Mexico vs South Africa" },
  { venueId: "estadio-akron", localDate: "2026-06-11", localKickoff: "20:00", round: "group", label: "South Korea vs Czechia" },
  // Fri Jun 12
  { venueId: "bmo-field", localDate: "2026-06-12", localKickoff: "15:00", round: "group", label: "Canada vs Bosnia and Herzegovina" },
  { venueId: "sofi-stadium", localDate: "2026-06-12", localKickoff: "18:00", round: "group", label: "USA vs Paraguay" },
  // Sat Jun 13
  { venueId: "levis-stadium", localDate: "2026-06-13", localKickoff: "12:00", round: "group", label: "Qatar vs Switzerland" },
  { venueId: "metlife-stadium", localDate: "2026-06-13", localKickoff: "18:00", round: "group", label: "Brazil vs Morocco" },
  { venueId: "gillette-stadium", localDate: "2026-06-13", localKickoff: "21:00", round: "group", label: "Haiti vs Scotland" },
  { venueId: "bc-place", localDate: "2026-06-13", localKickoff: "18:00", round: "group", label: "Australia vs Turkiye" },
  // Sun Jun 14
  { venueId: "nrg-stadium", localDate: "2026-06-14", localKickoff: "12:00", round: "group", label: "Germany vs Curacao" },
  { venueId: "att-stadium", localDate: "2026-06-14", localKickoff: "15:00", round: "group", label: "Netherlands vs Japan" },
  { venueId: "lincoln-financial-field", localDate: "2026-06-14", localKickoff: "19:00", round: "group", label: "Ivory Coast vs Ecuador" },
  { venueId: "estadio-bbva", localDate: "2026-06-14", localKickoff: "20:00", round: "group", label: "Sweden vs Tunisia" },
  // Mon Jun 15
  { venueId: "mercedes-benz-stadium", localDate: "2026-06-15", localKickoff: "12:00", round: "group", label: "Spain vs Cape Verde" },
  { venueId: "bc-place", localDate: "2026-06-15", localKickoff: "12:00", round: "group", label: "Belgium vs Egypt" },
  { venueId: "hard-rock-stadium", localDate: "2026-06-15", localKickoff: "18:00", round: "group", label: "Saudi Arabia vs Uruguay" },
  { venueId: "sofi-stadium", localDate: "2026-06-15", localKickoff: "18:00", round: "group", label: "Iran vs New Zealand" },
  // Tue Jun 16
  { venueId: "metlife-stadium", localDate: "2026-06-16", localKickoff: "15:00", round: "group", label: "France vs Senegal" },
  { venueId: "gillette-stadium", localDate: "2026-06-16", localKickoff: "18:00", round: "group", label: "Iraq vs Norway" },
  { venueId: "arrowhead-stadium", localDate: "2026-06-16", localKickoff: "20:00", round: "group", label: "Argentina vs Algeria" },
  { venueId: "levis-stadium", localDate: "2026-06-16", localKickoff: "21:00", round: "group", label: "Austria vs Jordan" },
  // Wed Jun 17
  { venueId: "nrg-stadium", localDate: "2026-06-17", localKickoff: "12:00", round: "group", label: "Portugal vs DR Congo" },
  { venueId: "att-stadium", localDate: "2026-06-17", localKickoff: "15:00", round: "group", label: "England vs Croatia" },
  { venueId: "bmo-field", localDate: "2026-06-17", localKickoff: "19:00", round: "group", label: "Ghana vs Panama" },
  { venueId: "estadio-azteca", localDate: "2026-06-17", localKickoff: "20:00", round: "group", label: "Uzbekistan vs Colombia" },
  // Thu Jun 18
  { venueId: "mercedes-benz-stadium", localDate: "2026-06-18", localKickoff: "12:00", round: "group", label: "Czechia vs South Africa" },
  { venueId: "sofi-stadium", localDate: "2026-06-18", localKickoff: "12:00", round: "group", label: "Switzerland vs Bosnia and Herzegovina" },
  { venueId: "bc-place", localDate: "2026-06-18", localKickoff: "15:00", round: "group", label: "Canada vs Qatar" },
  { venueId: "estadio-akron", localDate: "2026-06-18", localKickoff: "19:00", round: "group", label: "Mexico vs South Korea" },
  // Fri Jun 19
  { venueId: "gillette-stadium", localDate: "2026-06-19", localKickoff: "18:00", round: "group", label: "Scotland vs Morocco" },
  { venueId: "lumen-field", localDate: "2026-06-19", localKickoff: "12:00", round: "group", label: "USA vs Australia" },
  { venueId: "lincoln-financial-field", localDate: "2026-06-19", localKickoff: "20:30", round: "group", label: "Brazil vs Haiti" },
  { venueId: "levis-stadium", localDate: "2026-06-19", localKickoff: "21:00", round: "group", label: "Turkiye vs Paraguay" },
  // Sat Jun 20
  { venueId: "nrg-stadium", localDate: "2026-06-20", localKickoff: "12:00", round: "group", label: "Netherlands vs Sweden" },
  { venueId: "bmo-field", localDate: "2026-06-20", localKickoff: "16:00", round: "group", label: "Germany vs Ivory Coast" },
  { venueId: "arrowhead-stadium", localDate: "2026-06-20", localKickoff: "19:00", round: "group", label: "Ecuador vs Curacao" },
  { venueId: "estadio-bbva", localDate: "2026-06-20", localKickoff: "22:00", round: "group", label: "Tunisia vs Japan" },
  // Sun Jun 21
  { venueId: "mercedes-benz-stadium", localDate: "2026-06-21", localKickoff: "12:00", round: "group", label: "Spain vs Saudi Arabia" },
  { venueId: "sofi-stadium", localDate: "2026-06-21", localKickoff: "12:00", round: "group", label: "Belgium vs Iran" },
  { venueId: "hard-rock-stadium", localDate: "2026-06-21", localKickoff: "18:00", round: "group", label: "Uruguay vs Cape Verde" },
  { venueId: "bc-place", localDate: "2026-06-21", localKickoff: "18:00", round: "group", label: "New Zealand vs Egypt" },
  // Mon Jun 22
  { venueId: "att-stadium", localDate: "2026-06-22", localKickoff: "12:00", round: "group", label: "Argentina vs Austria" },
  { venueId: "lincoln-financial-field", localDate: "2026-06-22", localKickoff: "17:00", round: "group", label: "France vs Iraq" },
  { venueId: "metlife-stadium", localDate: "2026-06-22", localKickoff: "20:00", round: "group", label: "Norway vs Senegal" },
  { venueId: "levis-stadium", localDate: "2026-06-22", localKickoff: "20:00", round: "group", label: "Jordan vs Algeria" },
  // Tue Jun 23
  { venueId: "nrg-stadium", localDate: "2026-06-23", localKickoff: "12:00", round: "group", label: "Portugal vs Uzbekistan" },
  { venueId: "gillette-stadium", localDate: "2026-06-23", localKickoff: "16:00", round: "group", label: "England vs Ghana" },
  { venueId: "bmo-field", localDate: "2026-06-23", localKickoff: "19:00", round: "group", label: "Panama vs Croatia" },
  { venueId: "estadio-akron", localDate: "2026-06-23", localKickoff: "20:00", round: "group", label: "Colombia vs DR Congo" },
  // Wed Jun 24
  { venueId: "bc-place", localDate: "2026-06-24", localKickoff: "12:00", round: "group", label: "Switzerland vs Canada" },
  { venueId: "lumen-field", localDate: "2026-06-24", localKickoff: "12:00", round: "group", label: "Bosnia and Herzegovina vs Qatar" },
  { venueId: "hard-rock-stadium", localDate: "2026-06-24", localKickoff: "18:00", round: "group", label: "Scotland vs Brazil" },
  { venueId: "mercedes-benz-stadium", localDate: "2026-06-24", localKickoff: "18:00", round: "group", label: "Morocco vs Haiti" },
  { venueId: "estadio-azteca", localDate: "2026-06-24", localKickoff: "19:00", round: "group", label: "Czechia vs Mexico" },
  { venueId: "estadio-bbva", localDate: "2026-06-24", localKickoff: "19:00", round: "group", label: "South Africa vs South Korea" },
  // Thu Jun 25
  { venueId: "metlife-stadium", localDate: "2026-06-25", localKickoff: "16:00", round: "group", label: "Ecuador vs Germany" },
  { venueId: "lincoln-financial-field", localDate: "2026-06-25", localKickoff: "16:00", round: "group", label: "Curacao vs Ivory Coast" },
  { venueId: "att-stadium", localDate: "2026-06-25", localKickoff: "18:00", round: "group", label: "Japan vs Sweden" },
  { venueId: "arrowhead-stadium", localDate: "2026-06-25", localKickoff: "18:00", round: "group", label: "Tunisia vs Netherlands" },
  { venueId: "sofi-stadium", localDate: "2026-06-25", localKickoff: "19:00", round: "group", label: "Turkiye vs USA" },
  { venueId: "levis-stadium", localDate: "2026-06-25", localKickoff: "19:00", round: "group", label: "Paraguay vs Australia" },
  // Fri Jun 26
  { venueId: "gillette-stadium", localDate: "2026-06-26", localKickoff: "15:00", round: "group", label: "Norway vs France" },
  { venueId: "bmo-field", localDate: "2026-06-26", localKickoff: "15:00", round: "group", label: "Senegal vs Iraq" },
  { venueId: "nrg-stadium", localDate: "2026-06-26", localKickoff: "19:00", round: "group", label: "Cape Verde vs Saudi Arabia" },
  { venueId: "estadio-akron", localDate: "2026-06-26", localKickoff: "18:00", round: "group", label: "Uruguay vs Spain" },
  { venueId: "lumen-field", localDate: "2026-06-26", localKickoff: "20:00", round: "group", label: "Egypt vs Iran" },
  { venueId: "bc-place", localDate: "2026-06-26", localKickoff: "20:00", round: "group", label: "New Zealand vs Belgium" },
  // Sat Jun 27
  { venueId: "metlife-stadium", localDate: "2026-06-27", localKickoff: "17:00", round: "group", label: "Panama vs England" },
  { venueId: "lincoln-financial-field", localDate: "2026-06-27", localKickoff: "17:00", round: "group", label: "Croatia vs Ghana" },
  { venueId: "hard-rock-stadium", localDate: "2026-06-27", localKickoff: "19:30", round: "group", label: "Colombia vs Portugal" },
  { venueId: "mercedes-benz-stadium", localDate: "2026-06-27", localKickoff: "19:30", round: "group", label: "DR Congo vs Uzbekistan" },
  { venueId: "arrowhead-stadium", localDate: "2026-06-27", localKickoff: "21:00", round: "group", label: "Algeria vs Austria" },
  { venueId: "att-stadium", localDate: "2026-06-27", localKickoff: "21:00", round: "group", label: "Jordan vs Argentina" },
]

export const WC2026: FixtureCompetition = {
  competitionId: "fifa-world-cup-2026",
  displayName: "FIFA World Cup 2026",
  // Tournament window: opening match Jun 11 → final Jul 19, 2026 (knockouts inside this window
  // resolve a host VENUE, never a fabricated pairing — match rows above are group stage only).
  window: { start: "2026-06-11", end: "2026-07-19" },
  venues: WC2026_VENUES,
  matches: WC2026_MATCHES,
}

/** All in-code seeded competitions. The DB-backed loader falls back to this when the
 *  `fixtures` table is absent/empty (preview works today; the prod table is pure upside). */
export const SEEDED_COMPETITIONS: FixtureCompetition[] = [WC2026]
