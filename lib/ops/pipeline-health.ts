// ---------------------------------------------------------------------------
// Pipeline health — "are the scheduled jobs actually running and completing?"
//
// Built after the 2026-06 silent stall: the durable queue (signal_jobs/pipeline_runs)
// produced ZERO runs for ~2 weeks because the Vercel cron schedule stopped firing
// (likely a billing/disable event), and NOTHING alerted — because every alerter was
// itself a Vercel cron, dark alongside the rest.
//
// This module computes a fleet-wide health verdict from data freshness + queue state.
// It is consumed by GET /api/health/pipeline, which is polled by an EXTERNAL watchdog
// (GitHub Actions) that lives outside Vercel — the only way to catch "all crons dark".
//
// Catches BOTH (a) a total blackout — no run/data/brief fleet-wide (the 2026-06 stall),
// and (b) a PARTIAL stall — a subset of recently-active locations stops getting fresh
// briefs while others keep going (the 2026-06-12 Raising Cane's "7 of 14" signature),
// which a fleet-wide MAX would mask.
//
// Split for testability: evaluatePipelineHealth() is PURE (verdict from signals + now);
// fetchPipelineSignals() does the I/O; detectPipelineHealth() composes the two.
// ---------------------------------------------------------------------------

import { detectDataForSeoHealth } from "@/lib/jobs/vendor-health"
import type { SB } from "@/lib/jobs/queue"

export type PipelineHealthStatus = "ok" | "degraded" | "down"

/** Raw signals the verdict is computed from (all already-fetched, no I/O here). */
export type PipelineSignals = {
  /** Most recent pipeline_runs row (worker ran a job). null = the queue has never run. */
  lastRunAt: string | null
  /** Most recent location_snapshots row (data landed). */
  lastDataAt: string | null
  /** Most recent daily_briefs row (a brief built). */
  lastBriefAt: string | null
  /** Recently-active locations (built a brief within the active window) whose NEWEST brief is now
   *  older than the stale threshold — i.e. a partial-fleet stall that the fleet-wide MAX hides. */
  staleLocations: number
  /** signal_jobs stuck in 'running' past the zombie window (timed out mid-job). */
  stuckJobs: number
  /** DISTINCT (location, pipeline) terminal failures within the stale window. Distinct so one
   *  chronically-broken pipeline retrying 3× doesn't inflate the count into daily alert noise. */
  failedJobsRecent: number
  /** signal_jobs 'queued' with scheduled_for well in the past — the worker isn't draining. */
  staleQueuedJobs: number
  /** DataForSEO fleet health (reused from the vendor-health detector). */
  vendorDown: boolean
  vendorPaymentRequired: boolean
  /** Fraction (0..1) of producer skill-slots that DEGRADED (served their deterministic fallback OR
   *  threw) across the newest brief per recently-active location. High = the engine is silently
   *  serving the floor to customers (the 2026-06 truncation regression). 0 when nothing to assess. */
  fallbackSkillRate: number
  /** How many newest-per-location briefs carried per-skill health (the rate's denominator base).
   *  Briefs built before skillHealth shipped lack it → excluded, so 0 here means "can't yet judge",
   *  NOT "healthy" — the rate is only trustworthy once briefs re-render carrying the field. */
  briefsAssessed: number
  /** Fraction (0..1) of Anthropic requests that were rate-limited (429/529) across the newest brief per
   *  recently-active location. The LEADING indicator of the account's rate ceiling: it rises FIRST under
   *  load, before latency → timeouts → fallbacks. 0 when no assessable calls. */
  rateLimitedRate: number
  /** Total Anthropic requests sampled for rateLimitedRate (its denominator). Low sample → not yet
   *  judgeable; gates the alert so pre-2026-07-04 briefs (no providerStats) never false-alarm. */
  rateLimitCallsSampled: number
  /** p95 wall-clock ms across producer model calls (skillHealth.elapsedMs) on the newest brief per
   *  recently-active location. Rising p95 = producers drifting toward the abort ceiling — the last
   *  warning BEFORE timeout-fallbacks appear. 0 when no samples. */
  producerLatencyP95Ms: number
  /** How many producer calls carried elapsedMs (the p95's sample base; gates the alert). */
  latencySamples: number
}

