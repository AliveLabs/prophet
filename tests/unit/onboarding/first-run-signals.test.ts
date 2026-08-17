import { describe, it, expect } from "vitest"
import {
  EVENTS_WINDOW_DAYS,
  pipelineSettled,
  summarizeFirstRunSignals,
  upcomingLocalEvents,
  type FirstRunSignalInput,
} from "@/lib/onboarding/first-run-signals"

function input(over: Partial<FirstRunSignalInput> = {}): FirstRunSignalInput {
  return {
    jobStatus: {},
    competitors: [],
    city: null,
    events: null,
    localSearch: null,
    hasWebsite: true,
    ...over,
  }
}

const byKey = (i: FirstRunSignalInput) =>
  Object.fromEntries(summarizeFirstRunSignals(i).map((s) => [s.key, s]))

describe("pipelineSettled", () => {
  it("is false for a pipeline with no row at all (not started is not finished)", () => {
    expect(pipelineSettled({}, "events")).toBe(false)
  })
  it("is false while queued or running", () => {
    expect(pipelineSettled({ events: "queued" }, "events")).toBe(false)
    expect(pipelineSettled({ events: "running" }, "events")).toBe(false)
  })
  it("is true once done or failed — both mean an absent read is final", () => {
    expect(pipelineSettled({ events: "done" }, "events")).toBe(true)
    expect(pipelineSettled({ events: "failed" }, "events")).toBe(true)
  })
})

describe("competitor signal", () => {
  it("is READY with no pipeline having run at all — this is the sub-minute first value", () => {
    const s = byKey(input({ competitors: [{ name: "Rosita's", distanceMi: 0.4 }], city: "Forney" }))
    expect(s.competitors.state).toBe("ready")
    expect(s.competitors.headline).toContain("1 business")
    expect(s.competitors.headline).toContain("near Forney")
    expect(s.competitors.items).toEqual(["Rosita's, 0.4 mi away"])
  })

  it("counts only what it was given and never claims a distance it does not have", () => {
    const s = byKey(
      input({
        competitors: [
          { name: "A", distanceMi: null },
          { name: "B", distanceMi: 1.25 },
          { name: "C", distanceMi: null },
          { name: "D", distanceMi: null },
        ],
      }),
    )
    expect(s.competitors.headline).toContain("4 businesses")
    expect(s.competitors.items).toEqual(["A", "B, 1.3 mi away", "C"]) // capped at 3
  })

  it("omits the city clause when there is no city", () => {
    const s = byKey(input({ competitors: [{ name: "A", distanceMi: null }] }))
    expect(s.competitors.headline).not.toContain("near")
  })

  it("is EMPTY, not working, when the operator has no competitors", () => {
    expect(byKey(input()).competitors.state).toBe("empty")
  })
})

describe("events signal", () => {
  it("is WORKING while the pull has not settled, and says what is running", () => {
    const s = byKey(input({ jobStatus: { events: "running" } })).events
    expect(s.state).toBe("working")
    expect(s.headline).toBe("Still checking what is happening near you.")
  })

  it("is UNAVAILABLE (never 'nothing on') when the pull finished with no snapshot", () => {
    const s = byKey(input({ jobStatus: { events: "done" } })).events
    expect(s.state).toBe("unavailable")
    expect(s.headline).toContain("could not read")
  })

  it("distinguishes an EMPTY read from an absent one — the honest 'nothing near you'", () => {
    const s = byKey(input({ jobStatus: { events: "done" }, events: [] })).events
    expect(s.state).toBe("empty")
    expect(s.headline).toContain(`${EVENTS_WINDOW_DAYS} days`)
  })

  it("is READY with the real count and up to three titles", () => {
    const s = byKey(
      input({
        jobStatus: { events: "done" },
        events: [
          { title: "Fall Market", startDate: "2026-08-15" },
          { title: "Rodeo", startDate: "2026-08-16" },
          { title: "Fun Run", startDate: null },
          { title: "Fourth event", startDate: "2026-08-18" },
        ],
      }),
    ).events
    expect(s.state).toBe("ready")
    expect(s.headline).toContain("4 events")
    expect(s.items).toEqual(["Fall Market, 2026-08-15", "Rodeo, 2026-08-16", "Fun Run"])
  })
})

