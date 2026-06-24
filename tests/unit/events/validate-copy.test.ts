import { describe, it, expect } from "vitest"
import { generateEventInsights, sanitizeEventTitle, type InsightContext } from "@/lib/events/insights"
import { scoreEventImpact, type ImpactInputs } from "@/lib/events/impact"
import type { NormalizedEvent, NormalizedEventsSnapshotV1 } from "@/lib/events/types"

// ── Deterministic inputs ────────────────────────────────────────────────────

const eveningPeak = (() => {
  const c = Array.from({ length: 24 }, () => 15)
  c[18] = 80; c[19] = 95; c[20] = 92; c[21] = 70
  return c
})()
const thinBarCurve = (() => {
  const c = Array.from({ length: 24 }, () => 8)
  c[14] = 18; c[15] = 22; c[20] = 25
  return c
})()

// A WC2026 match that passed the validation gate: validated fields are stamped, the SCRAPED title
// is a sensational/garbage string we must NEVER see in customer copy.
const SCRAPED_TITLE = "🔥 ENGLAND vs CROATIA — Tickets!! at Dallas Stadium (WRONGtown)"

function validatedSurgeEvent(over: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    uid: "wc-1",
    source: "dataforseo_google_events",
    keyword: "world cup",
    dateRange: "week",
    title: SCRAPED_TITLE,
    venue: { name: "Dallas Stadium", lat: 32.7473, lng: -97.0945 },
    catalogVenueName: "AT&T Stadium",
    startDatetime: "2026-06-17T13:30:00", // scraped/guessed time — wrong; authoritative is 15:00
    distanceMiles: 0.2,
    role: "local_foot",
    magnitude: "major",
    capacityLow: 80000,
    capacityHigh: 80000,
    capacityConfidence: "measured",
    isRouteEvent: false,
    // validated fields (set by the gate):
    venueConfidence: "matched_place_id",
    validatedVenueName: "AT&T Stadium",
    authoritativeLocalStart: "2026-06-17 15:00",
    fixtureRef: "fifa-world-cup-2026:att-stadium:2026-06-17",
    leagueValidated: true,
    ...over,
  }
}

function snapshotOf(events: NormalizedEvent[]): NormalizedEventsSnapshotV1 {
  return {
    version: "1.0",
    capturedAt: new Date().toISOString(),
    horizon: "week",
    queries: [],
    events,
    summary: { totalEvents: events.length, byDate: {}, byVenueName: {}, byDomain: {} },
  }
}

const canesCtx: InsightContext = {
  locationName: "Raising Cane's Forney",
  locationRating: 4.4,
  locationReviewCount: 800,
  competitors: [],
  serviceModel: "quick service / drive-thru + dine-in",
  seats: 80,
  densityTier: "suburban",
  // Friday baseline curve (dow 5 = 2026-06-17 is a Wednesday=dow 3); fill all 7 with the peak.
  baselineCurveByDow: Array.from({ length: 7 }, () => eveningPeak),
  hours: { servesLunch: true, servesDinner: true },
}

describe("P13 R1 — copy is templated ONLY from validated fields", () => {
  const event = validatedSurgeEvent()
  const insights = generateEventInsights({
    current: snapshotOf([event]),
    previous: null,
    matches: [],
    previousMatches: null,
    locationId: "loc",
    dateKey: "2026-06-15",
    context: canesCtx,
    allEvents: [event],
  })
  const surge = insights.find((i) => i.insight_type === "events.major_lobby_surge")

  it("surfaces the WC2026 surge", () => {
    expect(surge).toBeTruthy()
  })

  it("NEVER interpolates the raw scraped title into customer copy (title + summary + recs)", () => {
    expect(surge).toBeTruthy()
    const copy = JSON.stringify({
      title: surge!.title,
      summary: surge!.summary,
      recommendations: surge!.recommendations,
    })
    // The raw scraped string and its garbage tokens must be absent from customer-facing copy.
    expect(copy).not.toContain(SCRAPED_TITLE)
    expect(copy.toLowerCase()).not.toContain("wrongtown")
    expect(copy).not.toContain("🔥")
    expect(copy).not.toContain("Tickets!!")
  })

  it("uses the CANONICAL venue + authoritative date + competition label in copy", () => {
    // Title is "Major event nearby: {validated competition label}" — names the COMPETITION,
    // never the scraped pairing.
    expect(surge!.title).toContain("FIFA World Cup")
    expect(surge!.title).not.toContain("Croatia")
    // Summary anchors to the CANONICAL venue + authoritative date.
    expect(surge!.summary).toContain("AT&T Stadium")
    expect(surge!.summary).toContain("FIFA World Cup")
    // Authoritative local date is Jun 17 (not derived from the scraped time).
    expect(surge!.summary).toMatch(/Jun 17/)
  })

  it("provenance evidence carries the validated fields + fixtureRef (internal, not copy)", () => {
    expect(surge!.evidence.validated_venue).toBe("AT&T Stadium")
    expect(surge!.evidence.fixture_ref).toBe("fifa-world-cup-2026:att-stadium:2026-06-17")
    expect(surge!.evidence.league_validated).toBe(true)
    expect(surge!.evidence.authoritative_local_start).toBe("2026-06-17 15:00")
  })
})

