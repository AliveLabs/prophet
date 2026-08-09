// ---------------------------------------------------------------------------
// Event impact model (Events Impact Engine · P2) — pure, deterministic, testable.
//
// The precision half of the engine: given a detected event and THIS restaurant's
// own traffic fingerprint, decide whether it materially matters — and split it by
// service channel (lobby ↑ vs drive-thru ↓). The same event must invert across
// restaurants: a 600-person Latin-music night is noise for a 250/hr Cane's but a
// real lift for a 150/day bar; a small-town HS game is the biggest thing in town.
//
// A 3-way-OR over commensurable axes — a huge-ABSOLUTE event and a huge-RELATIVE
// event each pass by a DIFFERENT door, so we never need a POS or true cover count:
//   • RELATIVE  pct_lift   = incremental/hr ÷ baseline/hr (over the restaurant's
//                            own popular-times curve) — carries the thin-baseline bar.
//   • ABSOLUTE  incremental covers ≥ density-calibrated bar — carries Cane's.
//   • DISRUPTION access hit on the drive-thru/lot channel — carries route closures.
// Bars scale with local density (numeric weights on a 0–100 scale per the
// calibration rule — defaults here, tunable from feedback). Degrades gracefully:
// without a baseline curve the relative door is simply unavailable; the others stand.
// ---------------------------------------------------------------------------

import type { EventRole } from "./relevance"

export type DensityTier = "rural" | "suburban" | "urban" | "dense_urban"

export type ServiceChannels = {
  dineIn: boolean
  lobby: boolean // walk-in counter / dining room a crowd can flood
  driveThru: boolean
  takeout: boolean
}

export type ImpactInputs = {
  // ── Event ──
  capacityLow: number | null
  capacityHigh: number | null
  /** Geo role. Governs ELIGIBILITY and how the event may be FRAMED to the operator
   *  (an unresolved venue may never claim "nearby"). Distance weighting no longer
   *  keys off this — see `distanceMiles`. */
  role: EventRole
  /** Measured miles from the restaurant to the venue. This is what now scales impact,
   *  continuously. null (never geocoded) contributes no draw. */
  distanceMiles: number | null
  isRoute: boolean
  ticketSourceCount: number
  soldOut?: boolean
  /** 0..1 — does the event window overlap a daypart the restaurant serves & is open. */
  daypartOverlap: number
  /** Crowd→restaurant fit (cuisine/price/type vs the event audience). Default 1. */
  fit?: number
  // ── Restaurant ──
  serviceModel: string | null
  seats: number | null
  /** The restaurant's own popular-times row for the event's day-of-week (0..100 per
   *  hour, Google scale). Optional — when absent the relative door is skipped. */
  baselineCurve?: number[] | null
  /** Local hour (0..23) the event lets out / peaks, for the curve lookup. */
  eventHour?: number | null
  densityTier: DensityTier
}

export type ImpactChannel = {
  channel: "lobby" | "dine_in" | "drive_thru"
  direction: "up" | "down"
  /** Relative magnitude 0..1 for severity/sorting. */
  intensity: number
}

export type ImpactResult = {
  attendance: number
  fillSignal: number
  incrementalPerHour: number
  baselinePerHour: number | null
  /** RELATIVE signal: incremental/hr ÷ THIS restaurant's own baseline/hr × 100. The same event
   *  inverts by own-baseline — a big % for a thin-baseline indie, a small % for a high-baseline
   *  QSR (Cane's). null when no baseline curve was available. */
  pctLift: number | null
  absoluteIncremental: number
  accessDisruption: number
  doors: { relative: boolean; absolute: boolean; disruption: boolean }
  surface: boolean
  /** 0..100 ranking score for top-K selection across a restaurant's events. */
  score: number
  channels: ImpactChannel[]
  // ── P13 R3: baseline-presence confidence gate ──
  /** True when the restaurant's own popular-times baseline was MISSING, so the relative door
   *  couldn't run and surfacing rests on absolute/disruption only. The consumer should LOWER
   *  confidence rather than silently treat the absolute-only read as fully trustworthy. */
  baselineMissing: boolean
  /** Surfacing confidence: "high" when the relative (own-baseline) door corroborates; "medium"
   *  when an absolute/disruption door fires WITH a baseline present; "low" when the baseline was
   *  missing (we couldn't relativize to this restaurant). */
  surfaceConfidence: "high" | "medium" | "low"
}

// ── Tunable weights (0..100 scale where relevant; defaults, nudged from feedback) ──