export type PipelineHealthThresholds = {
  /** No run / no data / no brief within this many hours ⇒ a problem. Daily pipeline + a
   *  buffer for the 06:00 data / 08:00 brief schedule ⇒ 26h default (env STALE_PIPELINE_HOURS). */
  staleHours: number
  /** Failed distinct (location,pipeline) count within the window that escalates to degraded. */
  failedJobsAlert: number
  /** Number of stale recently-active locations that escalates to degraded (partial-stall). */
  staleLocationsAlert: number
  /** Fleet-wide producer fallback rate (0..1) that escalates to degraded. 0.4 = if ≥40% of producer
   *  slots are serving the deterministic floor, the model path is systemically broken (the 2026-06
   *  truncation bug ran ~70-80%). A single flaky skill (~1/9 ≈ 0.11) stays below it — no daily noise. */
  fallbackRateAlert: number
  /** Fleet-wide rate-limit fraction (0..1) that escalates to degraded. 0.25 = if ≥25% of Anthropic
   *  requests are getting 429/529'd, we're leaning hard on the rate ceiling (retries mask it for now,
   *  but that's the precursor to load-driven timeouts). Conservative — occasional 429s self-heal. */
  rateLimitedRateAlert: number
  /** Minimum requests sampled before rateLimitedRate can alert (avoids a 1-of-2 spike tripping it). */
  rateLimitMinSample: number
  /** Producer p95 latency (ms) that escalates to degraded. 200s default = within ~17% of the 240s
   *  producer abort (ANTHROPIC_PRODUCER_TIMEOUT_MS default) — p95 there means the slowest producers
   *  are about to start timing out into fallbacks. Deliberately below the cliff, not at it. */
  producerP95AlertMs: number
  /** Minimum producer-call samples before the p95 can alert (two briefs' worth of producers). */
  latencyMinSample: number
}

export const DEFAULT_THRESHOLDS: PipelineHealthThresholds = {
  staleHours: 26,
  failedJobsAlert: 3,
  staleLocationsAlert: 2,
  fallbackRateAlert: 0.4,
  rateLimitedRateAlert: 0.25,
  rateLimitMinSample: 20,
  producerP95AlertMs: 200_000,
  latencyMinSample: 18,
}

/** A location counts as "recently active" (and therefore expected to stay fresh) if it built a
 *  brief within this many days — comfortably exceeds the weekly-tier Monday cadence. */
export const RECENT_ACTIVE_DAYS = 8

export type PipelineHealthVerdict = {
  status: PipelineHealthStatus
  checkedAt: string
  /** Human-readable problems; empty when status is ok. */
  reasons: string[]
  lastRunAt: string | null
  lastDataAt: string | null
  lastBriefAt: string | null
  hoursSinceLastRun: number | null
  hoursSinceLastData: number | null
  hoursSinceLastBrief: number | null
  staleLocations: number
  stuckJobs: number
  failedJobsRecent: number
  staleQueuedJobs: number
  vendor: { down: boolean; paymentRequired: boolean }
  fallbackSkillRate: number
  briefsAssessed: number
  rateLimitedRate: number
  rateLimitCallsSampled: number
  producerLatencyP95Ms: number
  latencySamples: number
  thresholds: PipelineHealthThresholds
}

const RANK: Record<PipelineHealthStatus, number> = { ok: 0, degraded: 1, down: 2 }

