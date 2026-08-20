import { describe, it, expect } from "vitest"
import { ensureCanAddLocation, canAddLocationHere } from "@/lib/billing/limits"
import {
  isTrialActive,
  isTrialing,
  isPaidActive,
  getTrialDaysRemaining,
} from "@/lib/billing/trial"

const future = new Date(Date.now() + 7 * 86_400_000).toISOString()
const past = new Date(Date.now() - 86_400_000).toISOString()
const year2099 = "2099-01-01T00:00:00.000Z"

function org(over: Partial<{ trial_ends_at: string | null; subscription_tier: string; payment_state: string | null }>) {
  return { trial_ends_at: null, subscription_tier: "mid", payment_state: null, ...over }
}

describe("isTrialActive — the one access rule", () => {
  it("suspended is never active, whatever the other fields say", () => {
    expect(isTrialActive(org({ subscription_tier: "suspended", payment_state: "active" }))).toBe(false)
    expect(isTrialActive(org({ subscription_tier: "suspended", trial_ends_at: future }))).toBe(false)
  })

  it("Stripe states gate when payment_state is present", () => {
    for (const state of ["trialing", "active", "past_due", "incomplete"]) {
      expect(isTrialActive(org({ payment_state: state }))).toBe(true)
    }
    for (const state of ["canceled", "incomplete_expired", "unpaid"]) {
      expect(isTrialActive(org({ payment_state: state }))).toBe(false)
    }
  })

  it("null payment_state gates on the internal trial clock", () => {
    expect(isTrialActive(org({ trial_ends_at: future }))).toBe(true)
    expect(isTrialActive(org({ trial_ends_at: past }))).toBe(false)
  })

  it("a new org with no clock is blocked until checkout — the card gate", () => {
    expect(isTrialActive(org({ trial_ends_at: null }))).toBe(false)
  })

  it("legacy 'free' rows (pre-migration) still gate on the clock", () => {
    expect(isTrialActive(org({ subscription_tier: "free", trial_ends_at: future }))).toBe(true)
    expect(isTrialActive(org({ subscription_tier: "free", trial_ends_at: past }))).toBe(false)
  })

  it("internal orgs with a 2099 clock stay active", () => {
    expect(isTrialActive(org({ subscription_tier: "top", trial_ends_at: year2099 }))).toBe(true)
  })
})

describe("isTrialing", () => {
  it("card-backed Stripe trial", () => {
    expect(isTrialing(org({ payment_state: "trialing" }))).toBe(true)
  })

  it("legacy clock-only trial", () => {
    expect(isTrialing(org({ trial_ends_at: future }))).toBe(true)
    expect(isTrialing(org({ trial_ends_at: past }))).toBe(false)
    expect(isTrialing(org({ trial_ends_at: null }))).toBe(false)
  })

  it("converted / churned orgs are not trialing even with a stale clock", () => {
    expect(isTrialing(org({ payment_state: "active", trial_ends_at: future }))).toBe(false)
    expect(isTrialing(org({ payment_state: "canceled", trial_ends_at: future }))).toBe(false)
  })

  it("suspended is never trialing", () => {
    expect(isTrialing(org({ subscription_tier: "suspended", trial_ends_at: future }))).toBe(false)
  })
})

describe("isPaidActive", () => {
  it("active and dunning states count as paying", () => {
    expect(isPaidActive(org({ payment_state: "active" }))).toBe(true)
    expect(isPaidActive(org({ payment_state: "past_due" }))).toBe(true)
    expect(isPaidActive(org({ payment_state: "incomplete" }))).toBe(true)
  })

  it("trialing, churned, and card-less orgs do not", () => {
    expect(isPaidActive(org({ payment_state: "trialing" }))).toBe(false)
    expect(isPaidActive(org({ payment_state: "canceled" }))).toBe(false)
    expect(isPaidActive(org({ trial_ends_at: future }))).toBe(false)
  })

  it("suspended is never paid-active", () => {
    expect(isPaidActive(org({ subscription_tier: "suspended", payment_state: "active" }))).toBe(false)
  })
})

describe("getTrialDaysRemaining", () => {
  it("counts up from the clock, floors at zero", () => {
    expect(getTrialDaysRemaining({ trial_ends_at: future })).toBe(7)
    expect(getTrialDaysRemaining({ trial_ends_at: past })).toBe(0)
    expect(getTrialDaysRemaining({ trial_ends_at: null })).toBe(0)
  })
})