/* ── Distance as a CONTINUOUS reduction, not a cutoff (Bryan, 2026-08-09) ─────
   The old model keyed capture off the geo ROLE, which is itself a step function of
   distance. That was wrong in two ways:

     1. A 4x cliff across an arbitrary boundary: a restaurant at 0.49mi got 0.05
        capture, one at 0.51mi got 0.012, for two hundredths of a mile.
     2. Everything past ~3mi scored EXACTLY ZERO regardless of size, so a sold-out
        80,000-seat stadium show 4 miles away was modeled as no impact at all.

   Distance should REDUCE impact smoothly, and how far an event reaches should scale
   with how many people it draws. A stadium show pulls from across the metro; a
   300-person club night does not. That is what these two functions encode. The geo
   ROLE keeps its separate job: gating what we may CLAIM (an event we can't place
   may never be described as nearby). Weighting and framing are now distinct. */

/** Capture at the door (distance 0) — the share of a crowd that could plausibly walk
 *  in when the restaurant is AT the venue. */
export const PEAK_CAPTURE = 0.055

/** Anchors for the reach curve, solved so that a 1,200-person event (the "moderate"
 *  attendance prior) reproduces the OLD capture values at the typical distance of each
 *  old role band: ~0.05 at 0.25mi (old local_foot) and ~0.012 at 1.5mi (old
 *  local_traffic). The common case is therefore unchanged; only the cliffs move. */
// NOTE: this is a post-fill ATTENDANCE, not a raw capacity. A "moderate" 1,200-capacity
// event with a typical fill signal lands near 850 actual attendees, and anchoring on the
// capacity number instead made every event reach ~25% short of the old model.
const REFERENCE_ATTENDANCE = 850
const REFERENCE_DECAY_MILES = 0.79
const DECAY_EXPONENT = 0.5
const MIN_DECAY_MILES = 0.3
const MAX_DECAY_MILES = 8

/** How far people habitually travel, by how spread out the area is. A rural diner's
 *  customers routinely drive 15 minutes; a dense-urban one's do not. These mirror the
 *  ratios already calibrated in relevance.ts DENSITY_RINGS (rural 5.0mi vs suburban
 *  3.0mi ≈ 1.67x), so the two models agree about what "far" means. */
const DENSITY_REACH: Record<DensityTier, number> = {
  dense_urban: 0.55,
  urban: 0.8,
  suburban: 1.0,
  rural: 1.67,
}

/** How far an event's pull REACHES, in miles: square-root scaling in attendance (a 16x
 *  bigger crowd reaches 4x farther), scaled by how far people in this area normally
 *  travel. Clamped at both ends so neither a tiny event nor an arena-sized one runs away. */
export function decayLengthMiles(attendance: number, densityTier: DensityTier = "suburban"): number {
  const a = Math.max(1, attendance)
  const l =
    REFERENCE_DECAY_MILES *
    Math.pow(a / REFERENCE_ATTENDANCE, DECAY_EXPONENT) *
    DENSITY_REACH[densityTier]
  return Math.min(MAX_DECAY_MILES, Math.max(MIN_DECAY_MILES, l))
}

/** Fraction of an event's crowd that could plausibly visit, as a smooth function of
 *  distance, draw size, and how far people here travel. Replaces the BASE_CAPTURE role
 *  lookup.
 *
 *  Shape is a GRAVITY kernel — peak / (1 + (d/L)^2) — not an exponential. Retail trade
 *  areas have a fat tail: a plateau near the venue, then a steady fall, rather than the
 *  near-vanishing tail an exponential gives. An exponential fit to the same two anchors
 *  under-credited small events at a mile or two badly enough to stop a small-town game
 *  from surfacing at the diner across the road, which is a case the engine is meant to
 *  catch.
 *
 *  A null distance returns 0: we cannot model a distance we never measured. */
export function captureAt(
  distanceMiles: number | null,
  attendance: number,
  densityTier: DensityTier = "suburban",
): number {
  if (distanceMiles == null || !Number.isFinite(distanceMiles)) return 0
  const d = Math.max(0, distanceMiles)
  const l = decayLengthMiles(attendance, densityTier)
  return PEAK_CAPTURE / (1 + Math.pow(d / l, 2))
}

/** Captivity: a captive egress path past the door concentrates a crowd; a diffuse far
 *  venue does not. Was a role step (2.0 / 1.4 / 1.3 / 1.1 / 1.0), which re-introduced
 *  the exact cliff the capture curve removes, so it now decays continuously over a short
 *  walk-by length scale. Calibrated to land on the old values at their typical distances
 *  (~1.8 at 0.25mi and ~1.3 at 1.5mi for a big venue). */