/** PURE: turn raw signals + the current time into a verdict. No I/O — fully unit-testable. */
export function evaluatePipelineHealth(
  s: PipelineSignals,
  nowMs: number,
  t: PipelineHealthThresholds = DEFAULT_THRESHOLDS,
): PipelineHealthVerdict {
  const ageHours = (iso: string | null): number | null => (iso == null ? null : (nowMs - new Date(iso).getTime()) / 3_600_000)
  const runAge = ageHours(s.lastRunAt)
  const dataAge = ageHours(s.lastDataAt)
  const briefAge = ageHours(s.lastBriefAt)

  const reasons: string[] = []
  let status: PipelineHealthStatus = "ok"
  const escalate = (to: PipelineHealthStatus) => {
    if (RANK[to] > RANK[status]) status = to
  }

  // DOWN — the scheduled pipeline isn't running at all (the silent-stall signature).
  if (s.lastRunAt == null) {
    reasons.push("No pipeline run on record — the worker queue has never run (crons dark?)")
    escalate("down")
  } else if (runAge != null && runAge > t.staleHours) {
    reasons.push(`No pipeline run in ${runAge.toFixed(1)}h (threshold ${t.staleHours}h) — the schedule may have stopped firing`)
    escalate("down")
  }
  if (s.lastDataAt == null) {
    reasons.push("No data snapshots on record")
    escalate("down")
  } else if (dataAge != null && dataAge > t.staleHours) {
    reasons.push(`No fresh data pulled in ${dataAge.toFixed(1)}h (threshold ${t.staleHours}h)`)
    escalate("down")
  }

  // DEGRADED — running, but not finishing the job cleanly (incl. a PARTIAL-fleet stall).
  if (s.lastBriefAt == null) {
    reasons.push("No briefs on record")
    escalate("degraded")
  } else if (briefAge != null && briefAge > t.staleHours) {
    reasons.push(`No brief built in ${briefAge.toFixed(1)}h (threshold ${t.staleHours}h)`)
    escalate("degraded")
  }
  if (s.staleLocations >= t.staleLocationsAlert) {
    reasons.push(`${s.staleLocations} recently-active location(s) have no fresh brief in ${t.staleHours}h (partial stall)`)
    escalate("degraded")
  }
  if (s.staleQueuedJobs > 0) {
    reasons.push(`${s.staleQueuedJobs} job(s) queued but not draining — the worker may be stalled`)
    escalate("degraded")
  }
  if (s.stuckJobs > 0) {
    reasons.push(`${s.stuckJobs} job(s) stuck 'running' past the zombie window (timed out mid-job)`)
    escalate("degraded")
  }
  if (s.failedJobsRecent >= t.failedJobsAlert) {
    reasons.push(`${s.failedJobsRecent} pipeline(s) failing across the fleet in the last ${t.staleHours}h`)
    escalate("degraded")
  }
  if (s.vendorDown) {
    reasons.push(`DataForSEO is failing fleet-wide${s.vendorPaymentRequired ? " (out of credits — refill the account)" : ""}`)
    escalate("degraded")
  }
  // Fleet-wide fallback-serving — briefs BUILD (so freshness looks fine) but the producers behind
  // them silently degraded to the deterministic floor. This is the signal that would have caught the
  // 2026-06 truncation regression in hours instead of ~2 weeks. Only fires once briefs carry health.
  if (s.briefsAssessed > 0 && s.fallbackSkillRate >= t.fallbackRateAlert) {
    reasons.push(
      `${(s.fallbackSkillRate * 100).toFixed(0)}% of producer skills are serving deterministic fallbacks across ${s.briefsAssessed} location(s) — the model path may be broken (truncation/outage); customers are seeing the floor`,
    )
    escalate("degraded")
  }
  // Rate-ceiling pressure — the LEADING indicator. Rises before latency/timeouts/fallbacks do, so this
  // is the early-warning that we're outgrowing the Anthropic tier (raise it / add cross-instance cap).
  if (s.rateLimitCallsSampled >= t.rateLimitMinSample && s.rateLimitedRate >= t.rateLimitedRateAlert) {
    reasons.push(
      `${(s.rateLimitedRate * 100).toFixed(0)}% of Anthropic requests are being rate-limited (429/529) across ${s.rateLimitCallsSampled} recent calls — leaning on the rate ceiling; raise the tier or add a cross-instance cap before it turns into timeouts`,
    )
    escalate("degraded")
  }
  // Producer latency drift — the LAST warning before the cliff. p95 near the abort ceiling means the
  // slowest producers are about to start timing out into fallbacks (rate pressure, prompt bloat, or
  // concurrency contention). Fires while briefs still look healthy.
  if (s.latencySamples >= t.latencyMinSample && s.producerLatencyP95Ms >= t.producerP95AlertMs) {
    reasons.push(
      `producer p95 latency is ${Math.round(s.producerLatencyP95Ms / 1000)}s across ${s.latencySamples} recent calls — approaching the abort ceiling; timeouts/fallbacks are imminent (check rate pressure, prompt size, or concurrency)`,
    )
    escalate("degraded")
  }

  return {
    status,
    checkedAt: new Date(nowMs).toISOString(),
    reasons,
    lastRunAt: s.lastRunAt,
    lastDataAt: s.lastDataAt,
    lastBriefAt: s.lastBriefAt,
    hoursSinceLastRun: runAge,
    hoursSinceLastData: dataAge,
    hoursSinceLastBrief: briefAge,
    staleLocations: s.staleLocations,
    stuckJobs: s.stuckJobs,
    failedJobsRecent: s.failedJobsRecent,
    staleQueuedJobs: s.staleQueuedJobs,
    vendor: { down: s.vendorDown, paymentRequired: s.vendorPaymentRequired },
    fallbackSkillRate: s.fallbackSkillRate,
    briefsAssessed: s.briefsAssessed,
    rateLimitedRate: s.rateLimitedRate,
    rateLimitCallsSampled: s.rateLimitCallsSampled,
    producerLatencyP95Ms: s.producerLatencyP95Ms,
    latencySamples: s.latencySamples,
    thresholds: t,
  }
}

