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
