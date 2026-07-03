// T2 addendum — NOT a new standalone suite file to add as-is. This mirrors the
// existing `describe("signalFamily — verified information channels", ...)` and
// `describe("distinctFamilies — closes the v1 first-token hole", ...)` blocks in
// tests/unit/skills/convergence-skill.test.ts (convergence@v2, currently only in the
// wt-convergence-v2 worktree — that PR has not landed on GetTicket main yet per
// MEMORY.md "Phase 0 wiring PRs still pending Bryan's go").
//
// ACTION FOR WHOEVER LANDS convergence@v2: add these `it(...)` blocks into the
// existing describe blocks in that file (do not create a second describe block).
// Reproduced here as a runnable file so this ticket's assertion is self-verifiable
// against the real wt-convergence-v2 module without editing that worktree's repo.

import { describe, it, expect } from "vitest"
import { signalFamily, distinctFamilies } from "@/lib/skills/convergence/skill"

describe("signalFamily — T2 own-curve naming requirement", () => {
  it("hours.own_* lands in the 'hours' family, NOT 'traffic'", () => {
    expect(signalFamily("hours.own_dead_edge_hour")).toBe("hours")
    expect(signalFamily("hours.own_slow_window")).toBe("hours")
    expect(signalFamily("hours.own_peak_drift")).toBe("hours") // reserved; not emitted yet (see own-traffic-insights.ts)
  })
  it("hours.own_* is a DIFFERENT family than traffic.* (the whole point of the naming rule)", () => {
    expect(signalFamily("hours.own_dead_edge_hour")).not.toBe(signalFamily("traffic.baseline"))
    expect(signalFamily("hours.own_slow_window")).not.toBe(signalFamily("traffic.surge"))
  })
})

describe("distinctFamilies — T2: own curve + competitor curve + events count as 3 distinct families", () => {
  it("the flagship combined-play shape clears the >=3-family convergence gate", () => {
    expect(
      distinctFamilies(["hours.own_dead_edge_hour", "traffic.surge", "events.major_lobby_surge"]).sort(),
    ).toEqual(["demand", "hours", "traffic"])
  })
})
