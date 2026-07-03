import { describe, test, expect } from "vitest"
import { generateOwnTrafficInsights } from "@/lib/insights/own-traffic-insights"
import { lintVoice } from "@/lib/eval/voice-rules"
import { isOperationsSignal } from "@/lib/skills/operations/skill"
import { isMarketingSignal } from "@/lib/skills/marketing/skill"
import { domainLabel } from "@/lib/skills/evidence-format"
import type { BusyTimesResult } from "@/lib/providers/outscraper"

// A day open 9am-9pm (hour 21 exclusive) with a dead 9pm-ish edge and a flat midday.
// hourly_scores index = clock hour (0..23).
function makeDeadEdgeDay(dow: number): BusyTimesResult["days"][number] {
  const scores = new Array(24).fill(0)
  // Open 9-21 (9am - 9pm). Interior hours moderate/busy; last open hour (20, i.e. 8-9pm) dead.
  for (let h = 9; h < 20; h++) scores[h] = 60
  scores[20] = 5 // last open hour before close at 21 — dead
  return {
    day_of_week: dow,
    day_name: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dow],
    hourly_scores: scores,
    peak_hour: 12,
    peak_score: 60,
    slow_hours: [20],
  }
}

function makeFlatBusyDay(dow: number): BusyTimesResult["days"][number] {
  const scores = new Array(24).fill(0)
  for (let h = 9; h < 21; h++) scores[h] = 65 // uniformly busy all open hours — no edge, no slow window
  return {
    day_of_week: dow,
    day_name: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dow],
    hourly_scores: scores,
    peak_hour: 12,
    peak_score: 65,
    slow_hours: [],
  }
}

function makeSlowMiddayDay(dow: number): BusyTimesResult["days"][number] {
  const scores = new Array(24).fill(0)
  // Open 9am-9pm. Busy at open/close edges, dead 1-3pm (hours 13-14) in the middle.
  for (let h = 9; h < 21; h++) scores[h] = 70
  scores[13] = 10
  scores[14] = 10
  return {
    day_of_week: dow,
    day_name: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dow],
    hourly_scores: scores,
    peak_hour: 18,
    peak_score: 70,
    slow_hours: [13, 14],
  }
}

const MONDAY_9_TO_9 = "Monday: 9:00 AM – 9:00 PM"

const busyTimesWith = (days: BusyTimesResult["days"]): BusyTimesResult => ({
  competitor_id: "own",
  days,
  typical_time_spent: null,
  current_popularity: null,
  working_hours_lines: null,
})

describe("generateOwnTrafficInsights — hours.own_dead_edge_hour", () => {
  test("fires on a synthetic curve with a dead 9pm edge hour", () => {
    const out = generateOwnTrafficInsights({
      busyTimes: busyTimesWith([makeDeadEdgeDay(1)]),
      weekdayDescriptions: [MONDAY_9_TO_9],
      sampleWeeks: 1,
    })
    const edge = out.filter((i) => i.insight_type === "hours.own_dead_edge_hour")
    expect(edge.length).toBeGreaterThan(0)
    expect(edge[0].evidence.hour).toBe(20)
    expect(edge[0].evidence.day_of_week).toBe(1)
  })

  test("does NOT fire on a flat/busy curve", () => {
    const out = generateOwnTrafficInsights({
      busyTimes: busyTimesWith([makeFlatBusyDay(1)]),
      weekdayDescriptions: [MONDAY_9_TO_9],
      sampleWeeks: 1,
    })
    expect(out.filter((i) => i.insight_type === "hours.own_dead_edge_hour")).toHaveLength(0)
  })

  test("sampleWeeks gate: below 3 weeks caps severity at info (not warning)", () => {
    const out = generateOwnTrafficInsights({
      busyTimes: busyTimesWith([makeDeadEdgeDay(1)]),
      weekdayDescriptions: [MONDAY_9_TO_9],
      sampleWeeks: 1,
    })
    const edge = out.find((i) => i.insight_type === "hours.own_dead_edge_hour")
    expect(edge?.severity).toBe("info")
    expect(edge?.confidence).toBe("low")
  })

  test("sampleWeeks gate: 3+ weeks allows severity warning", () => {
    const out = generateOwnTrafficInsights({
      busyTimes: busyTimesWith([makeDeadEdgeDay(1)]),
      weekdayDescriptions: [MONDAY_9_TO_9],
      sampleWeeks: 4,
    })
    const edge = out.find((i) => i.insight_type === "hours.own_dead_edge_hour")
    expect(edge?.severity).toBe("warning")
  })

  test("never fabricates an open window: no posted hours -> no edge-hour claim", () => {
    const out = generateOwnTrafficInsights({
      busyTimes: busyTimesWith([makeDeadEdgeDay(1)]),
      weekdayDescriptions: null,
      sampleWeeks: 4,
    })
    expect(out.filter((i) => i.insight_type === "hours.own_dead_edge_hour")).toHaveLength(0)
  })

  test("titles/summaries are entity-attributed (\"Your\") and pass lintVoice", () => {
    const out = generateOwnTrafficInsights({
      busyTimes: busyTimesWith([makeDeadEdgeDay(1)]),
      weekdayDescriptions: [MONDAY_9_TO_9],
      sampleWeeks: 4,
    })
    for (const ins of out) {
      expect(/\byour\b/i.test(ins.title)).toBe(true)
      expect(lintVoice(ins.title)).toEqual([])
      expect(lintVoice(ins.summary)).toEqual([])
    }
  })

  test("never surfaces a raw guest count / score — level words only", () => {
    const out = generateOwnTrafficInsights({
      busyTimes: busyTimesWith([makeDeadEdgeDay(1)]),
      weekdayDescriptions: [MONDAY_9_TO_9],
      sampleWeeks: 4,
    })
    for (const ins of out) {
      expect(ins.title).not.toMatch(/\d/)
      expect(ins.summary).not.toMatch(/\d+%/)
    }
  })
})

