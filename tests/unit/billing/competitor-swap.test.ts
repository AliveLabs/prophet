import { describe, it, expect } from "vitest"
import {
  COMPETITOR_SWAP_COOLDOWN_DAYS,
  TRIAL_COMPETITOR_SWAPS,
  readSwapHistory,
  stampSwapOut,
  computeSwapAllowance,
  swapLockedMessage,
  ensureSwapAllowed,
} from "@/lib/billing/limits"

// The competitor swap rule, revised 2026-08-20 from a flat 1-per-30-days to:
//   trial -> TRIAL_COMPETITOR_SWAPS swaps, no waiting period
//   paid  -> one swap per COMPETITOR_SWAP_COOLDOWN_DAYS
// There was NO test on the old rule, which is part of why the 30-day figure went unexamined
// for so long. These pin the parts a future change could quietly break.

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date("2026-08-20T12:00:00.000Z")
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString()

describe("the two constants are the rule, not magic numbers in copy", () => {
  it("pins both values", () => {
    expect(COMPETITOR_SWAP_COOLDOWN_DAYS).toBe(7)
    expect(TRIAL_COMPETITOR_SWAPS).toBe(2)
  })

  it("the interval is shorter than a month, which was the point of the change", () => {
    expect(COMPETITOR_SWAP_COOLDOWN_DAYS).toBeLessThan(30)
  })
})

describe("readSwapHistory", () => {
  it("counts stamped swaps and takes the latest as the anchor", () => {
    const h = readSwapHistory([
      { is_active: false, metadata: { status: "ignored", swapHistory: [ago(9), ago(2)] } },
      { is_active: true, metadata: { status: "approved" } },
    ])
    expect(h.swapsUsed).toBe(2)
    expect(h.lastSwapAt).toBe(ago(2))
  })

  it("counts a swap on a row that was removed and RE-ADDED, which is the rotation case", () => {
    // The row is active again (re-approved), so an is_active=false filter would miss it and
    // hand a rotating operator unlimited swaps. This is the bug the metadata stamp exists for.
    const h = readSwapHistory([
      { is_active: true, metadata: { status: "approved", swapHistory: [ago(1)] } },
    ])
    expect(h.swapsUsed).toBe(1)
    expect(h.lastSwapAt).toBe(ago(1))
  })

  it("falls back to updated_at for legacy rows with no stamp", () => {
    const h = readSwapHistory([
      { is_active: false, updated_at: ago(3), metadata: { status: "ignored" } },
    ])
    expect(h.swapsUsed).toBe(1)
    expect(h.lastSwapAt).toBe(ago(3))
  })

  it("does not double-count a stamped row by also reading its updated_at", () => {
    const h = readSwapHistory([
      { is_active: false, updated_at: ago(1), metadata: { status: "ignored", swapHistory: [ago(5)] } },
    ])
    expect(h.swapsUsed).toBe(1)
    expect(h.lastSwapAt).toBe(ago(5))
  })

  it("ignores approved rows, junk metadata, and empty input", () => {
    expect(readSwapHistory(null).swapsUsed).toBe(0)
    expect(readSwapHistory([]).lastSwapAt).toBeNull()
    expect(readSwapHistory([{ is_active: true, updated_at: ago(1), metadata: { status: "approved" } }]).swapsUsed).toBe(0)
    // ALT-261: an auto-approved onboarding pick must never start the clock.
    expect(readSwapHistory([{ is_active: false, updated_at: ago(1), metadata: { status: "approved" } }]).swapsUsed).toBe(0)
    expect(readSwapHistory([{ is_active: false, metadata: { status: "ignored", swapHistory: "nope" } }]).swapsUsed).toBe(0)
  })
})

describe("stampSwapOut", () => {
  it("appends without disturbing other metadata keys", () => {
    const out = stampSwapOut({ status: "approved", relevance: 0.8 }, ago(0))
    expect(out).toMatchObject({ status: "ignored", relevance: 0.8, swapHistory: [ago(0)] })
  })

  it("appends to an existing history rather than replacing it", () => {
    const out = stampSwapOut({ swapHistory: [ago(20)] }, ago(0))
    expect(out.swapHistory).toEqual([ago(20), ago(0)])
  })

  it("survives a re-add, so the count cannot be reset by rotating", () => {
    // add-competitor re-approves by spreading existing metadata and overriding status only.
    const removed = stampSwapOut({ status: "approved" }, ago(4))
    const readded = { ...removed, status: "approved" }
    expect(readSwapHistory([{ is_active: true, metadata: readded }]).swapsUsed).toBe(1)
  })
})

