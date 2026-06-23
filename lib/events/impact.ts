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
  role: EventRole
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
  pctLift: number | null
  absoluteIncremental: number
  accessDisruption: number
  doors: { relative: boolean; absolute: boolean; disruption: boolean }
  surface: boolean
  /** 0..100 ranking score for top-K selection across a restaurant's events. */
  score: number
  channels: ImpactChannel[]
}

// ── Tunable weights (0..100 scale where relevant; defaults, nudged from feedback) ──

/** Fraction of attendees who could plausibly visit, by geo role. */
export const BASE_CAPTURE: Record<EventRole, number> = {
  local_foot: 0.05,
  local_traffic: 0.012,
  metro_hook: 0.0015,
  route_corridor: 0, // route events don't add covers — they disrupt access
  out_of_area: 0,
  ungeocoded: 0,
}

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

/** Captivity: a captive egress path past the door (stadium a block away) concentrates
 *  the crowd; a diffuse far venue does not. Keyed off role + draw size. */
export function captivity(role: EventRole, capacityHigh: number | null): number {
  const big = (capacityHigh ?? 0) >= 20000
  if (role === "local_foot") return big ? 2.0 : 1.4
  if (role === "local_traffic") return big ? 1.3 : 1.1
  return 1.0
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

  const cap = BASE_CAPTURE[input.role] ?? 0
  const fit = input.fit ?? 1
  const capt = captivity(input.role, input.capacityHigh)
  const absoluteIncremental = Math.round(attendance * cap * fit * capt * input.daypartOverlap)
  const incrementalPerHour = absoluteIncremental / DRAW_WINDOW_HOURS

  // Relative door (needs the restaurant's own curve).
  let baselinePerHour: number | null = null
  let pctLift: number | null = null
  if (input.baselineCurve && input.baselineCurve.length > 0) {
    const hour = input.eventHour != null && input.eventHour >= 0 && input.eventHour < input.baselineCurve.length
      ? input.eventHour
      : peakHourOf(input.baselineCurve)
    const score = input.baselineCurve[hour] ?? 0
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
