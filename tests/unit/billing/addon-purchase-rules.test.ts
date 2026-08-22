import { describe, expect, it } from "vitest"
import {
  MAX_ADDON_QUANTITY,
  addOnRecurringSummary,
  planAddOnChange,
  type AddOnContext,
} from "@/lib/stripe/addons"
import { ADD_ON_PRICING, addOnLocationPrice } from "@/lib/billing/tiers"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

// ── ALT-689 ─────────────────────────────────────────────────────────────────────────────────
//
// Every rule that can refuse an add-on purchase. These are money-moving paths on a live product,
// and the reason the decision logic is a pure function is so each refusal has a test rather than
// living only inside an API route where vitest cannot reach it.

const paid: AddOnContext = {
  tier: "mid",
  cadence: "monthly",
  trialing: false,
  hasSubscription: true,
  currentQuantity: 0,
}

describe("a trial cannot buy add-ons (Bryan, 2026-08-22)", () => {
  it("refuses while trialing, whatever the quantity", () => {
    const r = planAddOnChange({ ...paid, trialing: true }, { kind: "location", quantity: 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("trialing")
  })

  it("gates on the SUBSCRIPTION being in trial, not on the tier", () => {
    // The trial always runs on Standard (TRIAL_ELIGIBLE_TIERS is ["mid"]), so a tier check would
    // never catch a trialing customer. This is the test that pins the right predicate.
    const trialingOnMid = { ...paid, tier: "mid" as const, trialing: true }
    const paidOnMid = { ...paid, tier: "mid" as const, trialing: false }
    expect(planAddOnChange(trialingOnMid, { kind: "location", quantity: 1 }).ok).toBe(false)
    expect(planAddOnChange(paidOnMid, { kind: "location", quantity: 1 }).ok).toBe(true)
  })

  it("offers conversion rather than a dead end", () => {
    const r = planAddOnChange({ ...paid, trialing: true }, { kind: "location", quantity: 1 })
    if (r.ok) throw new Error("expected refusal")
    expect(r.message).toMatch(/add a card|start your subscription/i)
    expect(r.message).not.toMatch(/[—–]/)
  })
})

describe("Multi-Location quantities are not sold online", () => {
  it("refuses a top-tier org and points at a conversation", () => {
    const r = planAddOnChange({ ...paid, tier: "top" }, { kind: "location", quantity: 2 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe("not_self_serve_tier")
      expect(r.message).toMatch(/Multi-Location/)
      // Never resolve to a null price ID further down: there is no ADDON_LOCATION_TOP env var,
      // deliberately, because Custom quantities are part of a negotiated deal.
      expect(r.message).toMatch(/get in touch/i)
    }
  })

  it("allows Starter and Standard", () => {
    for (const tier of ["entry", "mid"] as const) {
      expect(planAddOnChange({ ...paid, tier }, { kind: "location", quantity: 1 }).ok).toBe(true)
    }
  })

  it("refuses a suspended org", () => {
    expect(planAddOnChange({ ...paid, tier: "suspended" }, { kind: "location", quantity: 1 }).ok).toBe(
      false,
    )
  })
})

describe("competitor slots must say WHICH location (ALT-756)", () => {
  it("refuses a competitor purchase with no location", () => {
    const r = planAddOnChange(paid, { kind: "competitor", quantity: 2 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("location_required")
  })

  it("accepts one with a location", () => {
    expect(planAddOnChange(paid, { kind: "competitor", quantity: 2, locationId: "loc_1" }).ok).toBe(
      true,
    )
  })

  it("a LOCATION add-on needs no location id, since it creates capacity rather than using it", () => {
    expect(planAddOnChange(paid, { kind: "location", quantity: 2 }).ok).toBe(true)
  })
})

describe("removing is as easy as adding, but must not orphan a paid slot", () => {
  it("allows going to zero when nothing else holds a slot", () => {
    const r = planAddOnChange(
      { ...paid, currentQuantity: 3, allocatedElsewhere: 0 },
      { kind: "competitor", quantity: 0, locationId: "loc_1" },
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.delta).toBe(-3)
  })

  it("refuses a reduction below what OTHER locations are already using", () => {
    // Otherwise the other location keeps a competitor nobody is paying for, which is the mirror
    // image of ALT-731 (billing for work not performed).
    const r = planAddOnChange(
      { ...paid, currentQuantity: 4, allocatedElsewhere: 3 },
      { kind: "competitor", quantity: 2, locationId: "loc_1" },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe("would_orphan_allocation")
      expect(r.message).toMatch(/other locations are using 3/i)
    }
  })

  it("allows a reduction down to exactly what others hold", () => {
    const r = planAddOnChange(
      { ...paid, currentQuantity: 4, allocatedElsewhere: 3 },
      { kind: "competitor", quantity: 3, locationId: "loc_1" },
    )
    expect(r.ok).toBe(true)
  })
})

describe("quantity validation", () => {
  it("rejects negatives, fractions and non-numbers", () => {
    for (const q of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = planAddOnChange(paid, { kind: "location", quantity: q })
      expect(r.ok, `quantity ${q}`).toBe(false)
      if (!r.ok) expect(r.reason).toBe("invalid_quantity")
    }
  })

  it("caps at a sane ceiling so a fat finger is not a five-figure invoice", () => {
    expect(planAddOnChange(paid, { kind: "location", quantity: MAX_ADDON_QUANTITY }).ok).toBe(true)
    const over = planAddOnChange(paid, { kind: "location", quantity: MAX_ADDON_QUANTITY + 1 })
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.reason).toBe("invalid_quantity")
  })

  it("treats an unchanged quantity as a no-op rather than a write", () => {
    const r = planAddOnChange({ ...paid, currentQuantity: 2 }, { kind: "location", quantity: 2 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("unchanged")
  })
})

describe("the quantity is absolute, not a delta", () => {
  it("computes the delta from the current billed quantity", () => {
    const up = planAddOnChange({ ...paid, currentQuantity: 1 }, { kind: "location", quantity: 4 })
    const down = planAddOnChange({ ...paid, currentQuantity: 4 }, { kind: "location", quantity: 1 })
    if (!up.ok || !down.ok) throw new Error("expected both to plan")
    expect(up.delta).toBe(3)
    expect(down.delta).toBe(-3)
    // Absolute targets are idempotent, which is what makes a double-clicked button safe.
    expect(up.quantity).toBe(4)
  })
})

describe("no subscription, no add-on", () => {
  it("refuses before a plan exists", () => {
    const r = planAddOnChange(
      { ...paid, hasSubscription: false },
      { kind: "location", quantity: 1 },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("no_subscription")
  })

  it("refuses when the cadence cannot be read off the base price", () => {
    const r = planAddOnChange({ ...paid, cadence: null }, { kind: "location", quantity: 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("cadence_unknown")
  })
})

describe("prices come from the source of truth, per plan and per cadence", () => {
  it("uses the location add-on rate for the org's OWN tier", () => {
    const starter = planAddOnChange({ ...paid, tier: "entry" }, { kind: "location", quantity: 1 })
    const standard = planAddOnChange({ ...paid, tier: "mid" }, { kind: "location", quantity: 1 })
    if (!starter.ok || !standard.ok) throw new Error("expected both to plan")
    expect(starter.unitMonthly).toBe(addOnLocationPrice("entry").monthly)
    expect(standard.unitMonthly).toBe(addOnLocationPrice("mid").monthly)
    // The per-plan split is the whole point: a single flat rate created an arbitrage against
    // Starter's base. These must not be equal.
    expect(starter.unitMonthly).not.toBe(standard.unitMonthly)
  })

  it("uses the flat competitor rate regardless of tier", () => {
    for (const tier of ["entry", "mid"] as const) {
      const r = planAddOnChange({ ...paid, tier }, { kind: "competitor", quantity: 1, locationId: "l" })
      if (!r.ok) throw new Error("expected a plan")
      expect(r.unitMonthly).toBe(ADD_ON_PRICING.competitor.monthly)
    }
  })

  it("carries the subscription's cadence, so an annual plan cannot get a monthly add-on", () => {
    const annual = planAddOnChange({ ...paid, cadence: "annual" }, { kind: "location", quantity: 1 })
    if (!annual.ok) throw new Error("expected a plan")
    expect(annual.cadence).toBe("annual")
  })
})

describe("what the customer is told before confirming", () => {
  it("quotes the monthly-equivalent on annual and says it bills yearly", () => {
    const r = planAddOnChange({ ...paid, cadence: "annual" }, { kind: "location", quantity: 2 })
    if (!r.ok) throw new Error("expected a plan")
    const s = addOnRecurringSummary(r)
    expect(s.unit).toBe(addOnLocationPrice("mid").annualEffectiveMonthly)
    expect(s.total).toBe(s.unit * 2)
    // No surprises at renewal: the period has to be stated, not implied.
    expect(s.perLabel).toBe("/month, billed yearly")
  })

  it("quotes the monthly rate on monthly", () => {
    const r = planAddOnChange(paid, { kind: "location", quantity: 3 })
    if (!r.ok) throw new Error("expected a plan")
    const s = addOnRecurringSummary(r)
    expect(s.unit).toBe(addOnLocationPrice("mid").monthly)
    expect(s.total).toBe(s.unit * 3)
    expect(s.perLabel).toBe("/month")
  })

  it("every refusal message is plain, actionable, and names no vendor", () => {
    const refusals = [
      planAddOnChange({ ...paid, trialing: true }, { kind: "location", quantity: 1 }),
      planAddOnChange({ ...paid, tier: "top" }, { kind: "location", quantity: 1 }),
      planAddOnChange(paid, { kind: "competitor", quantity: 1 }),
      planAddOnChange(paid, { kind: "location", quantity: -1 }),
      planAddOnChange({ ...paid, hasSubscription: false }, { kind: "location", quantity: 1 }),
    ]
    for (const r of refusals) {
      if (r.ok) throw new Error("expected a refusal")
      expect(r.message.length, r.reason).toBeGreaterThan(10)
      expect(r.message, r.reason).not.toMatch(/[—–]/)
      expect(r.message, r.reason).not.toMatch(/stripe|dataforseo|supabase/i)
      expect(r.message, r.reason).not.toMatch(/\btier\b/i) // internal word, not customer language
    }
  })
})

// ── The route itself, by source scan ─────────────────────────────────────────────────────────
//
// The API route cannot be unit-tested here (vitest mocks no Stripe and collects no route handlers),
// so these pin the properties that would cost real money to get wrong. Same approach as the
// ALT-755 guard, which caught a $650/mo item-ordering bug.

describe("the add-on route respects the Stripe traps this repo has already hit", () => {
  const REPO_ROOT = resolve(__dirname, "..", "..", "..")
  const src = () => readFileSync(join(REPO_ROOT, "app/api/stripe/addons/route.ts"), "utf8")

  it("finds the base item by asking which price is NOT an add-on, never data[0]", () => {
    // ALT-755: a subscription carries a base item plus up to two add-on items and Stripe promises
    // no order. Taking data[0] repriced an add-on at the base rate, a $650/mo error.
    const s = src()
    expect(s).toMatch(/resolveAddOnPriceInfo\(priceId\) == null/)
    expect(s).not.toMatch(/items\.data\[0\]/)
  })

  it("never touches the billing portal configuration", () => {
    // Add-on prices in the portal's allow-list would let an add-on REPLACE the base plan. The setup
    // script has tried this once already.
    //
    // Matches CALLS, not words: the first version of this test matched the bare phrase and flagged
    // the route's own comment explaining the rule. Same trap the dash guard was built to avoid.
    const s = src()
    expect(s).not.toMatch(/stripe\.billingPortal/)
    expect(s).not.toMatch(/subscription_update\s*:/)
  })

  it("reads trial state from Stripe, not from our mirrored column", () => {
    // payment_state is a mirror and can lag. Stripe's status is billing truth, and a trial that
    // reads as paid would let a trialing customer buy an add-on, which Bryan ruled out.
    expect(src()).toMatch(/sub\?\.status === "trialing"/)
  })

  it("takes the cadence off the BASE price so an add-on cannot bill on a different interval", () => {
    expect(src()).toMatch(/resolvePriceInfo\(basePriceId\)\?\.cadence/)
  })

  it("allocates competitor slots only AFTER the charge succeeds", () => {
    // Ordering matters: allocating first could leave slots granted that were never paid for if the
    // charge failed. The reverse ordering can only under-deliver, which is loud and fixable.
    const s = src()
    // Anchored on the CALL, not the bare name: the first version matched the import statement at
    // the top of the file, so an adversarial probe that deleted the call still passed.
    const applyIdx = s.indexOf("await applySubscriptionToOrg(")
    const allocIdx = s.indexOf("competitors_purchased: perLocation")
    expect(applyIdx, "applySubscriptionToOrg not found").toBeGreaterThan(0)
    expect(allocIdx, "allocation write not found").toBeGreaterThan(0)
    expect(allocIdx).toBeGreaterThan(applyIdx)
  })

  it("tells the customer and logs loudly if allocation fails after a successful charge", () => {
    // The one ordering that can bill for something undelivered. It must never be silent.
    const s = src()
    expect(s).toMatch(/ALLOCATION FAILED AFTER CHARGE/)
    expect(s).toMatch(/SUPPORT_EMAIL/)
  })

  it("blocks impersonated sessions from moving money", () => {
    expect(src()).toMatch(/impersonationReadOnlyBlock/)
  })

  it("requires owner or admin", () => {
    expect(src()).toMatch(/requireOrgOwnerOrAdmin/)
  })

  it("a preview failure does not block the purchase", () => {
    // The preview is a nicety; the recurring figure is computed locally and tested. A Stripe hiccup
    // in the preview must not become a customer unable to buy.
    const s = src()
    expect(s).toMatch(/catch \(err\)[\s\S]{0,400}preview unavailable/)
  })
})

// ── The UI's two ticket rules, by source scan ────────────────────────────────────────────────
//
// The panel is a .tsx client component, which vitest does not collect, so these pin the two rules
// from ALT-689 that are about behaviour rather than looks.

describe("the add-on panel says what will be charged, and lets you remove (ALT-689)", () => {
  const REPO_ROOT = resolve(__dirname, "..", "..", "..")
  const ui = () =>
    readFileSync(join(REPO_ROOT, "app/(dashboard)/settings/billing/addon-controls-pass.tsx"), "utf8")
  const page = () =>
    readFileSync(join(REPO_ROOT, "app/(dashboard)/settings/billing/page.tsx"), "utf8")

  it("never writes on the first click: a change previews first", () => {
    const s = ui()
    // The confirm control cannot render without a preview in hand.
    expect(s).toMatch(/if \(pending !== kind \|\| !preview\) return null/)
    // And a preview request is actually made.
    expect(s).toMatch(/preview: previewOnly/)
    expect(s).toMatch(/, true\)/)
  })

  it("shows Stripe's own prorated figure when it has one, and says so when it does not", () => {
    const s = ui()
    expect(s).toMatch(/prorationDueNowCents/)
    expect(s).toMatch(/due now/)
    expect(s).toMatch(/credited/) // a reduction is a credit, and must be stated as one
    expect(s).toMatch(/prorated for the rest of/)
  })

  it("removing uses the same control as adding, not a separate path", () => {
    const s = ui()
    // One stepper, both directions. A decrement is not a link to support.
    expect(s).toMatch(/setValue\(Math\.max\(0, value - 1\)\)/)
    expect(s).toMatch(/setValue\(value \+ 1\)/)
    expect(s).toMatch(/Confirm removal/)
  })

  it("states the billing period rather than implying a monthly debit on an annual plan", () => {
    // "No surprises at renewal" from the ticket.
    expect(ui()).toMatch(/billed yearly/)
  })

  it("explains itself to a trialing customer instead of showing controls that refuse", () => {
    const s = ui()
    expect(s).toMatch(/if \(trialing\)/)
    expect(s).toMatch(/available once your plan starts/i)
  })

  it("the panel is only mounted for an org that can actually be charged", () => {
    // canManageInApp is active-or-trialing and not suspended. Mounting it for a canceled org would
    // offer a purchase that the route then refuses.
    const s = page()
    const mountIdx = s.indexOf("<AddOnControlsPass")
    expect(mountIdx, "AddOnControlsPass is not mounted").toBeGreaterThan(0)
    // The nearest guard above the mount must be canManageInApp.
    const before = s.slice(Math.max(0, mountIdx - 500), mountIdx)
    expect(before, "the panel is mounted without the canManageInApp guard").toContain(
      "canManageInApp &&",
    )
  })

  it("passes each location its OWN allocated slots, not the org total", () => {
    const s = page()
    expect(s).toMatch(/competitorsPurchased: Math\.max\(0, l\.competitors_purchased/)
    expect(s).toMatch(/competitorsBilled=\{Math\.max\(0, organization\?\.competitors_purchased/)
  })
})
