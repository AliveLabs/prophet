// Phase 6e — per-admin destructive-action rate limit (pure boundary).
import { describe, it, expect } from "vitest"
import { isOverDestructiveLimit, DESTRUCTIVE_RATE_LIMIT } from "@/lib/admin/activity-log"

describe("destructive rate limit", () => {
  it("blocks at or over the cap, allows under it", () => {
    expect(isOverDestructiveLimit(0)).toBe(false)
    expect(isOverDestructiveLimit(DESTRUCTIVE_RATE_LIMIT.max - 1)).toBe(false)
    expect(isOverDestructiveLimit(DESTRUCTIVE_RATE_LIMIT.max)).toBe(true)
    expect(isOverDestructiveLimit(DESTRUCTIVE_RATE_LIMIT.max + 10)).toBe(true)
  })

  it("respects a custom cap", () => {
    expect(isOverDestructiveLimit(2, 3)).toBe(false)
    expect(isOverDestructiveLimit(3, 3)).toBe(true)
  })

  it("has a sane default window + cap", () => {
    expect(DESTRUCTIVE_RATE_LIMIT.max).toBeGreaterThan(0)
    expect(DESTRUCTIVE_RATE_LIMIT.windowMinutes).toBeGreaterThan(0)
  })
})
