// ---------------------------------------------------------------------------
// Data-integrity contract — freshness classification (Spine rewrite · Phase 1)
//
// The single source of truth for "is this signal current?". Used at WRITE time
// (how old was the content when we fetched it — catches a 4-year-old post stamped
// today) and at READ time (how old is it now — catches a snapshot we haven't
// refreshed in weeks). Pure functions, no I/O, fully unit-tested.
// ---------------------------------------------------------------------------

export type FreshnessStatus = "fresh" | "aging" | "dormant" | "empty" | "undated"

export type SignalKind =
  | "social"
  | "reviews"
  | "listing"
  | "menu"
  | "events"
  | "seo"
  | "weather"
  | "traffic"

/**
 * Per-signal age thresholds (days). `freshDays` = still current; `agingDays` =
 * usable-but-getting-old; beyond that = dormant (do not present as current).
 * Tuned to each signal's natural cadence; configurable here in one place.
 */
export const THRESHOLDS: Record<SignalKind, { freshDays: number; agingDays: number }> = {
  social: { freshDays: 30, agingDays: 90 }, // a restaurant posting < monthly is going quiet
  reviews: { freshDays: 90, agingDays: 365 }, // reviews accrue slowly
  listing: { freshDays: 7, agingDays: 30 }, // Google listing (rating/hours) — refetch weekly
  menu: { freshDays: 14, agingDays: 60 },
  events: { freshDays: 3, agingDays: 14 }, // the local-events search must be recent
  seo: { freshDays: 7, agingDays: 30 },
  weather: { freshDays: 2, agingDays: 7 },
  traffic: { freshDays: 14, agingDays: 60 },
}

/** Whole days between two ISO timestamps (later − earlier); null if unparseable. */
export function daysBetween(laterIso: string | null | undefined, earlierIso: string | null | undefined): number | null {
  if (!laterIso || !earlierIso) return null
  const a = Date.parse(laterIso)
  const b = Date.parse(earlierIso)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((a - b) / 86_400_000)
}

/** Bucket an age-in-days into a freshness status for a given signal kind. */
export function bucket(ageDays: number | null, kind: SignalKind): FreshnessStatus {
  if (ageDays == null) return "undated"
  const { freshDays, agingDays } = THRESHOLDS[kind]
  if (ageDays <= freshDays) return "fresh" // includes content newer than capture (negative)
  if (ageDays <= agingDays) return "aging"
  return "dormant"
}

export type ClassifyInput = {
  /** Real recency of the underlying content (newest post / review / data period). */
  contentAsOf: string | null
  /** When we fetched it. */
  capturedAt: string
  /** True when the source returned no content at all (e.g. a profile with zero posts). */
  isEmpty?: boolean
  kind: SignalKind
}

/**
 * WRITE-time classification: how fresh was the CONTENT at the moment we captured it.
 * This is the core defect guard — a snapshot captured today whose newest content is
 * years old classifies as `dormant`, never `fresh`.
 */
export function classifyAtCapture(input: ClassifyInput): FreshnessStatus {
  if (input.isEmpty) return "empty"
  return bucket(daysBetween(input.capturedAt, input.contentAsOf), input.kind)
}

/**
 * READ-time usability: how old is this signal NOW (content age if we have a content
 * date, else how long ago we captured it). The dossier uses this to decide what may
 * drive today's brief.
 */
export function classifyNow(input: ClassifyInput & { now?: string }): FreshnessStatus {
  if (input.isEmpty) return "empty"
  const now = input.now ?? new Date().toISOString()
  const effectiveAsOf = input.contentAsOf ?? input.capturedAt
  return bucket(daysBetween(now, effectiveAsOf), input.kind)
}

/** A signal may drive the brief only if it is fresh or aging. */
export function isUsable(status: FreshnessStatus): boolean {
  return status === "fresh" || status === "aging"
}
