import { describe, it, expect } from "vitest"
import {
  scoreEventImpact,
  parseServiceChannels,
  fillSignal,
  attendancePrior,
  type ImpactInputs,
} from "@/lib/events/impact"

// Baseline popular-times curves (0..100 per hour, Google scale). 24 entries.
const flat = (v: number) => Array.from({ length: 24 }, () => v)
const eveningPeak = (() => {
  const c = flat(15)
  c[18] = 80; c[19] = 95; c[20] = 92; c[21] = 70 // dinner peak
  return c
})()
const thinBarCurve = (() => {
  const c = flat(8)
  c[19] = 22; c[20] = 25; c[21] = 28; c[22] = 24 // a quiet bar's early-evening
  return c
})()
const ruralDinerCurve = (() => {
  const c = flat(10)
  c[18] = 20; c[19] = 22; c[20] = 18 // flat weeknight
  return c
})()

const CANES: Pick<ImpactInputs, "serviceModel" | "seats" | "densityTier" | "baselineCurve"> = {
  serviceModel: "quick service / drive-thru + dine-in",
  seats: 80,
  densityTier: "suburban",
  baselineCurve: eveningPeak,
}

describe("fillSignal + attendancePrior", () => {
  it("ramps with ticketing evidence", () => {
    expect(fillSignal(0)).toBe(0.35)
    expect(fillSignal(1)).toBe(0.6)
    expect(fillSignal(2)).toBe(0.85)
    expect(fillSignal(0, true)).toBe(1.0)
  })
  it("magnitude prior scales", () => {
    expect(attendancePrior("major")).toBeGreaterThan(attendancePrior("moderate"))
    expect(attendancePrior("moderate")).toBeGreaterThan(attendancePrior("minor"))
  })
})

describe("parseServiceChannels", () => {
  it("Cane's = lobby + drive-thru", () => {
    const c = parseServiceChannels("quick service / drive-thru + dine-in")
    expect(c.lobby).toBe(true)
    expect(c.driveThru).toBe(true)
    expect(c.dineIn).toBe(true)
  })
  it("bar = dine-in surge, no lobby/drive-thru", () => {
    const c = parseServiceChannels("bar + dine-in")
    expect(c.lobby).toBe(false)
    expect(c.dineIn).toBe(true)
    expect(c.driveThru).toBe(false)
  })
  it("takeout-only QSR has no walk-in lobby", () => {
    const c = parseServiceChannels("quick service / drive-thru or takeout only")
    expect(c.lobby).toBe(false)
  })
})

describe("Scenario 1 — Cane's, one block from an 80k World Cup stadium", () => {
  const wc = scoreEventImpact({
    ...CANES,
    capacityLow: 80000,
    capacityHigh: 80000,
    role: "local_foot",
    isRoute: false,
    ticketSourceCount: 2,
    daypartOverlap: 1,
    fit: 1.4,
    eventHour: 20,
  })

  it("SURFACES the World Cup match", () => {
    expect(wc.surface).toBe(true)
  })
  it("clears the ABSOLUTE door (lobby flood), regardless of the relative one", () => {
    expect(wc.doors.absolute).toBe(true)
    expect(wc.absoluteIncremental).toBeGreaterThan(1000)
  })
  it("splits into lobby-UP + drive-thru-DOWN (the founder's exact picture)", () => {
    const lobby = wc.channels.find((c) => c.channel === "lobby")
    const drive = wc.channels.find((c) => c.channel === "drive_thru")
    expect(lobby?.direction).toBe("up")
    expect(drive?.direction).toBe("down")
    expect(wc.doors.disruption).toBe(true)
  })

  it("SUPPRESSES a tiny Latin-music night at the same restaurant", () => {
    const latin = scoreEventImpact({
      ...CANES,
      capacityLow: 800,
      capacityHigh: 800,
      role: "local_traffic",
      isRoute: false,
      ticketSourceCount: 0,
      daypartOverlap: 1,
      fit: 0.8,
      eventHour: 20,
    })
    expect(latin.surface).toBe(false)
  })
})

describe("Scenario 2 — the SAME event inverts for a 100–200/day bar", () => {
  const event = {
    capacityLow: 1000,
    capacityHigh: 1000,
    role: "local_traffic" as const,
    isRoute: false,
    ticketSourceCount: 2,
    daypartOverlap: 1,
    eventHour: 20,
  }

  it("SURFACES for the thin-baseline bar (relative door)", () => {
    const bar = scoreEventImpact({
      ...event,
      serviceModel: "bar + dine-in",
      seats: 40,
      densityTier: "suburban",
      baselineCurve: thinBarCurve,
      fit: 1.6,
    })
    expect(bar.surface).toBe(true)
    expect(bar.doors.relative).toBe(true)
    expect(bar.channels.some((c) => c.channel === "dine_in" && c.direction === "up")).toBe(true)
  })

  it("SUPPRESSES for Cane's (high baseline swallows it)", () => {
    const canes = scoreEventImpact({ ...event, ...CANES, fit: 0.8 })
    expect(canes.surface).toBe(false)
  })
})

describe("Scenario 3 — small-town HS football game (biggest fish, small pond)", () => {
  it("SURFACES at a rural diner via the density-relative door", () => {
    const game = scoreEventImpact({
      capacityLow: 1500, // secondary_school catalog prior (low end)
      capacityHigh: 8000,
      role: "local_traffic",
      isRoute: false,
      ticketSourceCount: 0,
      daypartOverlap: 1,
      fit: 1.3,
      serviceModel: "dine-in",
      seats: 40,
      densityTier: "rural",
      baselineCurve: ruralDinerCurve,
      eventHour: 20,
    })
    expect(game.surface).toBe(true)
    expect(game.doors.relative).toBe(true)
  })
})

describe("Route events disrupt access, never claim draw", () => {
  it("marathon corridor suppresses the drive-thru, adds no covers", () => {
    const marathon = scoreEventImpact({
      capacityLow: 5000,
      capacityHigh: 5000,
      role: "route_corridor",
      isRoute: true,
      ticketSourceCount: 0,
      daypartOverlap: 1,
      serviceModel: "quick service / drive-thru + dine-in",
      seats: 80,
      densityTier: "suburban",
      baselineCurve: eveningPeak,
      eventHour: 9,
    })
    expect(marathon.absoluteIncremental).toBe(0) // route capture is 0
    expect(marathon.doors.disruption).toBe(true)
    expect(marathon.channels.some((c) => c.channel === "drive_thru" && c.direction === "down")).toBe(true)
  })
})
