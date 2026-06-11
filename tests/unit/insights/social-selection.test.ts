// The masking-bug fix (trial-tier-model-plan Batch 0): an entity's representative
// social snapshot must be its best USABLE platform — a dead Instagram must never
// mask a live TikTok (Bush's Forney, found in Bryan's review 2026-06-11).

import { describe, it, expect } from "vitest"
import { pickSocialSnapshot, type SocialCandidate } from "@/lib/insights/dossier/build"
import type { SocialSnapshotData } from "@/lib/social/types"

const raw = (platform: string) => ({ profile: { handle: `h-${platform}` } }) as unknown as SocialSnapshotData

function cand(platform: string, status: SocialCandidate["status"], contentAsOf: string | null): SocialCandidate {
  return { raw: raw(platform), platform, status, contentAsOf }
}

describe("pickSocialSnapshot", () => {
  it("a live TikTok beats a dead Instagram (the Bush's Forney case)", () => {
    const picked = pickSocialSnapshot([
      cand("instagram", "dormant", "2022-01-07T16:01:00Z"),
      cand("tiktok", "aging", "2026-05-07T01:45:52Z"),
    ])
    expect(picked?.platform).toBe("tiktok")
  })

  it("among usable platforms, newest content wins regardless of platform", () => {
    const picked = pickSocialSnapshot([
      cand("instagram", "aging", "2026-04-01T00:00:00Z"),
      cand("tiktok", "fresh", "2026-06-01T00:00:00Z"),
    ])
    expect(picked?.platform).toBe("tiktok")
  })

  it("Instagram is the tiebreak only between equals", () => {
    const picked = pickSocialSnapshot([
      cand("tiktok", "fresh", "2026-06-01T00:00:00Z"),
      cand("instagram", "fresh", "2026-06-01T00:00:00Z"),
    ])
    expect(picked?.platform).toBe("instagram")
  })

  it("returns null when every platform is dormant/empty/undated", () => {
    expect(
      pickSocialSnapshot([
        cand("instagram", "dormant", "2022-01-07T16:01:00Z"),
        cand("tiktok", "empty", null),
        cand("facebook", "undated", null),
      ])
    ).toBeNull()
  })

  it("returns null for no candidates", () => {
    expect(pickSocialSnapshot([])).toBeNull()
  })
})