const CAPTIVITY_DECAY_MILES = 1.25

export function captivityAt(distanceMiles: number | null, capacityHigh: number | null): number {
  if (distanceMiles == null || !Number.isFinite(distanceMiles)) return 1
  const peak = (capacityHigh ?? 0) >= 20000 ? 2.0 : 1.4
  return 1 + (peak - 1) * Math.exp(-Math.max(0, distanceMiles) / CAPTIVITY_DECAY_MILES)
}

/** Roles that may never contribute draw regardless of distance. Route events disrupt
 *  access rather than adding covers; an ungeocoded event has no measured distance at all. */
const NO_DRAW_ROLES = new Set<EventRole>(["route_corridor", "ungeocoded"])

/** Egress window (hours) the incremental demand spreads over. */
const DRAW_WINDOW_HOURS = 2

/** Density-calibrated surfacing bars. pctBar = relative-lift %; absBar = incremental covers. */
export const DENSITY_BARS: Record<DensityTier, { pctBar: number; absBar: number }> = {
  rural: { pctBar: 30, absBar: 15 },
  suburban: { pctBar: 50, absBar: 45 },
  urban: { pctBar: 70, absBar: 150 },
  dense_urban: { pctBar: 90, absBar: 400 },
}

/** Access-disruption severity (0..1) considered "material" enough to surface. */
const DISRUPTION_MATERIAL = 0.4

export function fillSignal(ticketSourceCount: number, soldOut?: boolean): number {
  if (soldOut) return 1.0
  if (ticketSourceCount >= 2) return 0.85
  if (ticketSourceCount === 1) return 0.6
  return 0.35
}

/** Peak covers/hour the restaurant can turn — a throughput prior by service model
 *  (a QSR/drive-thru does hundreds/hr; a bar does dozens). Seats refine it. */
export function peakThroughputPerHour(serviceModel: string | null, seats: number | null): number {
  const s = (serviceModel ?? "").toLowerCase()
  if (s.includes("quick service") || s.includes("drive-thru") || s.includes("fast food")) return 250
  if (s.includes("fast casual")) return 120
  if (s.includes("bar")) return seats ? Math.round(seats * 1.5) : 60
  if (s.includes("fine") || s.includes("upscale")) return seats ? Math.round(seats * 0.6) : 25
  if (s.includes("dine-in") || s.includes("casual")) return seats ? Math.round(seats * 1.0) : 60
  return seats ? Math.round(seats * 1.0) : 80
}

/** Attendance prior (people) for an event with no measured/catalog capacity, by magnitude. */
export function attendancePrior(magnitude: "major" | "moderate" | "minor"): number {
  if (magnitude === "major") return 15000
  if (magnitude === "moderate") return 1200
  return 300
}

export function parseServiceChannels(serviceModel: string | null): ServiceChannels {
  const s = (serviceModel ?? "").toLowerCase()
  const quickService = s.includes("quick service") || s.includes("fast food") || s.includes("fast casual")
  // "drive-thru or takeout ONLY" = no walk-in dining room to flood.
  const onlyTakeoutDrive = (s.includes("drive-thru") || s.includes("takeout") || s.includes("take-out")) && s.includes("only")
  const driveThru = s.includes("drive-thru") || s.includes("drive thru")
  const takeout = s.includes("takeout") || s.includes("take-out") || s.includes("to-go")
  const dineIn = !onlyTakeoutDrive && (s.includes("dine-in") || s.includes("bar") || s.includes("casual") || s.includes("fine") || quickService)
  // A QSR has a lobby a crowd can flood; a bar/sit-down surges its seating (dine_in), not a "lobby".
  const lobby = !onlyTakeoutDrive && quickService
  return { dineIn, lobby, driveThru, takeout }
}

/** Access disruption (0..1) a route/closure event imposes on the drive-thru/lot channel. */
function accessDisruptionFor(input: ImpactInputs, channels: ServiceChannels): number {
  if (!input.isRoute && input.role !== "route_corridor") {
    // Non-route: a very large nearby event still gridlocks the lot/drive-thru lane.
    if (channels.driveThru && (input.capacityHigh ?? 0) >= 20000 && (input.role === "local_foot" || input.role === "local_traffic")) {
      return 0.6 * input.daypartOverlap
    }
    return 0
  }
  if (!channels.driveThru && !channels.takeout) return 0 // pure dine-in: only matters if parking dies
  // Route corridor near the restaurant chokes the drive-thru/lot during the window.
  const proximity = input.role === "route_corridor" ? 0.8 : 0.5
  return Math.min(1, proximity * Math.max(input.daypartOverlap, 0.5))
}

