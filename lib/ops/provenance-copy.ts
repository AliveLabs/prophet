// ---------------------------------------------------------------------------
// Operator-safe provenance copy.
//
// We describe WHAT we read ("traffic data", "weather data"), never WHO we bought it
// from. Naming a vendor customer-side hands competitors our supply chain, and raw
// vendor errors are worse still: the live "How we read this" panel was rendering
// strings like `Fetching local events from DataForSEO: DataForSEO error: 402 {json}`
// and `saveBrief failed: Empty or invalid json` straight from pipeline_runs.reason —
// vendor name, HTTP status, raw JSON, and internal function names. A 402 in particular
// tells a customer our vendor bill is unpaid.
//
// Design is FAIL-CLOSED on purpose. Scrubbing arbitrary vendor text with a deny-list
// is a losing game: a new provider, a reworded upstream error, or a stack trace all
// slip through. So operatorSafeReason() ALLOWLISTS the few reason shapes we know are
// safe and useful, and returns null for everything else. An unrecognized reason shows
// nothing rather than something we haven't vetted.
// ---------------------------------------------------------------------------

/**
 * Vendor / internal-system names that must never reach a customer surface. Used by the
 * regression test that scans customer-facing files, and as the last-resort check inside
 * operatorSafeReason(). Keep additions here, not scattered in components.
 *
 * NOTE: "Google" is deliberately NOT in this list. A customer's own Google Business
 * Profile is their asset and we have to name it to give useful advice ("update your
 * Google Business Profile"). What's banned is citing Google as OUR data source — that's
 * handled by the provenance labels below, not by banning the word outright.
 */
export const FORBIDDEN_PROVIDER_TERMS: readonly RegExp[] = [
  /\bdata\s*for\s*seo\b/i,
  /\bdataforseo\b/i,
  /\bfirecrawl\b/i,
  /\boutscraper\b/i,
  /\bopen\s*weather(?:map)?\b/i,
  /\bserp\s*api\b/i,
  /\bpredicthq\b/i,
  /\bgemini\b/i,
  /\banthropic\b/i,
  /\bclaude\b/i,
  /\bapify\b/i,
  /\bbright\s*data\b/i,
]

/** Does this string name a provider or internal system we must not expose? */
export function namesProvider(text: string): boolean {
  return FORBIDDEN_PROVIDER_TERMS.some((re) => re.test(text))
}

/**
 * Neutral, operator-facing names for the kinds of data we read. These are what a
 * provenance label may say: the WHAT, never the WHO.
 */
export const DATA_KIND_LABELS = {
  listing: "Listing data",
  listingPhotos: "Listing photos",
  search: "Search data",
  traffic: "Traffic data",
  weather: "Weather data",
  social: "Social data",
  menus: "Menu data",
  events: "Local event data",
  reviews: "Review data",
} as const

// Reason shapes we've vetted as safe to show verbatim. Anything else is replaced.
const SAFE_REASON_PATTERNS: readonly RegExp[] = [
  /^\d+ active accounts?$/i,
  /^\d+ competitors? (?:checked|tracked)$/i,
  /^\d+ items? (?:read|parsed)$/i,
  /^no changes? (?:detected|found)$/i,
]

// Recognizable failure classes, mapped to what an operator actually needs to know:
// that we couldn't read it this time, in plain language, with no vendor or status code.
const FAILURE_COPY: readonly { match: RegExp; copy: string }[] = [
  { match: /timed?\s*out|timeout|etimedout/i, copy: "the request timed out" },
  { match: /\b(?:429|rate\s*limit)/i, copy: "we hit a temporary limit" },
  // 402/401/403 are billing/credential problems. NEVER surface that distinction — an
  // operator seeing "payment required" learns something about us, not their market.
  { match: /\b(?:401|402|403)\b|payment\s*required|unauthorized|forbidden/i, copy: "the data was temporarily unavailable" },
  { match: /\b5\d{2}\b|server\s*error|bad\s*gateway/i, copy: "the source was briefly unavailable" },
  { match: /no\s+(?:search\s+)?results/i, copy: "there was nothing new to read" },
  { match: /invalid\s+field|invalid\s+json|parse|schema/i, copy: "the data came back unreadable" },
]

/**
 * Turn a raw pipeline_runs.reason into something safe to render, or null to show nothing.
 *
 * `outcome` is the pipeline's own verdict ("fresh" | "aging" | "partial" | "failed" | ...).
 * A successful run's reason is usually a useful count, so it passes the allowlist; a failed
 * run's reason is vendor/stack text, so it becomes a plain-language failure class.
 */
export function operatorSafeReason(
  outcome: string | null | undefined,
  reason: string | null | undefined
): string | null {
  if (!reason) return null
  const trimmed = reason.trim()
  if (!trimmed) return null

  // Vetted, useful, and provider-free — show as-is.
  if (SAFE_REASON_PATTERNS.some((re) => re.test(trimmed)) && !namesProvider(trimmed)) {
    return trimmed
  }

  // Otherwise: classify into a plain-language failure, whether or not it names a vendor.
  // Anything unrecognized returns null, so new upstream error text can't leak by default.
  for (const { match, copy } of FAILURE_COPY) {
    if (match.test(trimmed)) return copy
  }

  // ALT-751: "not_reached" was here too. pipeline_runs.outcome is CHECK-constrained to
  // fresh | served_stale | dormant | no_data | partial | failed | skipped, so it can never be
  // written and the branch was dead.
  const failed = outcome === "partial" || outcome === "failed"
  return failed ? "we couldn't read it this time" : null
}

/**
 * Fallback display label for a pipeline we don't have a curated name for. Never derive it
 * from the raw key: a provider-named pipeline (e.g. `dataforseo_events`) would leak.
 */
export function safePipelineLabel(
  pipeline: string,
  curated: Record<string, string>
): string {
  const known = curated[pipeline]
  if (known) return known
  const humanized = pipeline.replace(/_/g, " ")
  return namesProvider(humanized) ? "Additional checks" : humanized
}
