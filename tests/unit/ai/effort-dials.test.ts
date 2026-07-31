// ---------------------------------------------------------------------------
// Effort dials (2026-07-31) — the fleet-wide adaptive-thinking cost/quality lever moved from
// hardcoded call-site literals to environment variables.
//
// The behaviour that actually matters here is the GUARD, not the happy path: an unrecognised
// value must never reach the API. An invalid `output_config.effort` 400s the call, and a 400 on a
// producer degrades it to its deterministic fallback SILENTLY (status stays "ok"). That is the
// exact failure mode that made every producer serve canned plays for two weeks in 2026-06 before
// anyone noticed. A typo in a prod env var must not be able to reproduce it.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, afterEach } from "vitest"
import { parseEffort, PRODUCER_EFFORT, DEEP_EFFORT, SYNTHESIS_EFFORT, FUSION_EFFORT, WRITE_EFFORT } from "@/lib/ai/provider"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("parseEffort", () => {
  it("accepts each valid level", () => {
    for (const level of ["low", "medium", "high"] as const) {
      expect(parseEffort(level, "ANTHROPIC_PRODUCER_EFFORT", "medium")).toBe(level)
    }
  })

  it("falls back when unset or blank (an unset environment must be a no-op)", () => {
    expect(parseEffort(undefined, "ANTHROPIC_PRODUCER_EFFORT", "medium")).toBe("medium")
    expect(parseEffort("", "ANTHROPIC_PRODUCER_EFFORT", "high")).toBe("high")
    expect(parseEffort("   ", "ANTHROPIC_PRODUCER_EFFORT", "low")).toBe("low")
  })

  it("normalises case and surrounding whitespace", () => {
    expect(parseEffort("HIGH", "ANTHROPIC_DEEP_EFFORT", "medium")).toBe("high")
    expect(parseEffort("  Medium \n", "ANTHROPIC_DEEP_EFFORT", "low")).toBe("medium")
  })

  it("rejects an unknown level and warns rather than passing it through", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(parseEffort("ludicrous", "ANTHROPIC_PRODUCER_EFFORT", "medium")).toBe("medium")
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0][0]).toContain("ANTHROPIC_PRODUCER_EFFORT")
  })

  it("rejects xhigh and max, which the producer tier's model does not support", () => {
    // Sonnet 4.6 has no "xhigh" (it arrived with Opus 4.7). Accepting it here would 400 every
    // producer call. Widen the accepted set as part of the model swap, deliberately, not by typo.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(parseEffort("xhigh", "ANTHROPIC_PRODUCER_EFFORT", "medium")).toBe("medium")
    expect(parseEffort("max", "ANTHROPIC_PRODUCER_EFFORT", "medium")).toBe("medium")
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it("does not warn on the silent fallback paths", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    parseEffort(undefined, "ANTHROPIC_PRODUCER_EFFORT", "medium")
    parseEffort("", "ANTHROPIC_PRODUCER_EFFORT", "medium")
    parseEffort("low", "ANTHROPIC_PRODUCER_EFFORT", "medium")
    expect(warn).not.toHaveBeenCalled()
  })
})

describe("exported dials", () => {
  // Guards the migration itself: with no effort env vars set (vitest.config.ts loads no dotenv
  // file, so that is the normal case locally and in CI), every dial must still resolve to the
  // literal that was hardcoded at its call site before this change. That is what makes this a
  // pure refactor in production until someone deliberately turns a dial.
  //
  // Each assertion is skipped if its env var IS set, so a developer mid-sweep (or a preview
  // deployment with a dial turned) does not get a spurious failure.
  const cases = [
    ["ANTHROPIC_PRODUCER_EFFORT", PRODUCER_EFFORT, "medium"],
    ["ANTHROPIC_DEEP_EFFORT", DEEP_EFFORT, "high"],
    ["ANTHROPIC_SYNTHESIS_EFFORT", SYNTHESIS_EFFORT, "high"],
    ["ANTHROPIC_FUSION_EFFORT", FUSION_EFFORT, "medium"],
    ["ANTHROPIC_WRITE_EFFORT", WRITE_EFFORT, "medium"],
  ] as const

  for (const [envName, actual, expected] of cases) {
    it(`${envName} defaults to "${expected}"`, (ctx) => {
      if (process.env[envName]) ctx.skip(`${envName} is set in this environment`)
      expect(actual).toBe(expected)
    })
  }
})
