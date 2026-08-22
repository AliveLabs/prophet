import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const ROOT = resolve(__dirname, "..", "..", "..")
const setup = () => readFileSync(join(ROOT, "scripts/stripe/setup.ts"), "utf8")

// ── ALT-753 ─────────────────────────────────────────────────────────────────────────────────
//
// The portal's subscription_update.products allow-list is the set of plans a customer may switch
// their subscription TO. An add-on is a quantity on a line item, not a plan. Listing add-on prices
// there let a customer replace a $299 Standard base plan with an $18 "Additional competitor" price
// from inside the Stripe portal, and a full run of the setup script was all it took to arm it.
//
// Source-scanned because this is a script that talks to live Stripe: there is nothing to unit-test
// without performing the write we are trying to prevent.

describe("add-on prices never reach the portal plan-switch allow-list", () => {
  it("the add-on loop does not push into the array the portal config receives", () => {
    const s = setup()
    // The portal receives ticketPriceIds / neatPriceIds.
    expect(s).toMatch(/upsertPortalConfig\(stripe, "ticket", ticketPriceIds\)/)
    // The add-on loop must collect somewhere else.
    expect(s).toMatch(/addOnPriceIds\.push\(price\.id\)/)
    // And must NOT feed the portal array. Scoped to the add-on section so the BASE loop, which
    // legitimately pushes into ticketPriceIds, does not trip this.
    const addOnSection = s.slice(s.indexOf("Step 3: Add-on products"), s.indexOf("Step 4: Portal"))
    expect(addOnSection).not.toMatch(/ticketPriceIds\.push/)
    expect(addOnSection).not.toMatch(/neatPriceIds\.push/)
  })

  it("the BASE plan loop still populates the allow-list, so the portal is not left empty", () => {
    // The fix must not overshoot: a customer still needs to switch between real plans.
    const baseSection = setup().slice(0, setup().indexOf("Step 3: Add-on products"))
    expect(baseSection).toMatch(/ticketPriceIds\.push\(price\.id\)/)
    expect(baseSection).toMatch(/neatPriceIds\.push\(price\.id\)/)
  })

  it("the run says what it excluded, rather than excluding it silently", () => {
    expect(setup()).toMatch(/excluding \$\{addOnPriceIds\.length\} add-on price/)
  })
})