describe("trial: a fixed allowance with no waiting period", () => {
  it("allows a swap immediately after another one", () => {
    const a = computeSwapAllowance({ lastSwapAt: ago(0), swapsUsed: 1 }, { trialing: true }, NOW)
    expect(a.locked).toBe(false)
    expect(a.trialSwapsRemaining).toBe(1)
  })

  it("locks once the allowance is spent, even though nothing recent happened", () => {
    const a = computeSwapAllowance({ lastSwapAt: ago(60), swapsUsed: 2 }, { trialing: true }, NOW)
    expect(a.locked).toBe(true)
    expect(a.reason).toBe("trial_exhausted")
    expect(a.trialSwapsRemaining).toBe(0)
  })

  it("offers no unlock date, because a clock is not what clears it", () => {
    const a = computeSwapAllowance({ lastSwapAt: ago(1), swapsUsed: 5 }, { trialing: true }, NOW)
    expect(a.unlocksAt).toBeNull()
    expect(a.daysRemaining).toBe(0)
    expect(swapLockedMessage(a)).toMatch(/subscribe/i)
  })
})

describe("paid: one swap per interval", () => {
  it("is unlocked when there has never been a swap", () => {
    const a = computeSwapAllowance({ lastSwapAt: null, swapsUsed: 0 }, { trialing: false }, NOW)
    expect(a.locked).toBe(false)
    expect(a.trialSwapsRemaining).toBeNull()
  })

  it("locks inside the window and reports whole days left", () => {
    const a = computeSwapAllowance({ lastSwapAt: ago(2), swapsUsed: 1 }, { trialing: false }, NOW)
    expect(a.locked).toBe(true)
    expect(a.reason).toBe("cooldown")
    expect(a.daysRemaining).toBe(COMPETITOR_SWAP_COOLDOWN_DAYS - 2)
    expect(a.unlocksAt).toBe(new Date(NOW.getTime() + 5 * DAY).toISOString())
  })

  it("clears exactly at the boundary", () => {
    expect(
      computeSwapAllowance({ lastSwapAt: ago(COMPETITOR_SWAP_COOLDOWN_DAYS), swapsUsed: 1 }, { trialing: false }, NOW)
        .locked
    ).toBe(false)
  })

  it("never says zero days remaining while still locked", () => {
    const a = computeSwapAllowance(
      { lastSwapAt: new Date(NOW.getTime() - COMPETITOR_SWAP_COOLDOWN_DAYS * DAY + 1000).toISOString(), swapsUsed: 1 },
      { trialing: false },
      NOW
    )
    expect(a.locked).toBe(true)
    expect(a.daysRemaining).toBe(1)
  })

  it("ignores a spent trial allowance once the org is paying", () => {
    // Converting does not punish someone for the swaps they used while trialing; only the
    // interval binds from here on.
    const a = computeSwapAllowance({ lastSwapAt: ago(30), swapsUsed: 9 }, { trialing: false }, NOW)
    expect(a.locked).toBe(false)
  })

  it("does NOT hand out a fresh swap on conversion: the interval runs from the last swap", () => {
    const a = computeSwapAllowance({ lastSwapAt: ago(1), swapsUsed: 2 }, { trialing: false }, NOW)
    expect(a.locked).toBe(true)
    expect(a.daysRemaining).toBe(COMPETITOR_SWAP_COOLDOWN_DAYS - 1)
  })

  it("treats an unparseable timestamp as unlocked rather than locking someone out forever", () => {
    expect(computeSwapAllowance({ lastSwapAt: "not-a-date", swapsUsed: 1 }, { trialing: false }, NOW).locked).toBe(false)
  })
})

describe("the guard and the wording", () => {
  it("ensureSwapAllowed throws only when locked, with the operator-facing message", () => {
    const locked = computeSwapAllowance({ lastSwapAt: ago(1), swapsUsed: 1 }, { trialing: false }, NOW)
    expect(() => ensureSwapAllowed(locked)).toThrow(/once every 7 days/)
    const open = computeSwapAllowance({ lastSwapAt: null, swapsUsed: 0 }, { trialing: false }, NOW)
    expect(() => ensureSwapAllowed(open)).not.toThrow()
  })

  it("says 'day' not 'days' at one day left", () => {
    const a = computeSwapAllowance({ lastSwapAt: ago(6), swapsUsed: 1 }, { trialing: false }, NOW)
    expect(swapLockedMessage(a)).toContain("1 more day.")
  })

  it("carries no em dash: brand canon bans it, and this string is customer-facing", () => {
    const cases = [
      computeSwapAllowance({ lastSwapAt: ago(1), swapsUsed: 1 }, { trialing: false }, NOW),
      computeSwapAllowance({ lastSwapAt: ago(1), swapsUsed: 2 }, { trialing: true }, NOW),
    ]
    for (const a of cases) expect(swapLockedMessage(a)).not.toMatch(/[—–]/)
  })
})