describe("P13 R3 — same event inverts sign by own-baseline (incremental ÷ own-baseline)", () => {
  const base: Omit<ImpactInputs, "serviceModel" | "seats" | "baselineCurve"> = {
    capacityLow: 1200,
    capacityHigh: 1200,
    role: "local_traffic",
    isRoute: false,
    ticketSourceCount: 2,
    daypartOverlap: 1,
    fit: 1.4,
    eventHour: 20,
    densityTier: "suburban",
  }

  it("LIFTS for a 150/day thin-baseline indie (relative door fires)", () => {
    const indie = scoreEventImpact({
      ...base,
      serviceModel: "bar + dine-in",
      seats: 40,
      baselineCurve: thinBarCurve,
    })
    expect(indie.doors.relative).toBe(true)
    expect(indie.surface).toBe(true)
    expect(indie.pctLift).not.toBeNull()
    expect(indie.pctLift!).toBeGreaterThan(0)
    expect(indie.channels.some((c) => c.direction === "up")).toBe(true)
  })

  it("SUPPRESSES the SAME event for a high-baseline Cane's (own baseline swallows it)", () => {
    const canes = scoreEventImpact({
      ...base,
      fit: 0.8,
      serviceModel: "quick service / drive-thru + dine-in",
      seats: 80,
      baselineCurve: eveningPeak,
    })
    // The relative door does NOT fire — the same event reads as a wash against Cane's own curve.
    expect(canes.doors.relative).toBe(false)
    // And the indie's pctLift is meaningfully larger than Cane's (sign/magnitude inverts by baseline).
    const indie = scoreEventImpact({ ...base, serviceModel: "bar + dine-in", seats: 40, baselineCurve: thinBarCurve })
    expect(indie.pctLift!).toBeGreaterThan(canes.pctLift!)
  })
})

describe("P13 R3 — baseline-missing → lower confidence, not silent absolute-only", () => {
  it("flags baselineMissing + lowers surfaceConfidence when no own-curve is present", () => {
    const noBaseline = scoreEventImpact({
      capacityLow: 80000,
      capacityHigh: 80000,
      role: "local_foot",
      isRoute: false,
      ticketSourceCount: 2,
      daypartOverlap: 1,
      fit: 1.4,
      eventHour: 20,
      densityTier: "suburban",
      serviceModel: "quick service / drive-thru + dine-in",
      seats: 80,
      baselineCurve: null, // ← missing
    })
    expect(noBaseline.baselineMissing).toBe(true)
    expect(noBaseline.pctLift).toBeNull()
    expect(noBaseline.doors.relative).toBe(false)
    // It can still SURFACE via the absolute door, but at LOW confidence (couldn't relativize).
    expect(noBaseline.surface).toBe(true)
    expect(noBaseline.surfaceConfidence).toBe("low")
  })

  it("WITH a baseline + relative corroboration → high confidence", () => {
    const withBaseline = scoreEventImpact({
      capacityLow: 1200,
      capacityHigh: 1200,
      role: "local_traffic",
      isRoute: false,
      ticketSourceCount: 2,
      daypartOverlap: 1,
      fit: 1.6,
      eventHour: 20,
      densityTier: "suburban",
      serviceModel: "bar + dine-in",
      seats: 40,
      baselineCurve: thinBarCurve,
    })
    expect(withBaseline.baselineMissing).toBe(false)
    expect(withBaseline.doors.relative).toBe(true)
    expect(withBaseline.surfaceConfidence).toBe("high")
  })

  it("the surge insight lowers confidence when the baseline was missing", () => {
    // Cane's-style event but the location has NO baseline curve for the event dow.
    const event = validatedSurgeEvent()
    const ctxNoBaseline: InsightContext = { ...canesCtx, baselineCurveByDow: null }
    const insights = generateEventInsights({
      current: snapshotOf([event]),
      previous: null,
      matches: [],
      previousMatches: null,
      locationId: "loc",
      dateKey: "2026-06-15",
      context: ctxNoBaseline,
      allEvents: [event],
    })
    const surge = insights.find((i) => i.insight_type === "events.major_lobby_surge")
    expect(surge).toBeTruthy()
    // capacity is "measured" (would be high), but baseline-missing caps it lower.
    expect(surge!.confidence).toBe("low")
  })
})

describe("P13 §5 — sanitizeEventTitle (no raw scraped-title leak in density-insight copy)", () => {
  it("strips emoji / pictographs", () => {
    expect(sanitizeEventTitle("🔥 Summer Concert Series 🎶")).toBe("Summer Concert Series")
  })
  it("drops promo / ticket tails and hype punctuation", () => {
    expect(sanitizeEventTitle("England vs Croatia — Tickets!! on sale now")).toBe("England vs Croatia")
    expect(sanitizeEventTitle("Food Truck Fest!!!")).toBe("Food Truck Fest")
  })
  it("length-caps a runaway title and collapses whitespace", () => {
    const out = sanitizeEventTitle("A   very    long " + "x".repeat(100))
    expect(out.length).toBeLessThanOrEqual(60)
    expect(out).not.toMatch(/\s{2,}/)
  })
  it("leaves a clean title intact and returns empty for an all-emoji title", () => {
    expect(sanitizeEventTitle("Downtown Jazz Night")).toBe("Downtown Jazz Night")
    expect(sanitizeEventTitle("🔥🎉")).toBe("")
  })
})
