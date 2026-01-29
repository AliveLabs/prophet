export type RelevanceFactor = {
  label: string
  value: number
  weight: number
}

export function scoreCompetitor(input: {
  distanceMeters?: number
  category?: string
  targetCategory?: string | null
  rating?: number
  reviewCount?: number
}) {
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
