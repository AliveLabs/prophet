import { describe, it, expect } from "vitest"
import { priceLevelToSymbols, typeToCuisine, formatDistance } from "@/lib/places/format"

describe("places/format", () => {
  it("maps Google price levels to $ symbols", () => {
    expect(priceLevelToSymbols("PRICE_LEVEL_INEXPENSIVE")).toBe("$")
    expect(priceLevelToSymbols("PRICE_LEVEL_MODERATE")).toBe("$$")
    expect(priceLevelToSymbols("PRICE_LEVEL_EXPENSIVE")).toBe("$$$")
    expect(priceLevelToSymbols("PRICE_LEVEL_VERY_EXPENSIVE")).toBe("$$$$")
    expect(priceLevelToSymbols(null)).toBe("")
    expect(priceLevelToSymbols("PRICE_LEVEL_FREE")).toBe("")
  })

  it("derives a readable cuisine from Places types", () => {
    expect(typeToCuisine("japanese_restaurant", [])).toBe("Japanese")
    expect(typeToCuisine("steak_house", [])).toBe("Steak house")
    expect(typeToCuisine("restaurant", ["sushi_restaurant", "restaurant"])).toBe("Sushi")
    expect(typeToCuisine("restaurant", ["restaurant", "food"])).toBe("Restaurant")
  })

  it("formats distance in mi / ft", () => {
    expect(formatDistance(3219)).toBe("2.0 mi")
    expect(formatDistance(30)).toBe("98 ft")
    expect(formatDistance(null)).toBeNull()
  })
})
