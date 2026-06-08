// Plain-language formatting for evidence refs (insight_type / dossier keys).
//
// Refs arrive in two shapes — dotted (`events.new_high_signal_event:event`) and
// screaming-snake with a trailing field (`SEO_COMPETITOR_GROWTH_TREND:PCT_CHANGE`).
// These helpers de-jargon BOTH into operator-readable labels so no API/internal
// terms leak onto the brief (per the Chris & Bryan review). Shared by the brief
// card and the detail page so the two presentations never drift apart.

const ACRONYMS = new Set(["SEO", "POS", "GBP", "UGC", "SERP", "FAQ", "ROI", "AOV"])

function cleanToken(t: string, lower = false): string {
  if (!t) return t
  if (ACRONYMS.has(t.toUpperCase())) return t.toUpperCase()
  if (lower) return t.toLowerCase()
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
}

/** Meaningful tokens of a ref, dropping the trailing field (after ":"). */
function refTokens(ref: string): string[] {
  return ref.split(":")[0].split(/[._]+/).filter(Boolean)
}

/** High-level category for a ref — the leading token, cleaned. e.g. "SEO", "Events". */
export function domainLabel(ref: string): string {
  const tokens = refTokens(ref)
  return tokens.length ? cleanToken(tokens[0]) : ref
}

/** Readable phrase for a ref: "SEO · competitor growth trend", "Events · new high signal event". */
export function humanizeRef(ref: string): string {
  const tokens = refTokens(ref)
  if (!tokens.length) return ref
  const domain = cleanToken(tokens[0])
  const detail = tokens.slice(1).map((t) => cleanToken(t, true)).join(" ").trim()
  return detail ? `${domain} · ${detail}` : domain
}

/** Distinct high-level categories across a set of refs (for the card's topic chip). */
export function distinctDomains(refs: string[]): string[] {
  return Array.from(new Set(refs.map(domainLabel)))
}

/** Distinct ref bases (drop the field suffix), preserving first-seen order. */
export function dedupeRefs(refs: string[]): string[] {
  return Array.from(new Set(refs.map((r) => r.split(":")[0])))
}

/**
 * Title-case a snake/UPPER token label (e.g. a recipe step's `channel`:
 * "GOOGLE_BUSINESS_PROFILE" -> "Google Business Profile", "WEBSITE" -> "Website").
 * Leaves already-human strings (anything with a space) untouched so values like
 * "Meta geo-ads" pass through unchanged.
 */
export function humanizeLabel(s: string): string {
  if (!s || /\s/.test(s)) return s
  return s.split(/[._]+/).filter(Boolean).map((t) => cleanToken(t)).join(" ")
}
