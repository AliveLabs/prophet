// SEC-H2: the quick-tip endpoint length-caps caller-supplied context before it reaches the LLM prompt.

import { describe, it, expect } from "vitest"
import { clampQuickTipContext, QUICK_TIP_CONTEXT_MAX } from "@/lib/ai/quick-tip"

describe("clampQuickTipContext", () => {
  it("trims and passes through a normal string", () => {
    expect(clampQuickTipContext("  hello world  ")).toBe("hello world")
  })

  it("returns empty string for non-strings (null/undefined/object/number)", () => {
    expect(clampQuickTipContext(null)).toBe("")
    expect(clampQuickTipContext(undefined)).toBe("")
    expect(clampQuickTipContext({ a: 1 })).toBe("")
    expect(clampQuickTipContext(12345)).toBe("")
  })

  it("caps an over-long context at the max", () => {
    const huge = "x".repeat(QUICK_TIP_CONTEXT_MAX + 5000)
    const out = clampQuickTipContext(huge)
    expect(out.length).toBe(QUICK_TIP_CONTEXT_MAX)
  })

  it("leaves a context at exactly the cap unchanged", () => {
    const exact = "y".repeat(QUICK_TIP_CONTEXT_MAX)
    expect(clampQuickTipContext(exact).length).toBe(QUICK_TIP_CONTEXT_MAX)
  })

  it("honors a custom max", () => {
    expect(clampQuickTipContext("abcdef", 3)).toBe("abc")
  })
})
