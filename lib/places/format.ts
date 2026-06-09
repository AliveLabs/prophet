// Friendly presentation of Google Places enums for the onboarding UI.

const PRICE_SYMBOLS: Record<string, string> = {
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
}

/** "PRICE_LEVEL_EXPENSIVE" -> "$$$" (empty string when unknown/free). */
export function priceLevelToSymbols(level: string | null | undefined): string {
  return level ? (PRICE_SYMBOLS[level] ?? "") : ""
}

/** A readable cuisine from a Places type: "japanese_restaurant" -> "Japanese", "steak_house" -> "Steak house". */
export function typeToCuisine(primaryType: string | null | undefined, types: string[] = []): string {
  const raw =
    primaryType && primaryType !== "restaurant"
      ? primaryType
      : types.find((t) => t.endsWith("_restaurant") && t !== "restaurant") ??
        types.find((t) => t !== "restaurant" && t !== "food" && t !== "point_of_interest" && t !== "establishment") ??
        primaryType ??
        "restaurant"
  const words = raw.replace(/_restaurant$/, "").split("_").filter(Boolean)
  if (!words.length) return "Restaurant"
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ")
}

/** Meters -> "0.4 mi" / "850 ft". */
export function formatDistance(meters: number | null | undefined): string | null {
  if (meters == null) return null
  const miles = meters / 1609.34
  if (miles >= 0.1) return `${miles.toFixed(1)} mi`
  return `${Math.round(meters * 3.28084)} ft`
}
