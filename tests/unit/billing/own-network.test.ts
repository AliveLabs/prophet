import { describe, it, expect } from "vitest"
import {
  ALL_SOCIAL_PLATFORMS,
  TIER_LIMITS,
  resolveOwnSocialNetworks,
  isSocialPlatform,
} from "@/lib/billing/tiers"

describe("own-network-of-choice (trial-tier v2 · Batch 4)", () => {
  it("paid Tier 1 collects exactly the chosen network", () => {
    expect(resolveOwnSocialNetworks("entry", "tiktok")).toEqual(["tiktok"])
    expect(resolveOwnSocialNetworks("entry", "facebook")).toEqual(["facebook"])
  })

  it("Tier 1 defaults to Instagram when no choice is stored", () => {
    expect(resolveOwnSocialNetworks("entry", null)).toEqual(["instagram"])
    expect(resolveOwnSocialNetworks("entry")).toEqual(["instagram"])
  })

  it("mid/top get all three networks — the choice is irrelevant", () => {
    expect(resolveOwnSocialNetworks("mid", "tiktok")).toEqual(ALL_SOCIAL_PLATFORMS)
    expect(resolveOwnSocialNetworks("top", null)).toEqual(ALL_SOCIAL_PLATFORMS)
  })

  it("suspended collects nothing", () => {
    expect(resolveOwnSocialNetworks("suspended", "instagram")).toEqual([])
  })

  it("competitor coverage is all networks on every selling tier", () => {
    expect(TIER_LIMITS.entry.competitorSocialNetworks).toEqual(ALL_SOCIAL_PLATFORMS)
    expect(TIER_LIMITS.mid.competitorSocialNetworks).toEqual(ALL_SOCIAL_PLATFORMS)
    expect(TIER_LIMITS.top.competitorSocialNetworks).toEqual(ALL_SOCIAL_PLATFORMS)
  })

  it("isSocialPlatform narrows DB values", () => {
    expect(isSocialPlatform("instagram")).toBe(true)
    expect(isSocialPlatform("tiktok")).toBe(true)
    expect(isSocialPlatform("twitter")).toBe(false)
    expect(isSocialPlatform(null)).toBe(false)
  })
})
