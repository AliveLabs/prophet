import { createHash } from "crypto"
import type { NormalizedSnapshot } from "@/lib/providers/types"

export function computeDiffHash(snapshot: NormalizedSnapshot) {
  const payload = {
    profile: {
      rating: snapshot.profile?.rating ?? null,
      reviewCount: snapshot.profile?.reviewCount ?? null,
      priceLevel: snapshot.profile?.priceLevel ?? null,
      address: snapshot.profile?.address ?? null,
      website: snapshot.profile?.website ?? null,
      phone: snapshot.profile?.phone ?? null,
    },
    hours: snapshot.hours ?? {},
  }

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex")
}
