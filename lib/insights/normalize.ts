import type { NormalizedSnapshot } from "@/lib/providers/types"

export function normalizeSnapshot(snapshot: NormalizedSnapshot): NormalizedSnapshot {
  const normalized: NormalizedSnapshot = {
    ...snapshot,
    profile: snapshot.profile
      ? {
          ...snapshot.profile,
          rating:
            typeof snapshot.profile.rating === "number"
              ? Number(snapshot.profile.rating.toFixed(2))
              : snapshot.profile.rating,
          reviewCount:
            typeof snapshot.profile.reviewCount === "number"
              ? Math.max(0, Math.round(snapshot.profile.reviewCount))
              : snapshot.profile.reviewCount,
        }
      : undefined,
    hours: snapshot.hours
      ? Object.fromEntries(
          Object.entries(snapshot.hours).map(([day, hours]) => [
            day,
            hours.trim().replace(/\s+/g, " "),
          ])
        )
      : undefined,
  }

  return normalized
}
