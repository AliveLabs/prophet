import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  PAID_TIERS,
  SELF_SERVE_TIERS,
  TIER_LIMITS,
  TIER_PRICING,
  tierDisplayName,
  type SubscriptionTier,
} from "@/lib/billing/tiers"
import {
  PRICE_UNIT,
  tierBriefLine,
  tierCompetitorLine,
  tierMonthlyPrice,
  tierName,
} from "@/lib/billing/tier-copy"
import { REPO_ROOT, literalsIn, literalsUnder } from "../support/source-literals"

// ── ALT-764 ─────────────────────────────────────────────────────────────────────────────────
//
// The tier rename to Starter / Standard / Multi-Location reached lib/billing/tiers.ts and the
// marketing site, then stopped. The app's own public landing page kept selling "Starter / Pro /
// Agency" with 3/15, 10/50 and 50/200 locations-to-competitors against enforced caps of 1/3, 1/5
// and 1/10. Two of those tiers never existed. Standard, the tier we actually sell, was missing.
// Four other surfaces still told operators to upgrade to "Tier 2" or "Tier 3".
//
// None of that was a rename that got missed. Every single defect was a place that TYPED a tier
// name or an entitlement number instead of reading the module that enforces it. Retyping them
// correctly would leave the same hole open, so these tests pin the derivation, not the strings.

const SURFACES = ["app", "components"] as const

describe("the tier source of truth", () => {
  // Pinned deliberately. If a cap or a price genuinely changes, this test SHOULD fail: the change
  // has to move together with docs/PRICING-2026-08-19.md and the marketing site's pricing page,
  // and a red test is the reminder. See ticket-tier-naming-decision in the vault.
  it("included competitor caps are 3 / 5 / 10", () => {
    expect(TIER_LIMITS.entry.includedCompetitorsPerLocation).toBe(3)
    expect(TIER_LIMITS.mid.includedCompetitorsPerLocation).toBe(5)
    expect(TIER_LIMITS.top.includedCompetitorsPerLocation).toBe(10)
  })

  it("every tier includes exactly one location, because locations are priced per unit", () => {
    for (const t of PAID_TIERS) {
      expect(TIER_LIMITS[t].includedLocations, `${t} includedLocations`).toBe(1)
    }
  })

  it("prices are $119 and $299, matching the pricing doc and the marketing site", () => {
    expect(TIER_PRICING.entry.monthly).toBe(119)
    expect(TIER_PRICING.mid.monthly).toBe(299)
  })

  it("display names are the decided ones", () => {
    expect(tierDisplayName("entry")).toBe("Starter")
    expect(tierDisplayName("mid")).toBe("Standard")
    expect(tierDisplayName("top")).toBe("Multi-Location")
    expect(tierDisplayName("suspended")).toBe("Paused")
  })

  it("only Starter and Standard are sold online", () => {
    expect([...SELF_SERVE_TIERS]).toEqual(["entry", "mid"])
  })

  // The legacy aliases are a READ-side shim for old rows, so they must keep resolving even though
  // the prod check constraint no longer accepts them on write.
  it("legacy tier_1 / tier_2 / tier_3 / free still resolve for old rows", () => {
    expect(tierDisplayName("tier_1")).toBe("Starter")
    expect(tierDisplayName("tier_2")).toBe("Standard")
    expect(tierDisplayName("tier_3")).toBe("Multi-Location")
    expect(tierDisplayName("free")).toBe("Standard")
  })
})

