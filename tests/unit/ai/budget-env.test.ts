// ALT-552 / ALT-553 — the empty-string state that hid two disabled spend guards for 13 days.
//
// Both caps were sized and decided on 2026-08-03 ($5 per brief, $90 fleet daily, with the reasoning
// written down). The Vercel variables were created on 2026-08-09 and left EMPTY. Both resolvers
// treated empty exactly like absent, returned null, and said NOTHING, because the warn only fired
// for a non-empty value that failed to parse.
//
// So production ran with no per-brief ceiling and no fleet runaway tripwire, and the only evidence
// was two variables that look completely normal in `vercel env ls` (both read "Encrypted").
//
// "Not configured" and "configured to nothing" produce identical behaviour and mean opposite
// things. These tests pin that only one of them is silent.

import { describe, expect, it, vi } from "vitest"
import { parseBudgetEnv, resolveBudgetEnv } from "@/lib/ai/budget-env"

describe("parseBudgetEnv distinguishes the three disabled states", () => {
  it("absent is a deliberate, supported off", () => {
    expect(parseBudgetEnv(undefined)).toEqual({ value: null, reason: "absent" })
  })

  it("EMPTY is its own reason, not folded into absent", () => {
    // The whole point. Behaviour is identical; intent is not, and only the reason can tell them
    // apart downstream.
    expect(parseBudgetEnv("")).toEqual({ value: null, reason: "empty" })
    expect(parseBudgetEnv("   ")).toEqual({ value: null, reason: "empty" })
    expect(parseBudgetEnv("\t\n")).toEqual({ value: null, reason: "empty" })
  })

  it("invalid stays invalid", () => {
    for (const raw of ["nope", "0", "-5", "NaN", "Infinity"]) {
      expect(parseBudgetEnv(raw), raw).toEqual({ value: null, reason: "invalid" })
    }
  })

  it("parses the values actually set in prod", () => {
    expect(parseBudgetEnv("5")).toEqual({ value: 5, reason: null })
    expect(parseBudgetEnv("90")).toEqual({ value: 90, reason: null })
    expect(parseBudgetEnv("2.5")).toEqual({ value: 2.5, reason: null })
    // Surrounding whitespace is a paste artefact, not a mistake worth disabling a guard over.
    expect(parseBudgetEnv(" 90 ")).toEqual({ value: 90, reason: null })
  })

  it("treats zero as disabled rather than as a cap of zero", () => {
    // A literal cap of $0 would halt every build. If somebody means off, absent means off.
    expect(parseBudgetEnv("0").value).toBeNull()
  })
})

describe("resolveBudgetEnv warns on exactly the states worth a log line", () => {
  const capture = () => vi.spyOn(console, "warn").mockImplementation(() => {})

  it("SHOUTS when the variable is set but empty", () => {
    const spy = capture()
    expect(resolveBudgetEnv("t", "CAP", "")).toBeNull()
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("SET BUT EMPTY"))
    // Names the variable, or the reader has to guess which guard is off.
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("CAP"))
    spy.mockRestore()
  })

  it("stays SILENT when the variable is absent", () => {
    // Default-off is supported and documented: both caps ship off so a number nobody has measured
    // cannot cause an outage. Warning every cold start would train everyone to ignore this exact
    // message, which is how the empty case would hide all over again.
    const spy = capture()
    expect(resolveBudgetEnv("t", "CAP", undefined)).toBeNull()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it("warns on an unparseable value, as it always did", () => {
    const spy = capture()
    expect(resolveBudgetEnv("t", "CAP", "banana")).toBeNull()
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("not a positive number"))
    spy.mockRestore()
  })

  it("stays silent and returns the number on a good value", () => {
    const spy = capture()
    expect(resolveBudgetEnv("t", "CAP", "90")).toBe(90)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
