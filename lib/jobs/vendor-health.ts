// ---------------------------------------------------------------------------
// Vendor health — make a silent external-vendor outage LOUD.
//
// Background (2026-06): DataForSEO returned HTTP 402 (account out of credits)
// fleet-wide for ~a week. Because every failure was flattened to a string and
// laundered into a generic "partial"/"failed" pipeline_runs row, briefs kept
// building fail-soft on stale data and the UI showed silent-empty — a vendor
// outage was indistinguishable from "no data". This module is the spine that
// fixes that: a typed signal stamped on each run (written by the worker), a
// reader the coverage UI uses, and a fleet-wide detector the ops-alert cron uses.
//
// Provider granularity, not pipeline: events + visibility both run on the SAME
// DataForSEO client, so health is tracked per VENDOR (dataforseo) across the two
// pipelines that depend on it.
// ---------------------------------------------------------------------------

import { DataForSEOError } from "@/lib/providers/dataforseo/client"
import type { SB } from "@/lib/jobs/queue"

/** The vendor whose health we track. (Only DataForSEO today; the shape is generic.) */
export type VendorName = "dataforseo"

/** Stamped onto pipeline_runs.signals.vendor when a run hit a vendor failure. */
export type VendorSignal = {
  name: VendorName
  /** HTTP status (402) or DataForSEO task status_code, whichever was available. */
  status?: number
  /** True when the failure is "account out of credits" — the actionable, refill-me case. */
  paymentRequired: boolean
}

/** The pipelines that depend on DataForSEO — the ones whose runs carry vendor health. */
export const DATAFORSEO_PIPELINES = ["events", "visibility"] as const

/** Build a VendorSignal from a caught error, or undefined if it's not a known vendor error. */
export function vendorSignalFromError(err: unknown): VendorSignal | undefined {
  if (err instanceof DataForSEOError) {
    return {
      name: "dataforseo",
      status: err.httpStatus ?? err.taskStatusCode,
      paymentRequired: err.isPaymentRequired,
    }
  }
  return undefined
}

/** Pick the more-severe of two vendor signals (a payment-required failure wins). */
export function moreSevereVendorSignal(
  a: VendorSignal | undefined,
  b: VendorSignal | undefined,
): VendorSignal | undefined {
  if (!a) return b
  if (!b) return a
  return b.paymentRequired && !a.paymentRequired ? b : a
}

/** Safely read a VendorSignal back out of a pipeline_runs.signals jsonb blob. */
export function readVendorSignal(signals: unknown): VendorSignal | undefined {
  if (!signals || typeof signals !== "object") return undefined
  const v = (signals as { vendor?: unknown }).vendor
  if (!v || typeof v !== "object") return undefined
  const name = (v as { name?: unknown }).name
  if (name !== "dataforseo") return undefined
  const statusRaw = (v as { status?: unknown }).status
  return {
    name,
    status: typeof statusRaw === "number" ? statusRaw : undefined,
    paymentRequired: (v as { paymentRequired?: unknown }).paymentRequired === true,
  }
}

// ── Reason-string fallback (rows without a structured signal) ────────────────
// Used for pipeline_runs recorded before the worker began stamping signals.vendor, or any path
// that threw a non-typed error. Prefer readVendorSignal; these are the backstop.

/** Any DataForSEO-attributed failure mentioned in a run's reason string. */
const DATAFORSEO_FAILURE_RE = /dataforseo/i
/** The DataForSEO payment/credit family: HTTP 402, task codes 402xx (40200 Payment Required,
 *  40201 paused, 40203 cost limit, 40210 insufficient funds), and the human-readable messages.
 *  `\b402\b` alone misses 402xx codes (no word boundary after 402), so match the numeric family. */
const PAYMENT_REASON_RE = /(^|\D)402(\d\d)?(\D|$)|payment required|cost limit|insufficient (funds|balance)|out of credits/i

/** Is this run a VENDOR-attributable failure (vs a benign partial)? Prefers the structured signal. */
function isVendorDownRun(outcome: string, reason: string | null, signals: unknown): boolean {
  if (outcome !== "failed" && outcome !== "partial") return false
  if (readVendorSignal(signals)) return true
  const r = reason ?? ""
  return DATAFORSEO_FAILURE_RE.test(r) || PAYMENT_REASON_RE.test(r)
}