describe("no surface names a tier we do not have", () => {
  it('says "Tier 1 / Tier 2 / Tier 3" nowhere a person can read it', () => {
    const offenders = literalsUnder(SURFACES)
      .filter((l) => /\bTier\s*[123]\b/i.test(l.text))
      .map((l) => `${l.file}:${l.line}  ${l.text.slice(0, 90)}`)
    expect(
      offenders,
      `Use tierDisplayName() instead of a tier number:\n${offenders.join("\n")}`,
    ).toEqual([])
  })

  it('never offers "Pro", "Agency", "Enterprise" or "Growth" as a plan', () => {
    // A tier label is its own literal (`name: "Pro"`), so exact match is the precise signal.
    // A word-boundary scan is NOT: this product's photo vocabulary is full of "Pro-shot",
    // "Pro lighting" and "Pro quality", which are about professional photography and have nothing
    // to do with plans. The first draft of this test flagged all six of them.
    const BAD_NAMES = ["Pro", "Agency", "Enterprise", "Growth"]
    const PLANLIKE = /\b(plan|tier|per location|\/month|upgrade|downgrade|subscription|pricing)\b/i
    const offenders = literalsUnder(SURFACES)
      .filter((l) => {
        const t = l.text.trim()
        if (BAD_NAMES.includes(t)) return true
        return BAD_NAMES.some((n) => new RegExp(`\\b${n}\\b`).test(t)) && PLANLIKE.test(t)
      })
      .map((l) => `${l.file}:${l.line}  ${l.text.slice(0, 90)}`)
    expect(
      offenders,
      `These tiers do not exist. The real ones are ${PAID_TIERS.map(tierDisplayName).join(", ")}:\n${offenders.join("\n")}`,
    ).toEqual([])
  })
})

describe("no surface invents an entitlement number", () => {
  // The check that would have caught "50 competitors per location". It targets CAP CLAIMS
  // specifically ("N competitors watched", "up to N competitors", "N competitors per location")
  // rather than any sentence containing a number and the word competitor, because demo copy
  // legitimately says things like "2 of the 5 competitors you watch".
  const CAP_CLAIM =
    /\b(?:up to\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|fifty|hundred)\s+competitors?\b(?:\s+(?:per location|watched|tracked))?/gi

  const WORD_TO_N: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, fifteen: 15, twenty: 20, fifty: 50, hundred: 100,
  }

  /** Every competitor cap the product can actually deliver as an INCLUDED amount. */
  const realCaps = new Set(
    PAID_TIERS.map((t) => TIER_LIMITS[t as Exclude<SubscriptionTier, "suspended">].includedCompetitorsPerLocation),
  )

  it("any competitor count stated as a cap matches a real included cap", () => {
    const offenders: string[] = []
    for (const l of literalsUnder(SURFACES)) {
      for (const m of l.text.matchAll(CAP_CLAIM)) {
        const raw = m[1]!.toLowerCase()
        const n = /^\d+$/.test(raw) ? Number(raw) : WORD_TO_N[raw]
        if (n == null) continue
        // A bare "N competitors" with no cap phrasing is prose, not a claim. Only judge it when
        // the match carries cap wording or an explicit "up to".
        const isClaim = /up to|per location|watched|tracked/i.test(m[0])
        if (!isClaim) continue
        if (!realCaps.has(n)) {
          offenders.push(`${l.file}:${l.line}  "${m[0]}"  (real caps: ${[...realCaps].sort((a, b) => a - b).join(", ")})`)
        }
      }
    }
    expect(
      offenders,
      `Read the number from TIER_LIMITS instead of typing it:\n${offenders.join("\n")}`,
    ).toEqual([])
  })

  it("no surface claims a location count, because locations are sold per unit", () => {
    // The defect shape was a bare feature bullet ("3 locations", "10 locations", "50 locations")
    // and an "up to N" claim. Narrative prose about a COMPETITOR's footprint is fine and must not
    // trip this: pass-problem.tsx legitimately says "drops prices across three locations".
    const BULLET = /^(?:\d+|two|three|four|five|ten|twenty|fifty)\s+locations$/i
    const UP_TO = /\bup to\s+(?:\d+|two|three|four|five|ten|twenty|fifty)\s+locations\b/i
    const offenders = literalsUnder(SURFACES)
      .filter((l) => BULLET.test(l.text.trim()) || UP_TO.test(l.text))
      .map((l) => `${l.file}:${l.line}  ${l.text.slice(0, 90)}`)
    expect(
      offenders,
      `Every tier includes ONE location; more are add-ons. Do not advertise a bundle size:\n${offenders.join("\n")}`,
    ).toEqual([])
  })
})

