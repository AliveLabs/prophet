import type { SnapshotDiff, GeneratedInsight } from "./types"

export function buildInsights(diff: SnapshotDiff): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []

  if (typeof diff.ratingDelta === "number" && Math.abs(diff.ratingDelta) >= 0.1) {
    const direction = diff.ratingDelta >= 0 ? "increased" : "decreased"
    insights.push({
      insight_type: "rating_change",
      title: `Rating ${direction}`,
      summary: `Rating ${direction} by ${Math.abs(diff.ratingDelta)} points.`,
      confidence: "high",
      severity: diff.ratingDelta < 0 ? "warning" : "info",
      evidence: {
        field: "rating",
        delta: diff.ratingDelta,
      },
      recommendations: [],
    })
  }

  if (typeof diff.reviewCountDelta === "number" && Math.abs(diff.reviewCountDelta) >= 2) {
    const direction = diff.reviewCountDelta >= 0 ? "up" : "down"
    insights.push({
      insight_type: "review_velocity",
      title: "Review velocity changed",
      summary: `Review count is ${direction} by ${Math.abs(diff.reviewCountDelta)}.`,
      confidence: "high",
      severity: "info",
      evidence: {
        field: "reviewCount",
        delta: diff.reviewCountDelta,
      },
      recommendations: [],
    })
  }

  if (diff.hoursChanged) {
    insights.push({
      insight_type: "hours_changed",
      title: "Hours updated",
      summary: "Business hours were updated since the last snapshot.",
      confidence: "medium",
      severity: "info",
      evidence: {
        field: "hours",
      },
      recommendations: [],
    })
  }

  return insights
}
