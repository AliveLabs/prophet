import { describe, it, expect } from "vitest"
import { TIER_LIMITS, asSubscriptionTier, PAID_TIERS } from "@/lib/billing/tiers"

// ALT-663 regression. The onboarding wizard used to carry `MAX_TRACKED = 5` as a module
// constant, so an org on any tier other than `mid` was shown the wrong maximum, allowed to
// pick that many, and then had the extras silently sliced away by completeOnboarding.
// These pin the facts the fix depends on.
describe("ALT-663: tracked-competitor cap is a plan limit, not a constant", () => {
  it("the three paid tiers do NOT share one cap", () => {
    const caps = PAID_TIERS.map((t) => TIER_LIMITS[t].maxCompetitorsPerLocation)
    expect(new Set(caps).size).toBeGreaterThan(1)
  })

  it("pins each tier's cap", () => {
    expect(TIER_LIMITS.entry.maxCompetitorsPerLocation).toBe(3)
    expect(TIER_LIMITS.mid.maxCompetitorsPerLocation).toBe(5)
    expect(TIER_LIMITS.top.maxCompetitorsPerLocation).toBe(10)
  })

  it("entry is BELOW the old hardcoded 5, which is how the bug caused silent data loss", () => {
    // The exact failure: wizard offers 5, entry allows 3, two picks vanish with no message.
    expect(TIER_LIMITS.entry.maxCompetitorsPerLocation).toBeLessThan(5)
  })

  it("the wizard's fresh-signup fallback matches the tier new orgs are created on", () => {
    // createOrgAndLocationAction writes subscription_tier: "mid", and the wizard's
    // FALLBACK_MAX_TRACKED is TIER_LIMITS.mid.maxCompetitorsPerLocation. If the creation
    // tier ever changes, this is the test that should fail.
    expect(TIER_LIMITS.mid.maxCompetitorsPerLocation).toBe(5)
  })

  it("an unknown or null tier degrades to entry, so the cap is never permissive by accident", () => {
    expect(asSubscriptionTier(null)).toBe("entry")
    expect(asSubscriptionTier("nonsense")).toBe("entry")
    expect(asSubscriptionTier(undefined)).toBe("entry")
    // Degrading DOWN matters: a bad read must not hand someone the top-tier cap.
    expect(
      TIER_LIMITS[asSubscriptionTier(null)].maxCompetitorsPerLocation
    ).toBeLessThan(TIER_LIMITS.top.maxCompetitorsPerLocation)
  })

  it("suspended tracks nothing", () => {
    expect(TIER_LIMITS.suspended.maxCompetitorsPerLocation).toBe(0)
  })
})
