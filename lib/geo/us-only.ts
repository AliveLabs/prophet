// ---------------------------------------------------------------------------
// Ticket serves United States locations only (ALT-606).
//
// This is a DELIBERATE product boundary, not a technical gap. Our email posture is built
// against US rules (CAN-SPAM's transactional exemption), and we have not evaluated Canada's
// CASL, the EU's GDPR or ePrivacy, or any other regime. Several vendor datasets are US-centric
// too, so a non-US location would also get a materially worse product. The honest answer is to
// refuse the location rather than serve it badly or unlawfully.
//
// The realistic way this happens by accident is a multi-unit operator with restaurants across a
// border, which is exactly the case worth catching.
//
// PURE ON PURPOSE so the rule is unit-testable and one definition serves every entry point.
//
// TWO DESIGN DECISIONS WORTH THE WORDS:
//
// 1. WE CHECK THE ISO CODE, NOT THE ADDRESS STRING. `locations.country` is already
//    inconsistent in production: Google Places writes the long name ("United States") while
//    every insert falls back to the literal "US", so the column holds both spellings for the
//    same country. Matching on that is a coin flip. `mapPlaceToLocation` now carries
//    `country_code` from the Places country component's `shortText`, which is ISO 3166-1
//    alpha-2 and unambiguous. `normalizeCountry` still accepts the legacy spellings so the
//    guard works on rows and forms that predate the code.
//
// 2. AN UNKNOWN COUNTRY IS REFUSED, NOT ASSUMED. Every insert used to default to `|| "US"`,
//    which silently converts "we do not know where this is" into "this is American". For a
//    guard whose whole job is jurisdiction, a default that invents the answer defeats the
//    guard. Absent or unrecognised is a refusal.
// ---------------------------------------------------------------------------

/**
 * The jurisdictions we serve, as ISO 3166-1 alpha-2 codes.
 *
 * The five inhabited territories are INCLUDED, deliberately rather than by accident. Google
 * returns them under their OWN country codes (PR, GU, VI, AS, MP), never "US", so an allowlist
 * of `["US"]` alone would silently refuse Puerto Rico. They are in scope because the reasoning
 * for the restriction is US federal law: CAN-SPAM and the FTC reach the territories, which is
 * the entire basis of our email and data posture. Excluding them would be a side effect of
 * Google's coding, not a decision anyone made.
 *
 * If a vendor dataset later proves unusable in a territory, that is a reason to revisit THIS
 * list with a note, not a reason to have quietly left them out.
 */
export const SERVED_COUNTRY_CODES: ReadonlySet<string> = new Set([
  "US", // United States
  "PR", // Puerto Rico
  "GU", // Guam
  "VI", // United States Virgin Islands
  "AS", // American Samoa
  "MP", // Northern Mariana Islands
])

/**
 * Legacy and long-form spellings seen in `locations.country`, mapped to their code.
 *
 * Needed because the column predates `country_code`: Places wrote `longText` ("United States")
 * and the inserts defaulted to "US". Both must resolve for the guard to work on existing rows
 * and on any form that still posts a name.
 */
const COUNTRY_NAME_TO_CODE: Readonly<Record<string, string>> = {
  "united states": "US",
  "united states of america": "US",
  "usa": "US",
  "u.s.": "US",
  "u.s.a.": "US",
  "us": "US",
  "puerto rico": "PR",
  "guam": "GU",
  "u.s. virgin islands": "VI",
  "united states virgin islands": "VI",
  "us virgin islands": "VI",
  "virgin islands": "VI",
  "american samoa": "AS",
  "northern mariana islands": "MP",
  "commonwealth of the northern mariana islands": "MP",
}

/**
 * A country code from whatever we were given, or null when we cannot tell.
 *
 * Null means "unknown", which callers must treat as a refusal. It never means "US".
 */
export function normalizeCountry(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const lower = trimmed.toLowerCase()
  const named = COUNTRY_NAME_TO_CODE[lower]
  if (named) return named
  // A bare two-letter token is already a code.
  if (/^[a-z]{2}$/.test(lower)) return lower.toUpperCase()
  return null
}

/** Do we serve this place? Accepts a code or a country name; unknown is always false. */
export function isServedCountry(value: string | null | undefined): boolean {
  const code = normalizeCountry(value)
  return code !== null && SERVED_COUNTRY_CODES.has(code)
}

/**
 * What the operator reads when we refuse.
 *
 * Plain and non-apologetic, and it does NOT promise this is temporary: we have not committed to
 * serving anywhere else, and implying otherwise to close a signup is a promise someone else has
 * to break later. Naming the country when we know it saves them guessing which address was the
 * problem.
 */
export function unsupportedCountryMessage(value?: string | null): string {
  const code = normalizeCountry(value)
  const where = code && code !== "US" ? ` This address is in ${code}.` : ""
  return `Ticket supports United States locations only.${where} If you operate in the US, use that address instead.`
}

/** The same refusal, worded for a competitor rather than the operator's own restaurant. */
export function unsupportedCompetitorMessage(value?: string | null): string {
  const code = normalizeCountry(value)
  const where = code && code !== "US" ? ` That business is in ${code}.` : ""
  return `Ticket tracks United States businesses only.${where}`
}
