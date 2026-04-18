export const CUISINES = [
  "American",
  "Italian",
  "Mexican",
  "Asian",
  "Bar & Grill",
  "Café",
  "Seafood",
  "Pizza",
  "Steakhouse",
  "Other",
] as const

export const CATEGORY_EMOJIS: Record<string, string> = {
  American: "🍔",
  Italian: "🍝",
  Mexican: "🌮",
  Asian: "🥢",
  "Bar & Grill": "🍻",
  "Café": "☕",
  Seafood: "🦞",
  Pizza: "🍕",
  Steakhouse: "🥩",
  Other: "🍽️",
}

export const PROMO_KEYWORDS = [
  "special",
  "deal",
  "discount",
  "happy hour",
  "promotion",
  "limited time",
  "prix fixe",
  "brunch",
] as const

export const CONTENT_DISCOVERY_TERMS = [
  "menu",
  "catering",
  "order",
  "dine",
  "reservations",
] as const