describe("ensureCanAddLocation — trials cover one location", () => {
  it("blocks a second location for any trialing org, with honest copy", () => {
    const trialingCarded = { subscription_tier: "mid", trial_ends_at: future, payment_state: "trialing" }
    const trialingClock = { subscription_tier: "mid", trial_ends_at: future, payment_state: null }
    expect(() => ensureCanAddLocation(trialingCarded, 1)).toThrow(/Trials cover one location/)
    expect(() => ensureCanAddLocation(trialingClock, 1)).toThrow(/Trials cover one location/)
  })

  it("allows the FIRST location during a trial", () => {
    expect(() =>
      ensureCanAddLocation({ subscription_tier: "mid", trial_ends_at: future, payment_state: "trialing" }, 0)
    ).not.toThrow()
  })

  it("paid orgs fall through to the plan allowance (1 / 1 / 3)", () => {
    // ALT-687 reworded the refusal: it used to say "Location limit reached for entry tier",
    // which names an internal tier at an operator. It now says what they can do about it.
    const paid = (tier: string) => ({ subscription_tier: tier, trial_ends_at: null, payment_state: "active" })
    const refused = /add another to your subscription/i
    expect(() => ensureCanAddLocation(paid("entry"), 1)).toThrow(refused)
    expect(() => ensureCanAddLocation(paid("mid"), 1)).toThrow(refused)
    expect(() => ensureCanAddLocation(paid("top"), 2)).not.toThrow()
    expect(() => ensureCanAddLocation(paid("top"), 3)).toThrow(refused)
  })

  it("ALT-687: a purchased location is honoured on top of the plan allowance", () => {
    const org = { subscription_tier: "entry", trial_ends_at: null, payment_state: "active", locations_purchased: 1 }
    // entry includes 1; with one bought, the second location is allowed and the third is not.
    expect(() => ensureCanAddLocation(org, 1)).not.toThrow()
    expect(() => ensureCanAddLocation(org, 2)).toThrow()
  })

  it("ALT-687: a purchased location does NOT open up a multi-location trial", () => {
    // The trial one-location rule is checked ahead of the allowance and must stay that way.
    const trialing = {
      subscription_tier: "mid",
      trial_ends_at: new Date(Date.now() + 86_400_000).toISOString(),
      payment_state: null,
      locations_purchased: 5,
    }
    expect(() => ensureCanAddLocation(trialing, 1)).toThrow(/trials cover one location/i)
  })
})

// A soft-deleted org must not GROW. The add-location server action resolves the org inline and
// never passes through the (dashboard) layout's deleted_at gate, so this is a real second line.
describe("ensureCanAddLocation: soft-deleted orgs (2026-08-10)", () => {
  const deleted = "2026-08-10T00:00:00Z"

  it("refuses a paid org under its cap once deleted_at is set", () => {
    expect(() =>
      ensureCanAddLocation(
        { subscription_tier: "top", trial_ends_at: null, payment_state: "active", deleted_at: deleted },
        0
      )
    ).toThrow(/no longer active/i)
  })

  // Checked ahead of the demo exemption, which returns before every other gate.
  it("refuses even a demo org, whose org_kind otherwise short-circuits all limits", () => {
    expect(() =>
      ensureCanAddLocation(
        { subscription_tier: "entry", trial_ends_at: null, org_kind: "demo", deleted_at: deleted },
        5
      )
    ).toThrow(/no longer active/i)
    expect(() =>
      ensureCanAddLocation({ subscription_tier: "entry", trial_ends_at: null, org_kind: "demo" }, 5)
    ).not.toThrow()
  })

  // Optional field: a caller whose select omits deleted_at keeps the old behavior rather than
  // throwing on an absent column. The four real call sites all select it.
  it("is inert for null/absent deleted_at", () => {
    expect(() =>
      ensureCanAddLocation({ subscription_tier: "top", trial_ends_at: null, payment_state: "active", deleted_at: null }, 0)
    ).not.toThrow()
    expect(() =>
      ensureCanAddLocation({ subscription_tier: "top", trial_ends_at: null, payment_state: "active" }, 0)
    ).not.toThrow()
  })

  it("canAddLocationHere mirrors it without throwing", () => {
    expect(
      canAddLocationHere(
        { subscription_tier: "top", trial_ends_at: null, payment_state: "active", deleted_at: deleted },
        0
      )
    ).toBe(false)
  })
})
