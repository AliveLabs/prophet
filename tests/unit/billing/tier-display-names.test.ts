import { describe, it, expect } from "vitest"
import {
  getTierDisplayName,
  tierDisplayName,
  TIER_PRICING,
  ADD_ON_PRICING,
  addOnLocationPrice,
  PAID_TIERS,
} from "@/lib/billing/tiers"

// ALT-657 follow-up. The Stripe products were renamed to Starter / Standard / Multi-Location, but
// DISPLAY_NAMES still said "Table / Shift / House" and "Well / Call / Top Shelf" for another turn.
// That map is the one that reaches customers: the billing page, upgrade buttons, the trial gate,
// the trial-reminder emails, the held-account panel and the onboarding trial screen. So the
// invoice said one thing and the app said another.

const OLD_JARGON = ["Table", "Shift", "House", "Well", "Call", "Top Shelf", "Suspended"]

describe("customer-facing plan names", () => {
  it("uses the plain names on both brands", () => {
    for (const industry of ["restaurant", "liquor_store"] as const) {
      expect(getTierDisplayName("entry", industry)).toBe("Starter")
      expect(getTierDisplayName("mid", industry)).toBe("Standard")
      expect(getTierDisplayName("top", industry)).toBe("Multi-Location")
    }
  })

  it("no surface can still return the old jargon", () => {
    for (const industry of ["restaurant", "liquor_store"] as const) {
      for (const tier of ["entry", "mid", "top", "suspended"] as const) {
        expect(OLD_JARGON, `${industry}.${tier}`).not.toContain(getTierDisplayName(tier, industry))
      }
    }
  })

  it("the two brands cannot drift apart, because they read one object", () => {
    // Not just "they happen to match today". If someone edits one side, this fails.
    for (const tier of ["entry", "mid", "top", "suspended"] as const) {
      expect(getTierDisplayName(tier, "restaurant")).toBe(getTierDisplayName(tier, "liquor_store"))
    }
  })

  it("calls the suspended state Paused, not Suspended", () => {
    // "Suspended" is our word for our internal state. The operator experiences a pause.
    expect(getTierDisplayName("suspended", "restaurant")).toBe("Paused")
  })
})

describe("tierDisplayName: the brand-agnostic accessor", () => {
  it("agrees with getTierDisplayName rather than holding a second copy", () => {
    // It used to be a separate map. Two maps of the same facts is how the old names survived a
    // rename in the first place.
    for (const tier of ["entry", "mid", "top", "suspended"] as const) {
      expect(tierDisplayName(tier)).toBe(getTierDisplayName(tier, "restaurant"))
    }
  })

  it("maps the legacy subscription_tier values still on old rows", () => {
    expect(tierDisplayName("tier_1")).toBe("Starter")
    expect(tierDisplayName("tier_2")).toBe("Standard")
    expect(tierDisplayName("tier_3")).toBe("Multi-Location")
    // A legacy `free` row is a trial, and a trial is of the mid plan.
    expect(tierDisplayName("free")).toBe("Standard")
  })

  it("never renders a raw tier key or an empty string", () => {
    for (const input of ["", "nonsense", "TIER_9"]) {
      const out = tierDisplayName(input)
      expect(out).toBeTruthy()
      expect(out).not.toBe(input)
    }
  })

  it("degrades to the CHEAPEST plan name on an unknown value", () => {
    // Same polarity as asSubscriptionTier: a bad read must never imply a bigger plan than the
    // customer has.
    expect(tierDisplayName("nonsense")).toBe("Starter")
  })
})

describe("annual is two months free, and every surface can say so consistently", () => {
  it("holds on every price line", () => {
    const lines = [
      ...PAID_TIERS.filter((t) => t !== "suspended").map((t) => TIER_PRICING[t as "entry"]),
      addOnLocationPrice("entry"),
      addOnLocationPrice("mid"),
      ADD_ON_PRICING.competitor,
    ]
    for (const l of lines) {
      expect(l.annual).toBe(l.monthly * 10)
    }
  })

  it("the saving is ~16.7%, which is why the copy says 'two months free' instead", () => {
    // 16.7% reads worse than it is. Bryan's call: name the thing, not the percentage.
    const p = TIER_PRICING.mid
    const pct = 1 - p.annualEffectiveMonthly / p.monthly
    expect(pct).toBeGreaterThan(0.16)
    expect(pct).toBeLessThan(0.17)
  })

  it("the annual monthly-equivalent is a round number on the sold tiers", () => {
    // The whole reason annual is derived as monthly x 10 rather than a percentage off.
    expect(TIER_PRICING.entry.annualEffectiveMonthly).toBe(99)
    expect(TIER_PRICING.mid.annualEffectiveMonthly).toBe(249)
  })
})
