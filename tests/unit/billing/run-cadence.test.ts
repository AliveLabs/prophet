import { describe, it, expect } from "vitest"
import { TIER_LIMITS, PAID_TIERS, type SubscriptionTier } from "@/lib/billing/tiers"
import { isRunDueToday, runCadenceLabel } from "@/lib/billing/limits"

// ALT-683. The brief cadence is the entire justification for the Starter-versus-Standard price
// gap: $23.27 per location per month weekly against $73.25 daily, measured. Before this, the
// field that ENFORCED it was `eventsCadence`, filed under "internal pipeline tuning (not sold)",
// while a `briefingCadence` field sat in the sold block enforcing nothing.
//
// The concrete failure mode: anyone reasonably tidying `eventsCadence` down to "only gate the
// events pipeline" would have flipped Starter to daily briefs at 3x cost, silently, with no test
// to catch it. These tests exist so that edit fails loudly instead.

const MONDAY = 1
const WEDNESDAY = 3

describe("there is exactly ONE cadence field, and it is honestly named", () => {
  it("pins the cadence per tier", () => {
    expect(TIER_LIMITS.entry.runCadence).toBe("weekly")
    expect(TIER_LIMITS.mid.runCadence).toBe("daily")
    expect(TIER_LIMITS.top.runCadence).toBe("daily")
    expect(TIER_LIMITS.suspended.runCadence).toBe("weekly")
  })

  it("the paid tiers do NOT all share one cadence, because that difference is the price gap", () => {
    const cadences = new Set(PAID_TIERS.map((t) => TIER_LIMITS[t].runCadence))
    expect(cadences.size).toBeGreaterThan(1)
  })

  it("no second cadence field exists that would have to agree with runCadence", () => {
    // The bug was two fields that had to match with nothing enforcing the match. If a future
    // change reintroduces one, this fails and points at the reason.
    for (const tier of Object.keys(TIER_LIMITS) as SubscriptionTier[]) {
      const keys = Object.keys(TIER_LIMITS[tier])
      const cadenceish = keys.filter((k) => /cadence/i.test(k))
      // seoCadence is a genuinely different axis (how often search data is pulled).
      expect(cadenceish.sort()).toEqual(["runCadence", "seoCadence"])
      expect(keys).not.toContain("briefingCadence")
      expect(keys).not.toContain("eventsCadence")
    }
  })
})

describe("isRunDueToday: the gate the cron actually applies", () => {
  it("a daily location runs every day", () => {
    expect(isRunDueToday("daily", MONDAY)).toBe(true)
    expect(isRunDueToday("daily", WEDNESDAY)).toBe(true)
  })

  it("a weekly location runs Mondays and NOT mid-week", () => {
    expect(isRunDueToday("weekly", MONDAY)).toBe(true)
    expect(isRunDueToday("weekly", WEDNESDAY)).toBe(false)
  })

  it("covers every day of the week for a weekly location, so only Monday is true", () => {
    const due = [0, 1, 2, 3, 4, 5, 6].map((d) => isRunDueToday("weekly", d))
    expect(due).toEqual([false, true, false, false, false, false, false])
  })

  it("ALT-688: there is NO trial bypass. A trial inherits its plan's cadence", () => {
    // The signature deliberately has no `inActiveTrial`. A trial used to run daily on any plan,
    // which showed a Starter evaluator daily briefs and then took them away on the day they paid.
    // If this test is failing because someone re-added the option, read the comment on
    // isRunDueToday before "fixing" it.
    expect(Object.keys({ forced: true })).not.toContain("inActiveTrial")
    expect(isRunDueToday("weekly", WEDNESDAY)).toBe(false)
  })

  it("an explicitly requested single location bypasses the gate", () => {
    // A deliberate ops action, not the nightly sweep deciding whose turn it is.
    expect(isRunDueToday("weekly", WEDNESDAY, { forced: true })).toBe(true)
  })

  it("Starter mid-week is the case that costs money if it regresses", () => {
    // The whole point. If this ever returns true, every Starter location is running daily.
    expect(isRunDueToday(TIER_LIMITS.entry.runCadence, WEDNESDAY)).toBe(false)
    expect(isRunDueToday(TIER_LIMITS.mid.runCadence, WEDNESDAY)).toBe(true)
  })
})

describe("the promise and the enforcement come from the same field", () => {
  it("every tier's label matches what the gate does mid-week", () => {
    // This is the test the old code could not have had: the tiles phrased the promise from
    // `briefingCadence` while the cron enforced `eventsCadence`, so the two could disagree and
    // nothing would notice. Now a label saying "Weekly" must mean the location is skipped
    // mid-week, and a label saying "Daily" must mean it is not.
    for (const tier of Object.keys(TIER_LIMITS) as SubscriptionTier[]) {
      const label = runCadenceLabel(tier)
      const runsMidWeek = isRunDueToday(TIER_LIMITS[tier].runCadence, WEDNESDAY)
      expect(label === "Daily briefings").toBe(runsMidWeek)
    }
  })

  it("labels the tiers the pricing page sells", () => {
    expect(runCadenceLabel("entry")).toBe("Weekly briefings")
    expect(runCadenceLabel("mid")).toBe("Daily briefings")
  })

  it("an unknown-tier read cannot silently grant daily", () => {
    // asSubscriptionTier degrades to entry, so a bad read lands on the CHEAPER cadence.
    expect(runCadenceLabel("suspended")).toBe("Weekly briefings")
  })
})