describe("visibility signal", () => {
  it("says plainly there is no site to check rather than implying invisibility", () => {
    const s = byKey(input({ hasWebsite: false, jobStatus: { visibility: "done" } })).visibility
    expect(s.state).toBe("unavailable")
    expect(s.headline).toContain("no website")
  })

  it("is WORKING while the pull has not settled", () => {
    expect(byKey(input({ jobStatus: { visibility: "queued" } })).visibility.state).toBe("working")
  })

  it("is UNAVAILABLE when the pull finished but wrote nothing", () => {
    const s = byKey(input({ jobStatus: { visibility: "done" } })).visibility
    expect(s.state).toBe("unavailable")
  })

  it("only says 'not showing up' from a REAL empty read", () => {
    const s = byKey(
      input({ jobStatus: { visibility: "done" }, localSearch: { rankedKeywordCount: 0, localKeywords: [] } }),
    ).visibility
    expect(s.state).toBe("empty")
    expect(s.headline).toContain("not showing up")
  })

  it("is READY with the counted number and the LOCAL terms", () => {
    const s = byKey(
      input({
        jobStatus: { visibility: "done" },
        localSearch: {
          rankedKeywordCount: 12,
          localKeywords: ["“tacos forney”, position 3", "“tacos near me”, position 7"],
        },
      }),
    ).visibility
    expect(s.state).toBe("ready")
    expect(s.headline).toContain("12 searches")
    expect(s.items).toEqual(["“tacos forney”, position 3", "“tacos near me”, position 7"])
  })

  // ALT-623: ranking widely and ranking LOCALLY are different facts, and this card is about the
  // second. Showing national terms under a local-search heading is what made the first operator
  // to see it say the pills were "not related to my area".
  it("names the gap instead of showing terms when none of them are local", () => {
    const s = byKey(
      input({
        jobStatus: { visibility: "done" },
        localSearch: { rankedKeywordCount: 40, localKeywords: [] },
      }),
    ).visibility
    expect(s.state).toBe("ready")
    expect(s.headline).toContain("40 searches")
    expect(s.headline).toContain("None of them name your area")
    expect(s.items ?? []).toEqual([])
  })

  it("uses the singular for exactly one search", () => {
    const s = byKey(
      input({ localSearch: { rankedKeywordCount: 1, localKeywords: ["“tacos”, position 2"] } }),
    ).visibility
    expect(s.headline).toContain("1 search.")
  })
})

describe("summarizeFirstRunSignals", () => {
  it("always returns the three signals in a stable order", () => {
    expect(summarizeFirstRunSignals(input()).map((s) => s.key)).toEqual([
      "competitors",
      "events",
      "visibility",
    ])
  })
})

describe("upcomingLocalEvents", () => {
  const today = "2026-08-13"

  it("keeps only LOCAL roles — a metro hook is marketing material, not something near you", () => {
    const events = upcomingLocalEvents(
      [
        { title: "Nearby fest", startDatetime: "2026-08-14T18:00:00Z", role: "local_foot" },
        { title: "Across the metro", startDatetime: "2026-08-14T18:00:00Z", role: "metro_hook" },
        { title: "Elsewhere", startDatetime: "2026-08-14T18:00:00Z", role: "out_of_area" },
      ],
      today,
    )
    expect(events.map((e) => e.title)).toEqual(["Nearby fest"])
  })

  it("excludes an ungeocoded event rather than assuming it is nearby", () => {
    expect(
      upcomingLocalEvents([{ title: "Unknown", startDatetime: "2026-08-14T00:00:00Z", role: "ungeocoded" }], today),
    ).toEqual([])
  })

  it("excludes an undated event rather than assuming it is current", () => {
    expect(upcomingLocalEvents([{ title: "No date", role: "local_foot" }], today)).toEqual([])
  })

  it("excludes an event that already finished, and keeps one running through today", () => {
    const events = upcomingLocalEvents(
      [
        { title: "Over", startDatetime: "2026-08-01T00:00:00Z", endDatetime: "2026-08-02T00:00:00Z", role: "local_foot" },
        { title: "Running now", startDatetime: "2026-08-11T00:00:00Z", endDatetime: "2026-08-20T00:00:00Z", role: "local_traffic" },
      ],
      today,
    )
    expect(events.map((e) => e.title)).toEqual(["Running now"])
  })

  it("stops at the window horizon", () => {
    const events = upcomingLocalEvents(
      [
        { title: "In window", startDatetime: "2026-08-19T00:00:00Z", role: "local_foot" },
        { title: "Past horizon", startDatetime: "2026-08-25T00:00:00Z", role: "local_foot" },
      ],
      today,
      EVENTS_WINDOW_DAYS,
    )
    expect(events.map((e) => e.title)).toEqual(["In window"])
  })

  it("returns soonest first", () => {
    const events = upcomingLocalEvents(
      [
        { title: "Later", startDatetime: "2026-08-17T00:00:00Z", role: "local_foot" },
        { title: "Sooner", startDatetime: "2026-08-14T00:00:00Z", role: "local_foot" },
      ],
      today,
    )
    expect(events.map((e) => e.title)).toEqual(["Sooner", "Later"])
  })
})