describe("generateOwnTrafficInsights — hours.own_slow_window", () => {
  test("fires on a synthetic curve with a dead midday window", () => {
    const out = generateOwnTrafficInsights({
      busyTimes: busyTimesWith([makeSlowMiddayDay(1)]),
      weekdayDescriptions: [MONDAY_9_TO_9],
      sampleWeeks: 1,
    })
    const slow = out.filter((i) => i.insight_type === "hours.own_slow_window")
    expect(slow.length).toBeGreaterThan(0)
    expect(slow[0].severity).toBe("info") // always context-grade
  })

  test("does NOT fire on a flat/busy curve", () => {
    const out = generateOwnTrafficInsights({
      busyTimes: busyTimesWith([makeFlatBusyDay(1)]),
      weekdayDescriptions: [MONDAY_9_TO_9],
      sampleWeeks: 1,
    })
    expect(out.filter((i) => i.insight_type === "hours.own_slow_window")).toHaveLength(0)
  })
})

describe("generateOwnTrafficInsights — hours.own_peak_drift is intentionally absent", () => {
  test("never emits hours.own_peak_drift (no own-curve history persisted yet)", () => {
    const out = generateOwnTrafficInsights({
      busyTimes: busyTimesWith([makeDeadEdgeDay(1), makeSlowMiddayDay(2)]),
      weekdayDescriptions: [MONDAY_9_TO_9, "Tuesday: 9:00 AM – 9:00 PM"],
      sampleWeeks: 4,
    })
    expect(out.some((i) => i.insight_type === "hours.own_peak_drift")).toBe(false)
  })
})

describe("generateOwnTrafficInsights — fails soft", () => {
  test("no busy times -> empty array, never throws", () => {
    expect(generateOwnTrafficInsights({ busyTimes: null, weekdayDescriptions: [MONDAY_9_TO_9] })).toEqual([])
    expect(generateOwnTrafficInsights({ busyTimes: undefined, weekdayDescriptions: null })).toEqual([])
  })
})

describe("T2 naming requirement — hours.own_* lands in a DIFFERENT family than traffic.*", () => {
  test("domainLabel (v1 tokenizer) separates hours.own_* from traffic.*", () => {
    expect(domainLabel("hours.own_dead_edge_hour")).not.toBe(domainLabel("traffic.surge"))
    expect(domainLabel("hours.own_slow_window")).toBe(domainLabel("hours_changed")) // both "Hours"
  })

  test("operations intake (isOperationsSignal) matches hours.own_* via startsWith(\"hours\")", () => {
    expect(isOperationsSignal("hours.own_dead_edge_hour")).toBe(true)
    expect(isOperationsSignal("hours.own_slow_window")).toBe(true)
  })

  test("marketing intake (isMarketingSignal) matches hours.own_* via isRhythmSignal", () => {
    expect(isMarketingSignal("hours.own_dead_edge_hour")).toBe(true)
    expect(isMarketingSignal("hours.own_slow_window")).toBe(true)
  })
})