/** Was this run a payment/credit failure specifically (the actionable refill case)? */
function isPaymentRun(reason: string | null, signals: unknown): boolean {
  const sig = readVendorSignal(signals)
  if (sig) return sig.paymentRequired
  return PAYMENT_REASON_RE.test(reason ?? "")
}

/**
 * Stricter than isVendorDownRun (which the coverage UI uses): for the FLEET ALERT, count a location as
 * vendor-down ONLY when the vendor is genuinely UNUSABLE — a payment/credit failure (the actionable
 * refill case, which will soon fail everything) OR a fully FAILED run (got no data at all). A `partial`
 * run with a benign task-level hiccup on one query (e.g. 40102 "no results", 40501 "invalid field") still
 * produced data → the vendor is up → it must NOT fire the daily watchdog. This is what was firing
 * "pipeline watchdog: degraded — scheduled jobs unhealthy" every day off benign no-event responses.
 * (2026-06-25 sensitivity fix — the credits-outage + total-outage cases still alert.)
 */
export function isVendorOutageRun(outcome: string, reason: string | null, signals: unknown): boolean {
  if (!isVendorDownRun(outcome, reason, signals)) return false
  return outcome === "failed" || isPaymentRun(reason, signals)
}

// ── Coverage read (UI) ──────────────────────────────────────────────────────

export type PipelineCoverage = {
  /** This DataForSEO pipeline is currently failing for this location. */
  unavailable: boolean
  /** ...specifically because the account is out of credits. */
  paymentRequired: boolean
}

/** Per-pipeline health so each page names the RIGHT source — the events page must not claim event
 *  data is down when only the search-visibility pull failed (P5-review finding). */
export type CoverageHealth = {
  events: PipelineCoverage
  visibility: PipelineCoverage
}

const HEALTHY: PipelineCoverage = { unavailable: false, paymentRequired: false }
export const EMPTY_COVERAGE: CoverageHealth = { events: HEALTHY, visibility: HEALTHY }

/**
 * Read the latest DataForSEO run health PER PIPELINE for ONE location, for the coverage UI. Drives
 * the "temporarily unavailable — showing your last good read" banner instead of silent-empty.
 * Uncached on purpose: an outage must surface live, not be hidden behind the 7-day page cache.
 */
export async function loadCoverageHealth(sb: SB, locationId: string): Promise<CoverageHealth> {
  const { data } = await sb
    .from("pipeline_runs")
    .select("pipeline, outcome, reason, signals, started_at")
    .eq("location_id", locationId)
    .in("pipeline", DATAFORSEO_PIPELINES as unknown as string[])
    .order("started_at", { ascending: false })
    .limit(40)

  // Latest run per DataForSEO pipeline drives that pipeline's own banner.
  const seen = new Set<string>()
  const result: CoverageHealth = { events: { ...HEALTHY }, visibility: { ...HEALTHY } }
  for (const r of data ?? []) {
    const key = r.pipeline
    if (key !== "events" && key !== "visibility") continue
    if (seen.has(key)) continue
    seen.add(key)
    if (isVendorDownRun(r.outcome, r.reason, r.signals)) {
      result[key] = { unavailable: true, paymentRequired: isPaymentRun(r.reason, r.signals) }
    }
  }
  return result
}

// ── Fleet detector (ops alert) ──────────────────────────────────────────────

export type FleetHealthStatus = "healthy" | "newly_down" | "still_down" | "recovered"

export type VendorHealthVerdict = {
  vendor: VendorName
  status: FleetHealthStatus
  /** True when >= threshold of active locations' DataForSEO pulls are failing now. */
  down: boolean
  downLocations: number
  totalLocations: number
  fractionDown: number
  paymentRequired: boolean
  sampleReason?: string
  thresholdFraction: number
  windowHours: number
}

// 8 days: comfortably exceeds the longest pull cadence (entry/suspended tiers pull events +
// visibility only WEEKLY, on Mondays) so weekly-tier locations aren't invisible to the fleet
// detector 5 days out of 7. The transition cutoff below stays at 24h regardless of window.
const DEFAULT_WINDOW_HOURS = 192
const DEFAULT_THRESHOLD_FRACTION = 0.5 // "balanced" (Bryan, 2026-06-20)