export function scoreEventImpact(input: ImpactInputs): ImpactResult {
  const channels = parseServiceChannels(input.serviceModel)
  const fs = fillSignal(input.ticketSourceCount, input.soldOut)
  const capBase = input.capacityLow ?? input.capacityHigh ?? 0
  const attendance = Math.round(capBase * fs)

  // Distance reduces draw smoothly and reach scales with the crowd size, so a huge event
  // a few miles out is modeled as a real (smaller) effect instead of a hard zero.
  const cap = NO_DRAW_ROLES.has(input.role)
    ? 0
    : captureAt(input.distanceMiles, attendance, input.densityTier)
  const fit = input.fit ?? 1
  const capt = captivityAt(input.distanceMiles, input.capacityHigh)
  const absoluteIncremental = Math.round(attendance * cap * fit * capt * input.daypartOverlap)
  const incrementalPerHour = absoluteIncremental / DRAW_WINDOW_HOURS

  // RELATIVE door (needs the restaurant's OWN curve). pctLift = incremental/hr ÷ this
  // restaurant's own baseline/hr — so the SAME event inverts sign by own-baseline (a lift for a
  // thin-baseline indie, a wash for a high-baseline QSR). P13 R3: when the baseline is MISSING we
  // do NOT silently treat the absolute-only read as equivalent — we flag it so the consumer
  // lowers confidence.
  const baselineMissing = !(input.baselineCurve && input.baselineCurve.length > 0)
  let baselinePerHour: number | null = null
  let pctLift: number | null = null
  if (!baselineMissing) {
    const curve = input.baselineCurve as number[]
    const hour = input.eventHour != null && input.eventHour >= 0 && input.eventHour < curve.length
      ? input.eventHour
      : peakHourOf(curve)
    const score = curve[hour] ?? 0
    const throughput = peakThroughputPerHour(input.serviceModel, input.seats)
    baselinePerHour = Math.max(1, (score / 100) * throughput)
    pctLift = (incrementalPerHour / baselinePerHour) * 100
  }

  const accessDisruption = accessDisruptionFor(input, channels)
  const bars = DENSITY_BARS[input.densityTier]

  const doors = {
    relative: pctLift != null && pctLift >= bars.pctBar,
    absolute: absoluteIncremental >= bars.absBar,
    disruption: accessDisruption >= DISRUPTION_MATERIAL,
  }
  const surface = doors.relative || doors.absolute || doors.disruption

  // P13 R3 confidence gate: the relative (own-baseline) door is the surest read because it's
  // calibrated to THIS restaurant. Without a baseline we can't relativize → lower confidence.
  const surfaceConfidence: ImpactResult["surfaceConfidence"] = doors.relative
    ? "high"
    : baselineMissing
      ? "low"
      : "medium"

  // Ranking score (0..100): the strongest door, so top-K picks the biggest fish.
  const relScore = pctLift != null ? Math.min(100, (pctLift / bars.pctBar) * 50) : 0
  const absScore = Math.min(100, (absoluteIncremental / Math.max(1, bars.absBar)) * 50)
  const disScore = accessDisruption * 100
  const score = Math.round(Math.max(relScore, absScore, disScore))

  // Channel split — the same event can drive opposite-signed channels (Cane's:
  // lobby floods while the drive-thru/lot chokes).
  const out: ImpactChannel[] = []
  if (surface && absoluteIncremental > 0 && (channels.lobby || channels.dineIn)) {
    const intensity = Math.min(1, absoluteIncremental / Math.max(bars.absBar, 1))
    out.push({ channel: channels.lobby ? "lobby" : "dine_in", direction: "up", intensity })
  }
  if (accessDisruption > 0 && channels.driveThru) {
    out.push({ channel: "drive_thru", direction: "down", intensity: accessDisruption })
  }

  return {
    attendance,
    fillSignal: fs,
    incrementalPerHour,
    baselinePerHour,
    pctLift,
    absoluteIncremental,
    accessDisruption,
    doors,
    surface,
    score,
    channels: out,
    baselineMissing,
    surfaceConfidence,
  }
}

function peakHourOf(curve: number[]): number {
  let best = 0
  let bestVal = -1
  for (let h = 0; h < curve.length; h++) {
    if ((curve[h] ?? 0) > bestVal) {
      bestVal = curve[h] ?? 0
      best = h
    }
  }
  return best
}
