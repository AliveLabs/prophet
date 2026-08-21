// Skip-the-card onboarding: card-less trials (payment_state null + a live clock) must get
// the day 10 / 13 reminders too — the cron used to select only payment_state='trialing', so
// those orgs hit day 14 with no warning. These cases pin BOTH the widened eligibility and
// the exclusions that keep the wrong mail from going out (demo/beta orgs, suspended orgs,
// ex-customers with a terminal payment_state).

import { describe, it, expect } from "vitest"
import { resolveReminderDay, hasCardOnFile } from "@/lib/billing/trial-reminders"

const NOW = new Date("2026-07-24T12:00:00.000Z")

/** trial_ends_at exactly `days` out from NOW (matches the cron's Math.ceil day math). */
function endsIn(days: number): string {
  return new Date(NOW.getTime() + days * 86_400_000).toISOString()
}

describe("resolveReminderDay — card-backed Stripe trials", () => {
  it("returns day 10 at T-4", () => {
    expect(
      resolveReminderDay({ trial_ends_at: endsIn(4), payment_state: "trialing", org_kind: "real" }, NOW)
    ).toBe(10)
  })

  it("returns day 13 at T-1", () => {
    expect(
      resolveReminderDay({ trial_ends_at: endsIn(1), payment_state: "trialing", org_kind: "real" }, NOW)
    ).toBe(13)
  })

  it("returns null on non-reminder days", () => {
    for (const d of [2, 3, 5, 7, 14]) {
      expect(
        resolveReminderDay({ trial_ends_at: endsIn(d), payment_state: "trialing", org_kind: "real" }, NOW)
      ).toBeNull()
    }
  })
})

describe("resolveReminderDay — card-less trials (skip for now)", () => {
  it("gets day 10 at T-4 (the regression this fixes: previously silent)", () => {
    expect(
      resolveReminderDay({ trial_ends_at: endsIn(4), payment_state: null, org_kind: "real" }, NOW)
    ).toBe(10)
  })

  it("gets day 13 at T-1", () => {
    expect(
      resolveReminderDay({ trial_ends_at: endsIn(1), payment_state: null, org_kind: "real" }, NOW)
    ).toBe(13)
  })

  it("is eligible when payment_state is absent entirely (undefined)", () => {
    expect(resolveReminderDay({ trial_ends_at: endsIn(1), org_kind: "real" }, NOW)).toBe(13)
  })
})

describe("resolveReminderDay — exclusions", () => {
  it("never mails demo/beta orgs (long internal trials)", () => {
    expect(
      resolveReminderDay({ trial_ends_at: endsIn(4), payment_state: null, org_kind: "demo" }, NOW)
    ).toBeNull()
    expect(
      resolveReminderDay({ trial_ends_at: endsIn(1), payment_state: "trialing", org_kind: "test" }, NOW)
    ).toBeNull()
  })

  it("never mails suspended orgs", () => {
    expect(
      resolveReminderDay(
        { trial_ends_at: endsIn(4), payment_state: null, subscription_tier: "suspended", org_kind: "real" },
        NOW
      )
    ).toBeNull()
  })

  it("ignores terminal / non-trial payment states", () => {
    for (const state of ["canceled", "unpaid", "incomplete_expired", "active", "past_due"]) {
      expect(
        resolveReminderDay({ trial_ends_at: endsIn(1), payment_state: state, org_kind: "real" }, NOW)
      ).toBeNull()
    }
  })

  it("ignores orgs with no clock, and already-expired trials", () => {
    expect(resolveReminderDay({ trial_ends_at: null, payment_state: null, org_kind: "real" }, NOW)).toBeNull()
    expect(
      resolveReminderDay({ trial_ends_at: endsIn(-2), payment_state: null, org_kind: "real" }, NOW)
    ).toBeNull()
  })

  it("treats a null org_kind as eligible (legacy rows predate the column)", () => {
    expect(
      resolveReminderDay({ trial_ends_at: endsIn(4), payment_state: null, org_kind: null }, NOW)
    ).toBe(10)
  })
})

