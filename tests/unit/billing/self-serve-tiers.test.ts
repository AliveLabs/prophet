import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  ANNUAL_DISCOUNT_PCT,
  ANNUAL_MONTHS_FREE,
  ANNUAL_SAVINGS_INLINE,
  ANNUAL_SAVINGS_LABEL,
  PAID_TIERS,
  SELF_SERVE_TIERS,
  TIER_LIMITS,
  TIER_PRICING,
  isPaidTier,
  isSelfServeTier,
  type SubscriptionTier,
} from "@/lib/billing/tiers"
import { SELF_SERVE_ADDON_TIERS } from "@/lib/stripe/pricing"
import { tierFeatureList } from "@/lib/billing/limits"

// ── ALT-735 / ALT-732 / ALT-733 / ALT-736 ───────────────────────────────────────────────────
//
// One live Critical and three Highs, all on the buying surfaces, all the same shape: a screen or
// an endpoint answered the WRONG QUESTION about a tier.
//
// The Critical: the held-account panel iterated PAID_TIERS instead of SELF_SERVE_TIERS, so it
// offered contract-only Multi-Location as a one-click upgrade. Multi-Location is priced PER
// LOCATION, so its list rate is BELOW Standard's while its entitlement is strictly above:
//
//     Multi-Location  $2,750/yr  ($275/mo)   10 competitors, biweekly SEO, 365d retention
//     Standard        $2,990/yr  ($299/mo)    5 competitors, weekly SEO,    90d retention
//
// Verified in LIVE Stripe on 2026-08-21: both Multi-Location prices exist and are active, so the
// purchase completed. /api/stripe/checkout and /api/stripe/change-plan both validated with
// PAID_TIERS too, so the tier was accepted at the endpoint as well as offered on the tile.
//
// The tests below are written so that the PRICING relationship is guarded, not just the current
// contents of a list. Removing `top` from a tile fixes today; it does not stop someone deciding to
// self-serve Multi-Location next quarter and reintroducing the same inversion.

/** The dimensions we actually SELL, and how to compare them. Ordinals ascend with entitlement. */
const SOLD_DIMENSIONS: ReadonlyArray<(t: SubscriptionTier) => number> = [
  (t) => TIER_LIMITS[t].includedLocations,
  (t) => TIER_LIMITS[t].includedCompetitorsPerLocation,
  (t) => TIER_LIMITS[t].ownSocialNetworkLimit,
  (t) => (TIER_LIMITS[t].runCadence === "daily" ? 1 : 0),
  (t) => (TIER_LIMITS[t].seoCadence === "biweekly" ? 1 : 0),
  // ALT-734 removed photoAnalysisDepth, retentionDays and support from TIER_LIMITS: all three had
  // zero readers, so none of them was an entitlement anything enforced. Dropping them makes this
  // guard MORE honest, because it now compares only dimensions the product actually delivers.
]

/** True when `b` gives at least as much as `a` on every sold dimension, and more on one. */
function dominates(b: SubscriptionTier, a: SubscriptionTier): boolean {
  const atLeast = SOLD_DIMENSIONS.every((d) => d(b) >= d(a))
  const strictlyMore = SOLD_DIMENSIONS.some((d) => d(b) > d(a))
  return atLeast && strictlyMore
}

const REPO_ROOT = resolve(__dirname, "..", "..", "..")

/** Source with comment-only LINES removed. The fixes deliberately document the removed claims by
 *  name, so a scan that reads comments would flag its own explanation.
 *
 *  Line-based on purpose. The obvious version of this is
 *  `src.replace(/\/\*[\s\S]*?\*\//g, "")`, and that version is dangerous: on a real file in this
 *  repo it swallowed 40 lines of live code between an unrelated `/*` and a later `*​/`, so a scan
 *  built on it reported "no offenders" for a file whose offending code it had silently deleted.
 *  That was caught by reintroducing a defect and watching the guard NOT fire. A line-based filter
 *  can never remove a line that has code on it, which is the property that matters here. */
function code(file: string): string {
  const out: string[] = []
  let inBlock = false
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const t = line.trim()
    if (inBlock) {
      if (t.includes("*/")) inBlock = false
      continue
    }
    if (t.startsWith("//")) continue
    if (t.startsWith("*")) continue // continuation line of a /** */ block
    if (t.startsWith("/*")) {
      if (!t.includes("*/")) inBlock = true
      continue
    }
    out.push(line)
  }
  return out.join("\n")
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  const skip = new Set(["node_modules", ".next", ".git", "worktrees", "archive"])
  const walk = (p: string) => {
    const st = statSync(p)
    if (st.isFile()) {
      if (/\.(ts|tsx)$/.test(p)) out.push(p)
      return
    }
    for (const e of readdirSync(p)) {
      if (skip.has(e)) continue
      walk(join(p, e))
    }
  }
  walk(join(REPO_ROOT, dir))
  return out
}

