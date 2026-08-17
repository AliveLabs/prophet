// ---------------------------------------------------------------------------
// Which of the searches we rank for are actually LOCAL (ALT-623).
//
// The first-run card is titled "Whether you show up in local search" and showed the operator's
// three best-ranked keywords underneath it. Nothing in that pick was local: ranked keywords come
// back for the whole domain, sorted by position, so the top three are usually the brand name and
// broad category terms. The first operator to see it said the obvious thing, that they were "not
// related to my area", and they were right. A card cannot claim locality and then show whatever
// ranked highest.
//
// So this decides what may go under that title. A keyword counts as local when it NAMES the
// operator's geography or carries explicit near-me intent. Everything else is a real ranking and
// stays in the count, it just is not evidence of local visibility.
//
// PURE, so the rule is unit-testable and one definition serves every surface that wants it.
// ---------------------------------------------------------------------------

export type LocalGeography = {
  city?: string | null
  /** State or province, full name. Two-letter codes are deliberately NOT matched (below). */
  region?: string | null
  postalCode?: string | null
  /** Neighborhood, district, or any other area name worth matching. */
  extraPlaces?: readonly string[]
}

export type RankedKeywordRead = {
  keyword: string
  rank: number | null
}

export type LocalKeyword = {
  keyword: string
  rank: number | null
}

/**
 * Explicit local intent. These say "near me" without naming a place, and a restaurant ranking for
 * one of them IS showing up in local search, which is the claim the card makes.
 */
const NEAR_ME_PATTERNS = [
  /\bnear me\b/,
  /\bnear by\b/,
  /\bnearby\b/,
  /\bclose to me\b/,
  /\baround me\b/,
  /\bnear here\b/,
]

/** Words that are place names but are far too common to match on inside a keyword. */
const UNUSABLE_PLACE_NAMES = new Set(["", "us", "usa", "united states"])

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim()
}

/** Escape a place name for use inside a word-boundary regex. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * The place names worth matching for this location.
 *
 * A two-letter state code is deliberately excluded: "in", "or", "me", "hi", "ok", "de", "la" and
 * "pa" are all state codes AND ordinary English, so matching them would mark "pizza in town" as
 * local for an Indiana operator. Full state names are unambiguous, so those stay.
 */
export function placeNamesFor(geo: LocalGeography): string[] {
  const names = [geo.city, geo.region, geo.postalCode, ...(geo.extraPlaces ?? [])]
    .map((v) => (typeof v === "string" ? normalize(v) : ""))
    .filter((v) => v.length > 0 && !UNUSABLE_PLACE_NAMES.has(v))
    // A bare two-character token is either a state code or noise. Postal codes are longer.
    .filter((v) => v.length > 2)
  return [...new Set(names)]
}

/** Does this keyword name the operator's area, or ask for something near the searcher? */
export function isLocalKeyword(keyword: string, geo: LocalGeography): boolean {
  const k = normalize(keyword)
  if (!k) return false
  if (NEAR_ME_PATTERNS.some((re) => re.test(k))) return true
  return placeNamesFor(geo).some((place) => new RegExp(`\\b${escapeRegExp(place)}\\b`).test(k))
}

/**
 * The best-ranked LOCAL searches, soonest to the top of the results first.
 *
 * Returns fewer than `limit` (including none) rather than padding with non-local keywords. An
 * empty result is a real answer: this site does not yet rank for anything that names their area.
 */
export function pickLocalKeywords(
  keywords: readonly RankedKeywordRead[],
  geo: LocalGeography,
  limit = 3,
): LocalKeyword[] {
  return keywords
    .filter((k) => typeof k.keyword === "string" && isLocalKeyword(k.keyword, geo))
    .slice()
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER))
    .slice(0, limit)
    .map((k) => ({ keyword: k.keyword.trim(), rank: k.rank ?? null }))
}

/**
 * How a local search reads on the card: the term, and where the operator sits in the results.
 * The position is what makes the pill mean something. Without it the operator is shown a word and
 * left to guess whether it is good news.
 */
export function localKeywordLabel(k: LocalKeyword): string {
  const term = `“${k.keyword}”`
  return k.rank != null && k.rank > 0 ? `${term}, position ${k.rank}` : term
}