type RunLite = {
  locationId: string
  pipeline: string
  startedAtMs: number
  down: boolean
  paymentRequired: boolean
  reason: string | null
}

/** Down/healthy across the fleet, using the LATEST run per (location, pipeline). A location is
 *  "down" if any of its DataForSEO pipelines' latest run (within the optional asOf cutoff) is a
 *  vendor failure. Returns the down fraction over locations that have any DataForSEO run. */
function classifyFleet(
  runs: RunLite[],
  thresholdFraction: number,
  asOfBeforeMs?: number,
): { down: boolean; downCount: number; total: number; fraction: number; paymentRequired: boolean; sampleReason?: string } {
  const latest = new Map<string, RunLite>() // key: location|pipeline
  for (const r of runs) {
    if (asOfBeforeMs != null && r.startedAtMs >= asOfBeforeMs) continue
    const key = `${r.locationId}|${r.pipeline}`
    if (!latest.has(key)) latest.set(key, r) // runs are pre-sorted newest-first
  }
  const byLocation = new Map<string, RunLite[]>()
  for (const r of latest.values()) {
    const list = byLocation.get(r.locationId)
    if (list) list.push(r)
    else byLocation.set(r.locationId, [r])
  }
  const locations = [...byLocation.values()]
  const downLocations = locations.filter((rs) => rs.some((r) => r.down))
  const total = locations.length
  const fraction = total === 0 ? 0 : downLocations.length / total
  const paymentRequired = downLocations.some((rs) => rs.some((r) => r.down && r.paymentRequired))
  const sampleReason = downLocations.flat().find((r) => r.down && r.paymentRequired)?.reason
    ?? downLocations.flat().find((r) => r.down)?.reason
    ?? undefined
  return { down: total > 0 && fraction >= thresholdFraction, downCount: downLocations.length, total, fraction, paymentRequired, sampleReason }
}

/**
 * Fleet-wide DataForSEO health verdict for the ops-alert cron. Debounced WITHOUT a new table:
 * compares health "now" vs "24h ago" so we alert once on the healthy→down transition, stay quiet
 * for the duration of an ongoing outage, and can fire a recovery note when it clears.
 */
export async function detectDataForSeoHealth(
  sb: SB,
  opts: { nowMs?: number; thresholdFraction?: number; windowHours?: number } = {},
): Promise<VendorHealthVerdict> {
  const nowMs = opts.nowMs ?? Date.now()
  const thresholdFraction = opts.thresholdFraction ?? DEFAULT_THRESHOLD_FRACTION
  const windowHours = opts.windowHours ?? DEFAULT_WINDOW_HOURS
  const sinceIso = new Date(nowMs - windowHours * 3600_000).toISOString()

  const { data } = await sb
    .from("pipeline_runs")
    .select("location_id, pipeline, outcome, reason, signals, started_at")
    .in("pipeline", DATAFORSEO_PIPELINES as unknown as string[])
    .gte("started_at", sinceIso)
    .order("started_at", { ascending: false })

  const runs: RunLite[] = (data ?? []).map((r) => ({
    locationId: r.location_id as string,
    pipeline: r.pipeline as string,
    startedAtMs: new Date(r.started_at as string).getTime(),
    // FLEET ALERT classification (stricter than the coverage-UI's isVendorDownRun): a benign partial
    // hiccup (no-results / invalid-field for one query) is NOT a fleet outage and must not alert daily.
    down: isVendorOutageRun(r.outcome as string, r.reason as string | null, r.signals),
    paymentRequired: isPaymentRun(r.reason as string | null, r.signals),
    reason: (r.reason as string | null) ?? null,
  }))

  const now = classifyFleet(runs, thresholdFraction)
  const prior = classifyFleet(runs, thresholdFraction, nowMs - 24 * 3600_000)
  const status: FleetHealthStatus = now.down
    ? prior.down ? "still_down" : "newly_down"
    : prior.down ? "recovered" : "healthy"

  return {
    vendor: "dataforseo",
    status,
    down: now.down,
    downLocations: now.downCount,
    totalLocations: now.total,
    fractionDown: now.fraction,
    paymentRequired: now.paymentRequired,
    sampleReason: now.sampleReason,
    thresholdFraction,
    windowHours,
  }
}