describe("self-serve tier eligibility (ALT-735, ALT-732)", () => {
  it("Multi-Location is a real paid tier but is NOT self-serve", () => {
    expect(isPaidTier("top")).toBe(true)
    expect(isSelfServeTier("top")).toBe(false)
  })

  it("Starter and Standard are self-serve", () => {
    expect(isSelfServeTier("entry")).toBe(true)
    expect(isSelfServeTier("mid")).toBe(true)
  })

  it("rejects suspended and anything that is not a tier", () => {
    for (const v of ["suspended", "banana", "", "TOP", null, undefined, 0, {}]) {
      expect(isSelfServeTier(v)).toBe(false)
    }
  })

  it("every self-serve tier has a price to show", () => {
    for (const t of SELF_SERVE_TIERS) {
      expect(TIER_PRICING[t as "entry"]).toBeDefined()
    }
  })

  // THE GUARD THAT MATTERS. Not "is top in the list" but "can a buyer do better by picking a
  // different offered plan". A cheaper plan that dominates a pricier one is an arbitrage, and it
  // is what shipped.
  it("no offered plan is dominated by a cheaper offered plan", () => {
    const offered = SELF_SERVE_TIERS
    const violations: string[] = []
    for (const a of offered) {
      for (const b of offered) {
        if (a === b) continue
        if (!dominates(b, a)) continue
        for (const cadence of ["monthly", "annual"] as const) {
          const pa = TIER_PRICING[a as "entry"][cadence]
          const pb = TIER_PRICING[b as "entry"][cadence]
          if (pb <= pa) {
            violations.push(
              `${b} (${cadence} $${pb}) dominates ${a} (${cadence} $${pa}) but costs no more`,
            )
          }
        }
      }
    }
    expect(violations).toEqual([])
  })

  // The other half of the same invariant: a tier that would undercut an offered plan while
  // dominating it MUST NOT be offered. This is the assertion that fails if someone adds `top`
  // back to SELF_SERVE_TIERS without repricing it.
  it("any tier that dominates AND undercuts a self-serve tier is kept off the self-serve list", () => {
    for (const contender of PAID_TIERS) {
      for (const offered of SELF_SERVE_TIERS) {
        if (contender === offered) continue
        if (!dominates(contender, offered)) continue
        const undercutsSomewhere = (["monthly", "annual"] as const).some(
          (c) => TIER_PRICING[contender as "entry"][c] <= TIER_PRICING[offered as "entry"][c],
        )
        if (undercutsSomewhere) {
          expect(
            isSelfServeTier(contender),
            `${contender} dominates ${offered} and does not cost more, so it must not be ` +
              `self-serve. Either price it above ${offered} or keep it contract-only.`,
          ).toBe(false)
        }
      }
    }
  })

  it("the add-on tier list cannot drift from the self-serve tier list", () => {
    expect([...SELF_SERVE_ADDON_TIERS]).toEqual([...SELF_SERVE_TIERS])
  })

  // ALT-732 lived in the two endpoints that move money, not on a tile. Both had their own private
  // isPaidTier and used it as the purchase gate. Pin the gate itself.
  it("both money endpoints gate on isSelfServeTier, not isPaidTier", () => {
    for (const route of [
      "app/api/stripe/checkout/route.ts",
      "app/api/stripe/change-plan/route.ts",
    ]) {
      const src = readFileSync(join(REPO_ROOT, route), "utf8")
      expect(src, `${route} must reject non-self-serve tiers`).toContain("if (!isSelfServeTier(tier))")
      expect(src, `${route} must not define its own tier predicate`).not.toMatch(
        /function isPaidTier\(/,
      )
    }
  })
})

describe("annual discount is stated correctly (ALT-736)", () => {
  it("annual really is two months free", () => {
    expect(ANNUAL_MONTHS_FREE).toBe(2)
    expect(ANNUAL_DISCOUNT_PCT).toBe(16.7)
    for (const t of PAID_TIERS) {
      const p = TIER_PRICING[t as "entry"]
      expect(p.annual).toBe(p.monthly * 10)
    }
  })

  // The copy is spelled as a word for the buying surfaces; this pins the word to the number so
  // they cannot come apart if the annual construction ever changes.
  it("the label matches the number of free months", () => {
    expect(ANNUAL_SAVINGS_LABEL).toBe("Two months free")
    expect(ANNUAL_SAVINGS_INLINE).toBe("two months free")
  })

  it('no surface claims "save 20%" anywhere', () => {
    const offenders = ["app", "components", "lib"]
      .flatMap(sourceFiles)
      .filter((f) => /save 20\s?%/i.test(code(f)))
      .map((f) => f.slice(REPO_ROOT.length + 1))
    expect(offenders).toEqual([])
  })
})

describe("we do not advertise features we have not built (ALT-733)", () => {
  it("the tier feature list never mentions white-label or an API", () => {
    for (const t of PAID_TIERS) {
      const feats = tierFeatureList(t).join(" | ")
      expect(feats).not.toMatch(/white.?label/i)
      expect(feats).not.toMatch(/api access/i)
    }
  })

  it("TIER_LIMITS carries no unenforced entitlement flags", () => {
    for (const t of PAID_TIERS) {
      expect(TIER_LIMITS[t]).not.toHaveProperty("whiteLabelReports")
      expect(TIER_LIMITS[t]).not.toHaveProperty("apiAccess")
    }
  })

  // The defect reached three surfaces from one edit because the feature list existed as three
  // byte-identical private copies. This fails if a fourth copy appears.
  it("no component builds its own tier feature list", () => {
    const offenders = ["app", "components"]
      .flatMap(sourceFiles)
      .filter((f) => /function tierFeatures\s*\(/.test(code(f)))
      .map((f) => f.slice(REPO_ROOT.length + 1))
    expect(offenders).toEqual([])
  })

  it("no customer-facing surface claims white-label reports or API access", () => {
    const offenders = ["app", "components"]
      .flatMap(sourceFiles)
      .filter((f) => /"[^"]*white.?label[^"]*"|"[^"]*API access[^"]*"/i.test(code(f)))
      .map((f) => f.slice(REPO_ROOT.length + 1))
    expect(offenders).toEqual([])
  })
})
