import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const REPO_ROOT = resolve(__dirname, "..", "..", "..")

// ── ALT-750 ─────────────────────────────────────────────────────────────────────────────────
// Two separate facts, and only the first is a code defect.
//
// 1. `listing_daily` is never written. Verified in prod 2026-08-21: `snapshots` holds six types
//    (five seo_*_weekly plus web_menu_weekly), none of them this one, and ZERO rows carry a
//    `profile` key. So the head of market-benchmark's `[snapshotProfile, placeDetails, metadata]`
//    chain has always been empty and every rating comes from the fallbacks.
//
// 2. THE REAL PROBLEM: `competitors.metadata.rating` is written once at DISCOVERY and never
//    refreshed. Of 50 competitors in prod, ZERO have `updated_at` more than a day past
//    `created_at`, and the oldest was added 2026-06-09. Every competitor rating an operator sees is
//    frozen by up to 73 days.
//
// Fixing (2) means a paid Places call per competitor per period, so the cadence is a spend decision
// and stays with Bryan. What this test protects is that the CHAIN still has working fallbacks, so
// the dead head cannot become a silent total failure if someone "tidies" it.

describe("competitor rating resolution has working fallbacks (ALT-750)", () => {
  const src = readFileSync(join(REPO_ROOT, "lib/insights/market-benchmark.ts"), "utf8")

  it("reads more than one source, in order", () => {
    expect(src).toMatch(/\[sources\.snapshotProfile, sources\.placeDetails, sources\.metadata\]/)
  })

  it("keeps looking until it finds a rating rather than trusting the first bag", () => {
    // If this became `pick(sources.snapshotProfile, "rating")` alone, every competitor rating in
    // the product would silently become null, because that bag is always empty.
    expect(src).toMatch(/for \(const bag of order\)/)
    expect(src).toMatch(/if \(rating === null\) rating = pick\(bag, "rating"\)/)
  })

  it("the dead snapshot type is documented as never written, not silently relied on", () => {
    const pulse = readFileSync(join(REPO_ROOT, "lib/insights/market-pulse.ts"), "utf8")
    expect(pulse).toMatch(/IS NEVER WRITTEN/)
    expect(pulse).toMatch(/never refreshed/)
  })
})