describe("hasCardOnFile — drives charge-vs-add-a-card copy", () => {
  it("is true only when a payment_state exists", () => {
    expect(hasCardOnFile({ payment_state: "trialing" })).toBe(true)
    expect(hasCardOnFile({ payment_state: "active" })).toBe(true)
    expect(hasCardOnFile({ payment_state: null })).toBe(false)
    expect(hasCardOnFile({})).toBe(false)
  })
})

// ── ALT-710: the reminder schedule must not depend on the hour someone signed up ───────────
//
// The cron is `0 9 * * *` UTC and `trial_ends_at` is signup + 14 days, so it lands at whatever
// hour the customer happened to sign up. The old `Math.ceil(msRemaining / 86400000)` mixed an
// instant delta with a day count, which shifted the whole schedule by a day for every signup
// after 09:00 UTC and put the "your trial ends tomorrow" email on the charge day itself.
//
// Every case above uses exact 24-hour multiples of NOW, which is the one case where ceil is
// correct. That is why the bug survived: the tests and the bug agreed. These use real clock
// offsets instead.

/** The 09:00 UTC cron firing on the calendar day `dayOffset` days after `signup`. */
function cronOn(signup: string, dayOffset: number): Date {
  const s = new Date(signup)
  return new Date(
    Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate() + dayOffset, 9, 0, 0),
  )
}

function trialEnd(signup: string): string {
  return new Date(new Date(signup).getTime() + 14 * 86_400_000).toISOString()
}

describe("resolveReminderDay: reminder days are stable across signup hour (ALT-710)", () => {
  // 08:00 signs up before the cron hour, 10:00 and 23:30 after it. All three must get the same
  // reminders on the same trial days.
  const SIGNUPS = [
    "2026-08-01T00:15:00.000Z",
    "2026-08-01T08:00:00.000Z",
    "2026-08-01T09:00:00.000Z",
    "2026-08-01T10:00:00.000Z",
    "2026-08-01T17:45:00.000Z",
    "2026-08-01T23:30:00.000Z",
  ]

  for (const signup of SIGNUPS) {
    const hour = signup.slice(11, 16)
    const org = { trial_ends_at: trialEnd(signup), payment_state: "trialing", org_kind: "real" }

    it(`signup ${hour}: day-10 email lands on trial day 10`, () => {
      expect(resolveReminderDay(org, cronOn(signup, 10))).toBe(10)
    })

    it(`signup ${hour}: day-13 email lands on trial day 13`, () => {
      expect(resolveReminderDay(org, cronOn(signup, 13))).toBe(13)
    })

    // The one that shipped: a "your trial ends tomorrow" email on the day it actually ends.
    it(`signup ${hour}: nothing is sent on day 14, the charge day`, () => {
      expect(resolveReminderDay(org, cronOn(signup, 14))).toBeNull()
    })

    it(`signup ${hour}: no email on days 11 or 12`, () => {
      expect(resolveReminderDay(org, cronOn(signup, 11))).toBeNull()
      expect(resolveReminderDay(org, cronOn(signup, 12))).toBeNull()
    })
  }

  it("each reminder fires on exactly one calendar day, never twice and never zero times", () => {
    for (const signup of SIGNUPS) {
      const org = { trial_ends_at: trialEnd(signup), payment_state: "trialing", org_kind: "real" }
      const fired: Record<string, number[]> = { 10: [], 13: [] }
      for (let day = 0; day <= 20; day++) {
        const r = resolveReminderDay(org, cronOn(signup, day))
        if (r) fired[String(r)].push(day)
      }
      expect(fired["10"], `signup ${signup} day-10 email`).toEqual([10])
      expect(fired["13"], `signup ${signup} day-13 email`).toEqual([13])
    }
  })
})
