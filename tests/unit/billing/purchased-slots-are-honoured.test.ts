import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { resolveCompetitorAllowance } from "@/lib/billing/limits"

const REPO_ROOT = resolve(__dirname, "..", "..", "..")
const read = (p: string) => readFileSync(join(REPO_ROOT, p), "utf8")

// ── ALT-731 / ALT-755 / ALT-716 ─────────────────────────────────────────────────────────────
// Three billing defects that are LATENT only because add-on purchasing does not exist yet. Each
// becomes live on the first add-on sale, which is the wrong moment to discover them.

describe("resolveCompetitorAllowance is the only competitor cap (ALT-731)", () => {
  it("counts included plus purchased", () => {
    expect(resolveCompetitorAllowance({ subscription_tier: "mid", competitors_purchased: 3 }).total).toBe(8)
    expect(resolveCompetitorAllowance({ subscription_tier: "mid" }).total).toBe(5)
  })

  it("never widens a cap on junk input", () => {
    for (const v of [-5, Number.NaN, null, undefined]) {
      expect(
        resolveCompetitorAllowance({ subscription_tier: "mid", competitors_purchased: v as number }).total,
      ).toBe(5)
    }
  })

  it("the dossier resolves its cap through it, not off TIER_CAPS", () => {
    // TIER_CAPS.maxCompetitors is a hardcoded 3/5/10 with NO purchased field, and the dossier
    // slices to it. So a customer who BOUGHT slots was billed, shown them, and had them truncated
    // out of the brief every night.
    const src = read("lib/insights/dossier/build.ts")
    expect(src).toMatch(/resolveCompetitorAllowance\(/)
    expect(src).toMatch(/competitors_purchased/)
    expect(src).toMatch(/maxCompetitors: competitorAllowance\.total/)
  })
})

describe("change-plan reprices the BASE item (ALT-755)", () => {
  const src = () => read("app/api/stripe/change-plan/route.ts")

  it("finds the base item instead of assuming items.data[0]", () => {
    // A subscription carries a base item plus up to two add-ons and Stripe promises no order, so
    // items.data[0] could be an add-on. At the add-on rates that is a $650/mo error.
    expect(src()).toMatch(/const baseItem = current\.items\.data\.find\(/)
    expect(src()).not.toMatch(/const currentItemId = current\.items\.data\[0\]\?\.id/)
  })

  it("uses the add-on resolver as the discriminator rather than a new mapping", () => {
    expect(src()).toMatch(/resolveAddOnPriceInfo\(/)
  })
})

describe("a trial reminder that did not send is retried (ALT-716)", () => {
  const src = () => read("app/api/cron/trial-reminders/route.ts")

  it("releases the ledger claim when nothing reached a recipient", () => {
    // The ledger row is written BEFORE the send so a 23505 is the same-day dedupe. A failed send
    // used to leave the row, so the reminder was recorded as sent and never retried. Day 13 is the
    // last warning before a card is charged.
    expect(src()).toMatch(/anySentForOrg/)
    expect(src()).toMatch(/if \(!anySentForOrg\)/)
  })

  it("only releases when NO recipient was reached, so a partial success is not re-mailed", () => {
    // An org can have several owner/admins. Releasing after a partial success would re-mail the
    // person who already got it.
    expect(src()).toMatch(/anySentForOrg = true/)
  })
})

describe("the generated database types match production", () => {
  it("carries the purchased-quantity columns", () => {
    // These exist in prod and were MISSING from the generated types, so any strictly-typed client
    // selecting them failed to compile while loosely-typed callers got no checking at all.
    const types = read("types/database.types.ts")
    expect(types).toMatch(/competitors_purchased/)
    expect(types).toMatch(/locations_purchased/)
  })

  it("carries review_watch_events, applied to prod in prophet#270", () => {
    expect(read("types/database.types.ts")).toMatch(/review_watch_events/)
  })
})
