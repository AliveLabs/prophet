import { describe, it, expect } from "vitest"
import { densityTierFromCount } from "@/lib/events/density"

describe("densityTierFromCount — Places nearby-restaurant proxy → tier", () => {
  it("a sparse area reads rural", () => {
    expect(densityTierFromCount(0)).toBe("rural")
    expect(densityTierFromCount(2)).toBe("rural")
  })
  it("a moderate strip reads suburban", () => {
    expect(densityTierFromCount(3)).toBe("suburban")
    expect(densityTierFromCount(8)).toBe("suburban")
  })
  it("a busy district reads urban", () => {
    expect(densityTierFromCount(9)).toBe("urban")
    expect(densityTierFromCount(16)).toBe("urban")
  })
  it("a saturated core reads dense_urban", () => {
    expect(densityTierFromCount(17)).toBe("dense_urban")
    expect(densityTierFromCount(20)).toBe("dense_urban")
  })
  it("tiers are monotonic across the range", () => {
    const order = ["rural", "suburban", "urban", "dense_urban"]
    let last = -1
    for (let n = 0; n <= 20; n++) {
      const idx = order.indexOf(densityTierFromCount(n))
      expect(idx).toBeGreaterThanOrEqual(last)
      last = idx
    }
  })
})
