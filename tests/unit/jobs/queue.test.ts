import { describe, it, expect } from "vitest"
import { backoffSeconds, DAILY_PIPELINES } from "@/lib/jobs/queue"

describe("backoffSeconds", () => {
  it("grows exponentially from 60s and caps at 1h", () => {
    expect(backoffSeconds(1)).toBe(60)
    expect(backoffSeconds(2)).toBe(120)
    expect(backoffSeconds(3)).toBe(240)
    expect(backoffSeconds(4)).toBe(480)
    expect(backoffSeconds(20)).toBe(3600) // capped
    expect(backoffSeconds(0)).toBe(60) // floor
  })
})

describe("DAILY_PIPELINES", () => {
  it("includes social and runs insights last (depends on the rest)", () => {
    expect(DAILY_PIPELINES).toContain("social")
    expect(DAILY_PIPELINES[DAILY_PIPELINES.length - 1]).toBe("insights")
  })
})
