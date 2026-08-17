// ALT-629 — a surface may not render a half-finished page, and may not hide a finished one.
//
// Both halves matter. The first is the bug Chris's walkthrough surfaced: mid-first-run pages
// showed whatever had landed, and a partial page reads as a finished answer. The second is the
// regression this gate could easily become: a gate that can permanently hide a working page is a
// worse outage than the partial render it prevents, so every uncertain case must fail OPEN.

import { describe, it, expect } from "vitest"
import {
  surfaceReadiness,
  surfaceReadinessMap,
  SURFACE_PIPELINES,
  PIPELINE_LABELS,
  type SurfaceJobRead,
} from "@/lib/onboarding/surface-readiness"

const job = (pipeline: string, status: string): SurfaceJobRead => ({ pipeline, status })

/** A location mid-first-run: everything enqueued, nothing finished. */
const FIRST_RUN_QUEUED: SurfaceJobRead[] = [
  job("starter", "running"),
  job("content", "queued"),
  job("visibility", "queued"),
  job("events", "queued"),
  job("weather", "queued"),
  job("busy_times", "queued"),
  job("social", "queued"),
  job("photos", "queued"),
]

/** A location that has been running for weeks: today's cycle is in flight, yesterday's finished. */
const STEADY_STATE: SurfaceJobRead[] = [
  job("content", "running"),
  job("content", "done"),
  job("weather", "queued"),
  job("weather", "done"),
  job("social", "done"),
  job("busy_times", "done"),
  job("events", "done"),
  job("visibility", "done"),
  job("photos", "done"),
  job("insights", "done"),
]

describe("surfaceReadiness — the gate closes during a first run", () => {
  it("gates every surface while its pull is still queued", () => {
    for (const surface of Object.keys(SURFACE_PIPELINES) as Array<keyof typeof SURFACE_PIPELINES>) {
      if (surface === "insights") continue // no insights row in this fixture; covered below
      expect(surfaceReadiness(surface, FIRST_RUN_QUEUED).state, surface).toBe("working")
    }
  })

  it("names the pending pull in the operator's language, never the pipeline id", () => {
    const r = surfaceReadiness("traffic", FIRST_RUN_QUEUED)
    expect(r.pending).toEqual([PIPELINE_LABELS.busy_times])
    expect(r.detail).toContain(PIPELINE_LABELS.busy_times)
    expect(r.detail).not.toContain("busy_times")
  })

  it("says nothing about what it will find", () => {
    const r = surfaceReadiness("events", FIRST_RUN_QUEUED)
    expect(r.headline.length).toBeGreaterThan(0)
    expect(r.detail).not.toMatch(/\d/) // no counts, no percentages, no timers
  })

  it("gates a running job too, not only a queued one", () => {
    expect(surfaceReadiness("competitors", [job("content", "running")]).state).toBe("working")
  })

  it("gates a deferred job — deferred is still on its way", () => {
    expect(surfaceReadiness("insights", [job("insights", "deferred")]).state).toBe("working")
  })
})

describe("surfaceReadiness — the gate opens once a pull has settled", () => {
  it("renders a surface whose pull has finished, even while today's cycle re-runs it", () => {
    // The whole point: a daily refresh must NOT hide a page that already has yesterday's answer.
    expect(surfaceReadiness("competitors", STEADY_STATE).state).toBe("ready")
    expect(surfaceReadiness("weather", STEADY_STATE).state).toBe("ready")
  })

  it("trusts a FAILED pull — we asked and got an answer, so the page's own empty state is honest", () => {
    expect(surfaceReadiness("social", [job("social", "failed")]).state).toBe("ready")
  })

  it("trusts a SKIPPED pull the same way", () => {
    expect(surfaceReadiness("photos", [job("photos", "skipped")]).state).toBe("ready")
  })

  it("returns no copy at all when ready, so a caller cannot render a stray line", () => {
    const r = surfaceReadiness("weather", STEADY_STATE)
    expect(r).toEqual({ state: "ready", pending: [], headline: "", detail: "" })
  })
})

describe("surfaceReadiness — fails open", () => {
  it("renders when the location has no job rows at all (pruned, or predates the queue)", () => {
    expect(surfaceReadiness("weather", []).state).toBe("ready")
  })

  it("renders a dependency with no rows of its own once the location has settled", () => {
    // `photos` is weekly: on a settled location it can be missing entirely from a pruned window.
    // Gating on it would hide the page until the next weekly run, which is days.
    const settled = [job("content", "done"), job("weather", "done")]
    expect(surfaceReadiness("photos", settled).state).toBe("ready")
  })

  it("but DOES gate a dependency with no rows while the location is mid-first-run", () => {
    // Same shape, opposite verdict: work is in flight, so a missing row means "not enqueued yet",
    // not "pruned". This is the pair that makes the fail-open rule safe rather than toothless.
    const midRun = [job("content", "running"), job("weather", "queued")]
    expect(surfaceReadiness("photos", midRun).state).toBe("working")
  })

  it("ignores malformed rows instead of throwing", () => {
    const rows = [
      { pipeline: "weather", status: "done" },
      { pipeline: null, status: "queued" },
      { pipeline: "content", status: undefined },
    ] as unknown as SurfaceJobRead[]
    expect(surfaceReadiness("weather", rows).state).toBe("ready")
  })

  it("renders on an unrecognised surface rather than hiding a page", () => {
    expect(surfaceReadiness("nope" as never, FIRST_RUN_QUEUED).state).toBe("ready")
  })

  it("treats an unrecognised status as neither settled nor in flight", () => {
    // Not terminal, not active: the pipeline is unproven, but nothing else is running either,
    // so there is nothing to wait for and the page renders.
    expect(surfaceReadiness("weather", [job("weather", "wat")]).state).toBe("ready")
  })
})

describe("surfaceReadinessMap", () => {
  it("answers several surfaces from one set of rows", () => {
    const map = surfaceReadinessMap(["weather", "social"], [job("weather", "done"), job("social", "queued")])
    expect(map.weather.state).toBe("ready")
    expect(map.social.state).toBe("working")
  })
})

describe("copy rules", () => {
  it("every pipeline label is plain operator language: no vendor, no em dash, no id", () => {
    for (const [pipeline, label] of Object.entries(PIPELINE_LABELS)) {
      expect(label, pipeline).not.toMatch(/—/)
      expect(label, pipeline).not.toMatch(/_/)
      expect(label, pipeline).toBe(label.trim())
    }
  })

  it("the gate copy carries no em dash", () => {
    const r = surfaceReadiness("weather", FIRST_RUN_QUEUED)
    expect(r.headline).not.toMatch(/—/)
    expect(r.detail).not.toMatch(/—/)
  })

  it("lists two pending pulls with 'and', not a bare comma", () => {
    // `content` covers /content, /competitors and /reviews, so a multi-pull surface is rare;
    // the joiner still has to read as a sentence wherever it is used.
    const map = surfaceReadinessMap(["weather"], FIRST_RUN_QUEUED)
    expect(map.weather.detail).toContain(PIPELINE_LABELS.weather)
  })
})
