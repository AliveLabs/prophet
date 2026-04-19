export type RelevanceFactor = {
  label: string
  value: number
  weight: number
}

// Google Places types that should never be treated as competitors for local
// food / consumer businesses. If any of these are present on a candidate's
// Places `types` array, scoreCompetitor returns a score of 0 so call sites
// can hard-filter the row before persisting.
export const EXCLUDED_COMPETITOR_TYPES: ReadonlySet<string> = new Set([
  "local_government_office",
  "city_hall",
  "courthouse",
  "embassy",
  "police",
  "fire_station",
  "post_office",
  "bank",
  "atm",
  "finance",
  "gas_station",
  "car_repair",
  "car_dealer",
  "car_wash",
  "car_rental",
  "school",
  "primary_school",
  "secondary_school",
  "university",
  "hospital",
  "doctor",
  "dentist",
  "pharmacy",
  "drugstore",
  "church",
  "mosque",
  "synagogue",
  "hindu_temple",
  "place_of_worship",
  "cemetery",
  "funeral_home",
  "parking",
  "storage",
  "laundry",
  "lawyer",
  "accounting",
  "insurance_agency",
  "real_estate_agency",
  "travel_agency",
  "veterinary_care",
  "electrician",
  "plumber",
  "roofing_contractor",
  "painter",
])

export function scoreCompetitor(input: {
  distanceMeters?: number
  category?: string
  targetCategory?: string | null
  rating?: number
  reviewCount?: number
  types?: string[] | null
}) {
  const excludedMatch = (input.types ?? []).find((type) =>
    type ? EXCLUDED_COMPETITOR_TYPES.has(type) : false
  )
  if (excludedMatch) {
    const factors: RelevanceFactor[] = [
      { label: "excluded_type", value: 0, weight: 1 },
    ]
    return { score: 0, factors, excludedType: excludedMatch }
  }

  const distanceScore = input.distanceMeters
    ? Math.max(0, 1 - input.distanceMeters / 5000)
    : 0.5
  const categoryScore =
    input.targetCategory && input.category
      ? input.category.toLowerCase().includes(input.targetCategory.toLowerCase())
        ? 1
        : 0.4
      : 0.6
  const ratingScore = input.rating ? Math.min(input.rating / 5, 1) : 0.5
  const reviewScore = input.reviewCount
    ? Math.min(input.reviewCount / 200, 1)
    : 0.5

  const factors: RelevanceFactor[] = [
    { label: "distance", value: distanceScore, weight: 0.4 },
    { label: "category_match", value: categoryScore, weight: 0.3 },
    { label: "rating", value: ratingScore, weight: 0.2 },
    { label: "review_count", value: reviewScore, weight: 0.1 },
  ]

  const score = factors.reduce((total, factor) => total + factor.value * factor.weight, 0)

  return { score: Number(score.toFixed(4)), factors }
}
