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
    const falling = diff.reviewCountDelta < 0
    const direction = falling ? "down" : "up"
    insights.push({
      // Split by direction so the FAILURE-signal semantics are unambiguous: a FALLING cadence is a
      // failure signal (it can lift the maintain-impact cap); a RISING cadence is a GOOD signal and
      // must not. Keeping one `review_velocity` type made the scoring failure-match fire on both.
      insight_type: falling ? "review_velocity_falling" : "review_velocity_rising",
      title: "Review velocity changed",
      summary: `Review count is ${direction} by ${Math.abs(diff.reviewCountDelta)}.`,
      confidence: "high",
      severity: falling ? "warning" : "info",
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

// ---------------------------------------------------------------------------
// T5(a) — own-location diff rows.
//
// `buildInsights` above is the COMPETITOR diff loop: rows it emits never name an
// entity and are written with a real `competitor_id`. reputation@v2's floor
// deliberately excludes rating_change / review_velocity_* signals from its honest
// floor because a competitor's rating move can never be honestly reported as "YOUR
// rating fell" — see reputation-skill-rewrite/rationale.md open question 2.
//
// This is the OWN-listing mirror: same field deltas (rating, review count), but
// diffed against the location's OWN previous snapshot, entity-named in the title
// ("Your rating moved 4.4 to 4.2"), and written with `competitor_id: null` so the
// row is unambiguously about the location itself, not a competitor. These rows
// exist for the MODEL path and threshold-watch urgency — reputation@v2's floor does
// NOT trigger on them (its floor only reads OWN REVIEW THEME signals; see
// isOwnThemeSignal in lib/skills/reputation/skill.ts). Do not change the skill here.
//
// Same thresholds and severity convention as the competitor loop (warning when
// negative, info when positive) so scoring/downstream consumers see one consistent
// shape regardless of whose listing moved.
export function buildOwnInsights(diff: SnapshotDiff, locationName: string): GeneratedInsight[] {
  const insights: GeneratedInsight[] = []
  const name = locationName || "Your location"

  if (typeof diff.ratingDelta === "number" && Math.abs(diff.ratingDelta) >= 0.1) {
    const previous = diff.changes.find((c) => c.field === "rating")?.before
    const current = diff.changes.find((c) => c.field === "rating")?.after
    const direction = diff.ratingDelta >= 0 ? "increased" : "decreased"
    insights.push({
      insight_type: "rating_change",
      title: `Your rating ${direction}`,
      summary: `${name}'s rating ${direction} by ${Math.abs(diff.ratingDelta)} points.`,
      confidence: "high",
      severity: diff.ratingDelta < 0 ? "warning" : "info",
      evidence: {
        field: "rating",
        delta: diff.ratingDelta,
        previous: previous ?? null,
        current: current ?? null,
      },
      recommendations: [],
    })
  }

  if (typeof diff.reviewCountDelta === "number" && Math.abs(diff.reviewCountDelta) >= 2) {
    const previous = diff.changes.find((c) => c.field === "reviewCount")?.before
    const current = diff.changes.find((c) => c.field === "reviewCount")?.after
    const falling = diff.reviewCountDelta < 0
    const direction = falling ? "down" : "up"
    insights.push({
      insight_type: falling ? "review_velocity_falling" : "review_velocity_rising",
      title: "Your review count changed",
      summary: `${name}'s review count is ${direction} by ${Math.abs(diff.reviewCountDelta)}.`,
      confidence: "high",
      severity: falling ? "warning" : "info",
      evidence: {
        field: "reviewCount",
        delta: diff.reviewCountDelta,
        previous: previous ?? null,
        current: current ?? null,
      },
      recommendations: [],
    })
  }

  return insights
}
