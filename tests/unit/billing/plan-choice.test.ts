// ALT-645 — carrying the visitor's plan choice from the marketing pricing page into onboarding.
//
// The defect: both pricing CTAs linked to the same bare /signup, so a visitor who clicked "Get
// started" under Starter arrived at a picker with Standard-annual preselected, looking at $249.
//
// The security posture these tests pin: this value is an INTENT HINT and is never a billing input.
// /api/stripe/checkout reads its tier and cadence from the request body, i.e. from what the operator
// actually clicked in the picker. So a forged cookie can change a highlight and cannot change a
// charge. That is what makes an unsigned, client-writable cookie the right tool here, and these
// tests exist so nobody later "improves" it into something that decides a price.

import { describe, expect, it } from "vitest"
import {
  deserialisePlanChoice,
  isEmptyPlanChoice,
  parsePlanChoice,
  serialisePlanChoice,
  PLAN_CHOICE_MAX_AGE_SECONDS,
} from "@/lib/billing/plan-choice"
import { SELF_SERVE_TIERS, TIER_PRICING } from "@/lib/billing/tiers"

describe("parsing the public URL parameters", () => {
  it("maps the buyer-facing plan names onto internal tiers", () => {
    expect(parsePlanChoice({ plan: "starter" })).toEqual({ tier: "entry" })
    expect(parsePlanChoice({ plan: "standard" })).toEqual({ tier: "mid" })
  })

  it("accepts both cadences and nothing else", () => {
    expect(parsePlanChoice({ billing: "annual" })).toEqual({ cadence: "annual" })
    expect(parsePlanChoice({ billing: "monthly" })).toEqual({ cadence: "monthly" })
    expect(parsePlanChoice({ billing: "yearly" })).toEqual({})
  })

  it("is case and whitespace tolerant, because these come off a hand-editable URL", () => {
    expect(parsePlanChoice({ plan: "  STARTER ", billing: "Annual" })).toEqual({
      tier: "entry",
      cadence: "annual",
    })
  })

  it("REFUSES the internal tier names, so a public URL never leaks them", () => {
    // `entry`/`mid` have already been renamed once (ALT-657, ALT-764). A public URL parameter
    // carrying them becomes a name we can no longer change.
    expect(parsePlanChoice({ plan: "entry" })).toEqual({})
    expect(parsePlanChoice({ plan: "mid" })).toEqual({})
    expect(parsePlanChoice({ plan: "top" })).toEqual({})
  })

  it("refuses a tier with no self-serve checkout", () => {
    // Multi-Location is contact-us. A link claiming to preselect it would promise a checkout that
    // does not exist.
    expect(parsePlanChoice({ plan: "multi-location" })).toEqual({})
    expect(parsePlanChoice({ plan: "suspended" })).toEqual({})
  })

  it("drops what it does not recognise instead of guessing a default", () => {
    // Guessing that `plan=pro` meant Standard is how somebody lands on a plan they did not pick.
    expect(parsePlanChoice({ plan: "pro" })).toEqual({})
    expect(parsePlanChoice({ plan: "agency", billing: "annual" })).toEqual({ cadence: "annual" })
  })

  it("survives arrays, nulls and missing keys, which is what searchParams actually hands you", () => {
    expect(parsePlanChoice({})).toEqual({})
    expect(parsePlanChoice({ plan: null, billing: undefined })).toEqual({})
    // A repeated ?plan=a&plan=b arrives as an array. Ambiguous input is no input.
    expect(parsePlanChoice({ plan: ["starter", "standard"] })).toEqual({})
  })

  it("recognises an empty choice", () => {
    expect(isEmptyPlanChoice(parsePlanChoice({ plan: "nonsense" }))).toBe(true)
    expect(isEmptyPlanChoice(parsePlanChoice({ plan: "starter" }))).toBe(false)
  })
})

describe("the cookie round trip", () => {
  it("survives serialise then deserialise, for every valid combination", () => {
    for (const tier of SELF_SERVE_TIERS) {
      for (const cadence of ["monthly", "annual"] as const) {
        const choice = { tier, cadence }
        expect(deserialisePlanChoice(serialisePlanChoice(choice))).toEqual(choice)
      }
    }
  })

  it("carries a cadence with no tier, and a tier with no cadence", () => {
    expect(deserialisePlanChoice(serialisePlanChoice({ cadence: "monthly" }))).toEqual({
      cadence: "monthly",
    })
    expect(deserialisePlanChoice(serialisePlanChoice({ tier: "entry" }))).toEqual({ tier: "entry" })
  })

  it("validates the cookie as strictly as the URL, because a cookie is not more trustworthy", () => {
    // Client-writable and deliberately unsigned. Anything unrecognised must fall out.
    expect(deserialisePlanChoice("top:annual")).toEqual({ cadence: "annual" })
    expect(deserialisePlanChoice("suspended:annual")).toEqual({ cadence: "annual" })
    expect(deserialisePlanChoice("entry:forever")).toEqual({ tier: "entry" })
    expect(deserialisePlanChoice("../../etc/passwd")).toEqual({})
    expect(deserialisePlanChoice("entry:annual:extra")).toEqual({ tier: "entry", cadence: "annual" })
  })

  it("treats absent, empty and malformed values as no choice at all", () => {
    for (const v of [null, undefined, "", ":", "::", "garbage"]) {
      expect(deserialisePlanChoice(v), JSON.stringify(v)).toEqual({})
    }
  })

  it("never yields a tier that has no price, which is what would break the picker", () => {
    // The picker reads TIER_PRICING[tier]. A tier that parsed but had no price would render
    // `$undefined`, so the parse and the price table have to agree.
    for (const raw of ["starter:annual", "standard:monthly", "top:annual", "nonsense:annual"]) {
      const { tier } = deserialisePlanChoice(raw)
      if (tier) expect(TIER_PRICING[tier], raw).toBeDefined()
    }
  })
})

describe("the hint's lifetime", () => {
  it("outlives reading the email tomorrow, and expires well inside a month", () => {
    // Long enough that a magic link opened the next morning still carries the choice; short enough
    // that a decision made a fortnight ago does not resurface as though it were current.
    expect(PLAN_CHOICE_MAX_AGE_SECONDS).toBeGreaterThan(24 * 60 * 60)
    expect(PLAN_CHOICE_MAX_AGE_SECONDS).toBeLessThanOrEqual(30 * 24 * 60 * 60)
  })
})