/** I/O: gather the raw freshness + queue signals from the DB. */
export async function fetchPipelineSignals(sb: SB, nowMs: number, staleHours: number): Promise<PipelineSignals> {
  const staleCutoffMs = nowMs - staleHours * 3_600_000
  const sinceIso = new Date(staleCutoffMs).toISOString()
  const zombieIso = new Date(nowMs - 20 * 60_000).toISOString()
  // Grace MUST exceed the queue's max retry backoff (3600s = 60m, see backoffSeconds) so a
  // legitimately-requeued job sitting at the backoff boundary isn't mistaken for a stalled worker.
  const queuedGraceIso = new Date(nowMs - 120 * 60_000).toISOString()
  const recentActiveIso = new Date(nowMs - RECENT_ACTIVE_DAYS * 24 * 3_600_000).toISOString()

  const [run, data, brief, recentBriefs, stuck, failedRows, staleQ, vendor] = await Promise.all([
    sb.from("pipeline_runs").select("started_at, finished_at").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("location_snapshots").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("daily_briefs").select("generated_at").order("generated_at", { ascending: false }).limit(1).maybeSingle(),
    // Per-location brief freshness (partial-stall) + per-skill health (fallback-rate) + provider stats
    // (rate-limit rate). The `brief->path` selects extract just those jsonb paths server-side, so we get
    // the small arrays/objects without pulling the whole (large) brief. Newest brief per recently-active location.
    sb.from("daily_briefs").select("location_id, generated_at, brief->skillHealth, brief->providerStats").gte("generated_at", recentActiveIso).order("generated_at", { ascending: false }),
    sb.from("signal_jobs").select("id", { count: "exact", head: true }).eq("status", "running").lt("claimed_at", zombieIso),
    // Distinct (location, pipeline) failures — fetch the rows and de-dup in JS (PostgREST can't distinct-count).
    sb.from("signal_jobs").select("location_id, pipeline").eq("status", "failed").gte("updated_at", sinceIso),
    sb.from("signal_jobs").select("id", { count: "exact", head: true }).eq("status", "queued").lt("scheduled_for", queuedGraceIso),
    detectDataForSeoHealth(sb, { nowMs }),
  ])

  // Newest brief per location (rows are ordered newest-first, so first seen per location wins).
  // The jsonb-path select isn't in the generated types, so treat rows loosely here.
  type RecentBriefRow = { location_id: string | null; generated_at: string; skillHealth: unknown; providerStats: unknown }
  const recentRows = (recentBriefs.data ?? []) as unknown as RecentBriefRow[]
  const newestBriefByLocation = new Map<string, { generatedAt: string; skillHealth: unknown; providerStats: unknown }>()
  for (const r of recentRows) {
    if (r.location_id && !newestBriefByLocation.has(r.location_id)) {
      newestBriefByLocation.set(r.location_id, { generatedAt: r.generated_at, skillHealth: r.skillHealth, providerStats: r.providerStats })
    }
  }
  let staleLocations = 0
  for (const b of newestBriefByLocation.values()) {
    if (new Date(b.generatedAt).getTime() < staleCutoffMs) staleLocations++
  }

  // Fleet-wide fallback rate over the newest brief per location that CARRIES per-skill health.
  // A slot counts as degraded if it served a fallback or the skill threw. Briefs without skillHealth
  // (pre-2026-07-03) are excluded — can't assess them — so briefsAssessed gates the alert.
  let degradedSlots = 0
  let totalSlots = 0
  let briefsAssessed = 0
  const latencies: number[] = [] // producer elapsedMs samples (p95 watch signal); absent pre-2026-07-04
  for (const b of newestBriefByLocation.values()) {
    const health = Array.isArray(b.skillHealth)
      ? (b.skillHealth as Array<{ usedFallback?: unknown; status?: unknown; elapsedMs?: unknown }>)
      : null
    if (!health || health.length === 0) continue
    briefsAssessed++
    for (const h of health) {
      totalSlots++
      if (h?.usedFallback === true || h?.status === "failed") degradedSlots++
      if (typeof h?.elapsedMs === "number" && h.elapsedMs >= 0) latencies.push(h.elapsedMs)
    }
  }
  const fallbackSkillRate = totalSlots > 0 ? degradedSlots / totalSlots : 0

  // p95 producer latency over the sampled calls (ascending sort; index = ceil(0.95n)-1).
  latencies.sort((a, b) => a - b)
  const producerLatencyP95Ms = latencies.length > 0 ? latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] : 0

  // Fleet-wide rate-limit rate over the newest brief per location that CARRIES providerStats. Briefs
  // without it (pre-2026-07-04) are excluded → the sample count gates the alert (no false alarms).
  let rateLimitedTotal = 0
  let requestsTotal = 0
  for (const b of newestBriefByLocation.values()) {
    const ps = b.providerStats as { requests?: unknown; rateLimited?: unknown } | null
    if (!ps || typeof ps.requests !== "number" || typeof ps.rateLimited !== "number") continue
    requestsTotal += ps.requests
    rateLimitedTotal += ps.rateLimited
  }
  const rateLimitedRate = requestsTotal > 0 ? rateLimitedTotal / requestsTotal : 0

  const failedKeys = new Set((failedRows.data ?? []).map((r) => `${r.location_id}|${r.pipeline}`))

  return {
    lastRunAt: (run.data?.finished_at ?? run.data?.started_at) ?? null,
    lastDataAt: data.data?.created_at ?? null,
    lastBriefAt: brief.data?.generated_at ?? null,
    staleLocations,
    stuckJobs: stuck.count ?? 0,
    failedJobsRecent: failedKeys.size,
    staleQueuedJobs: staleQ.count ?? 0,
    vendorDown: vendor.down,
    vendorPaymentRequired: vendor.paymentRequired,
    fallbackSkillRate,
    briefsAssessed,
    rateLimitedRate,
    rateLimitCallsSampled: requestsTotal,
    producerLatencyP95Ms,
    latencySamples: latencies.length,
  }
}

/** Compose: fetch the signals, then evaluate. Read-only; safe to call from a health probe. */
export async function detectPipelineHealth(
  sb: SB,
  opts: { nowMs?: number; staleHours?: number } = {},
): Promise<PipelineHealthVerdict> {
  const nowMs = opts.nowMs ?? Date.now()
  const staleHours = opts.staleHours ?? (Number(process.env.STALE_PIPELINE_HOURS) || DEFAULT_THRESHOLDS.staleHours)
  const thresholds: PipelineHealthThresholds = { ...DEFAULT_THRESHOLDS, staleHours }
  const signals = await fetchPipelineSignals(sb, nowMs, staleHours)
  return evaluatePipelineHealth(signals, nowMs, thresholds)
}
