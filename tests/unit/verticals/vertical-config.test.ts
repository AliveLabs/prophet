import { describe, test, expect } from "vitest"
import { getVerticalConfig, isValidIndustryType, getAllVerticals } from "@/lib/verticals"

describe("getVerticalConfig", () => {
  test("returns restaurant config by default (no argument)", () => {
    const config = getVerticalConfig()
    expect(config.industryType).toBe("restaurant")
  })

  test("returns restaurant config for null", () => {
    const config = getVerticalConfig(null)
    expect(config.industryType).toBe("restaurant")
  })

  test("returns restaurant config for invalid industry type", () => {
    const config = getVerticalConfig("pizza_shop")
    expect(config.industryType).toBe("restaurant")
  })

  test("returns restaurant config when VERTICALIZATION_ENABLED is not true", () => {
    const config = getVerticalConfig("liquor_store")
    expect(config.industryType).toBe("restaurant")
  })
})

describe("restaurant config matches current hardcoded strings", () => {
  const config = getVerticalConfig("restaurant")

  test("labels are correct", () => {
    expect(config.labels.businessLabel).toBe("restaurant")
    expect(config.labels.businessLabelPlural).toBe("restaurants")
    expect(config.labels.businessLabelCapitalized).toBe("Restaurant")
    expect(config.labels.competitorLabel).toBe("restaurant")
    expect(config.labels.competitorLabelPlural).toBe("restaurants")
    expect(config.labels.categoryLabel).toBe("Cuisine Type")
    expect(config.labels.ownerLabel).toBe("Restaurant Owner")
    expect(config.labels.setupCta).toBe("Set up my restaurant")
  })

  test("businessCategories contains all current CUISINES", () => {
    const currentCuisines = [
      "American",
      "Italian",
      "Mexican",
      "Asian",
      "Bar & Grill",
      "Café",
      "Seafood",
      "Pizza",
    ]
    for (const cuisine of currentCuisines) {
      expect(config.businessCategories).toContain(cuisine)
    }
  })

  test("onboarding copy matches current UI", () => {
    expect(config.onboarding.businessInfo.title).toBe("Your Restaurant")
    expect(config.onboarding.businessInfo.namePlaceholder).toBe("e.g. The Rustic Fork")
    expect(config.onboarding.businessInfo.categoryLabel).toBe("Cuisine Type")
    expect(config.onboarding.splash.ctaLabel).toBe("Set up my restaurant")
  })

  test("placesApiType is restaurant", () => {
    expect(config.placesApiType).toBe("restaurant")
  })

  test("all signals are enabled", () => {
    expect(config.signals.competitor).toBe(true)
    expect(config.signals.seo).toBe(true)
    expect(config.signals.events).toBe(true)
    expect(config.signals.content).toBe(true)
    expect(config.signals.photos).toBe(true)
    expect(config.signals.traffic).toBe(true)
    expect(config.signals.weather).toBe(true)
    expect(config.signals.social).toBe(true)
  })

  test("contentFeatures include restaurant-specific detection patterns", () => {
    const featureKeys = config.contentFeatures.map((f) => f.key)
    expect(featureKeys).toContain("reservations")
    expect(featureKeys).toContain("onlineOrdering")
    expect(featureKeys).toContain("privateDining")
    expect(featureKeys).toContain("catering")
    expect(featureKeys).toContain("happyHour")
    expect(featureKeys).toContain("doordash")
    expect(featureKeys).toContain("ubereats")
    expect(featureKeys).toContain("grubhub")
  })

  test("llmContext has restaurant vocabulary", () => {
    expect(config.llmContext.businessDescription).toContain("restaurant")
    expect(config.llmContext.industryVocabulary).toContain("menu")
    expect(config.llmContext.industryVocabulary).toContain("cuisine")
  })
})

describe("liquor store config", () => {
  test("has correct industry type and labels", () => {
    const allVerticals = getAllVerticals()
    const liquor = allVerticals.find((v) => v.industryType === "liquor_store")
    expect(liquor).toBeDefined()
    expect(liquor!.labels.businessLabel).toBe("liquor store")
    expect(liquor!.labels.categoryLabel).toBe("Store Type")
    expect(liquor!.placesApiType).toBe("liquor_store")
  })

  test("content signal is disabled for sprint 1", () => {
    const allVerticals = getAllVerticals()
    const liquor = allVerticals.find((v) => v.industryType === "liquor_store")
    expect(liquor!.signals.content).toBe(false)
  })
})

describe("isValidIndustryType", () => {
  test("accepts valid types", () => {
    expect(isValidIndustryType("restaurant")).toBe(true)
    expect(isValidIndustryType("liquor_store")).toBe(true)
  })

  test("rejects invalid types", () => {
    expect(isValidIndustryType("pizza")).toBe(false)
    expect(isValidIndustryType("")).toBe(false)
    expect(isValidIndustryType(null)).toBe(false)
    expect(isValidIndustryType(undefined)).toBe(false)
    expect(isValidIndustryType(42)).toBe(false)
  })
})
