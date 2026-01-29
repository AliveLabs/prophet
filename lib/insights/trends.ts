import type { SnapshotDiff, GeneratedInsight } from "./types"

export function buildWeeklyInsights(diff: SnapshotDiff): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []

  if (typeof diff.ratingDelta === "number" && Math.abs(diff.ratingDelta) >= 0.2) {
    insights.push({
      insight_type: "weekly_rating_trend",
      title: "Weekly rating trend",
      summary: `Rating shifted ${diff.ratingDelta} points over the last week.`,
      confidence: "medium",
      severity: diff.ratingDelta < 0 ? "warning" : "info",
      evidence: { field: "rating", delta: diff.ratingDelta, window: "t-7" },
      recommendations: [],
    })
  }

  if (typeof diff.reviewCountDelta === "number" && Math.abs(diff.reviewCountDelta) >= 5) {
    insights.push({
      insight_type: "weekly_review_trend",
      title: "Weekly review trend",
      summary: `Review count changed by ${diff.reviewCountDelta} over the last week.`,
      confidence: "medium",
      severity: "info",
      evidence: { field: "reviewCount", delta: diff.reviewCountDelta, window: "t-7" },
      recommendations: [],
    })
  }

  return insights
}
