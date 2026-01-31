import type { NormalizedSnapshot } from "@/lib/providers/types"
import type { SnapshotDiff, SnapshotFieldChange } from "./types"

export function diffSnapshots(
  previous: NormalizedSnapshot | null,
  current: NormalizedSnapshot
): SnapshotDiff {
  const changes: SnapshotFieldChange[] = []

  const previousProfile = previous?.profile ?? {}
  const currentProfile = current.profile ?? {}

  if (previousProfile.rating !== currentProfile.rating) {
    changes.push({
      field: "rating",
      before: previousProfile.rating,
      after: currentProfile.rating,
    })
  }

  if (previousProfile.reviewCount !== currentProfile.reviewCount) {
    changes.push({
      field: "reviewCount",
      before: previousProfile.reviewCount,
      after: currentProfile.reviewCount,
    })
  }

  if (previousProfile.priceLevel !== currentProfile.priceLevel) {
    changes.push({
      field: "priceLevel",
      before: previousProfile.priceLevel,
      after: currentProfile.priceLevel,
    })
  }

  const hoursChanged = JSON.stringify(previous?.hours ?? {}) !== JSON.stringify(current.hours ?? {})
  if (hoursChanged) {
    changes.push({
      field: "hours",
      before: previous?.hours ?? {},
      after: current.hours ?? {},
    })
  }

  const ratingDelta =
    typeof currentProfile.rating === "number" && typeof previousProfile.rating === "number"
      ? Number((currentProfile.rating - previousProfile.rating).toFixed(2))
      : undefined

  const reviewCountDelta =
    typeof currentProfile.reviewCount === "number" &&
    typeof previousProfile.reviewCount === "number"
      ? currentProfile.reviewCount - previousProfile.reviewCount
      : undefined

  return {
    changes,
    ratingDelta,
    reviewCountDelta,
    hoursChanged,
  }
}