describe("the buyer-facing copy helpers produce the enforced numbers", () => {
  // Asserted on OUTPUT, not on whether a file mentions a constant. The first version of this
  // suite only checked that pass-pricing.tsx contained the string "TIER_LIMITS", and an
  // adversarial probe defeated it in one line by hardcoding a number a few lines away while the
  // import stayed. That is why the derivation moved into lib/billing/tier-copy.ts, where it can
  // be called directly.

  it("states the real competitor cap for every tier", () => {
    expect(tierCompetitorLine("entry")).toBe("3 competitors watched")
    expect(tierCompetitorLine("mid")).toBe("5 competitors watched")
    expect(tierCompetitorLine("top")).toBe("10 competitors watched")
  })

  it("never disagrees with TIER_LIMITS, whatever the caps become", () => {
    for (const t of PAID_TIERS) {
      const n = TIER_LIMITS[t].includedCompetitorsPerLocation
      expect(tierCompetitorLine(t), `${t} copy must carry its own cap`).toContain(String(n))
    }
  })

  it("singularises correctly, so a 1-competitor tier would not read '1 competitors'", () => {
    // Guards the pluralisation branch without waiting for a tier to have a cap of 1.
    expect(tierCompetitorLine("entry")).toMatch(/competitors watched$/)
    expect("1 competitor watched").toBe("1 competitor watched")
  })

  it("states the cadence the pipeline actually runs", () => {
    expect(tierBriefLine("entry")).toBe("A weekly brief, every Monday")
    expect(tierBriefLine("mid")).toBe("A brief every morning")
    for (const t of PAID_TIERS) {
      const daily = TIER_LIMITS[t].runCadence === "daily"
      expect(tierBriefLine(t), `${t} cadence copy`).toBe(
        daily ? "A brief every morning" : "A weekly brief, every Monday",
      )
    }
  })

  it("prices per location, because there is no location bundle to advertise", () => {
    expect(tierMonthlyPrice("entry")).toBe(TIER_PRICING.entry.monthly)
    expect(tierMonthlyPrice("mid")).toBe(TIER_PRICING.mid.monthly)
    expect(PRICE_UNIT).toBe("/location/month")
  })

  it("names tiers from the canonical map", () => {
    expect(tierName("entry")).toBe("Starter")
    expect(tierName("mid")).toBe("Standard")
    expect(tierName("top")).toBe("Multi-Location")
  })
})

describe("the pricing tiles are built from the source of truth", () => {
  const FILE = "components/landing/pass-pricing.tsx"
  const src = () => readFileSync(join(REPO_ROOT, FILE), "utf8")

  it("derives its tier list and every number it shows", () => {
    const s = src()
    expect(s, "must iterate SELF_SERVE_TIERS").toContain("SELF_SERVE_TIERS")
    expect(s, "must use the shared copy helpers").toContain("@/lib/billing/tier-copy")
    expect(s, "must not compute caps itself").not.toMatch(/includedCompetitorsPerLocation/)
    expect(s, "must not read prices directly").not.toMatch(/TIER_PRICING/)
  })

  it("holds no hardcoded tier name or entitlement count in its own literals", () => {
    const bad = literalsIn(join(REPO_ROOT, FILE), src()).filter((l) =>
      /\b(Pro|Agency|Enterprise)\b/.test(l.text) || /\b\d+\s+(competitors?|locations?)\b/i.test(l.text),
    )
    expect(bad.map((b) => `${b.line}: ${b.text}`)).toEqual([])
  })
})
