import { describe, it, expect } from "vitest"
import { buildListingAudit, buildShelf, type PhotoRow } from "@/lib/places/listing-audit"
import type { PhotoCategory } from "@/lib/providers/photos"

// Minimal PhotoRow builder — only the fields the audit reads.
function row(
  category: PhotoCategory,
  opts: { lighting?: "professional" | "amateur" | "unknown"; customer?: boolean; confidence?: number } = {},
): PhotoRow {
  return {
    analysis_result: {
      category,
      subcategory: "",
      tags: [],
      extracted_text: "",
      promotional_content: false,
      promotional_details: "",
      quality_signals: { lighting: opts.lighting ?? "professional", staging: "styled" },
      confidence: opts.confidence ?? 0.8,
      notable_changes: "",
    },
    author_attribution: opts.customer ? [{ displayName: "A. Reviewer" }] : [],
  }
}

describe("buildListingAudit — coverage states", () => {
  it("marks slots covered (≥2) / thin (1) / missing (0)", () => {
    const a = buildListingAudit([row("exterior"), row("exterior"), row("signage"), row("food_dish"), row("food_dish")])
    const byLabel = Object.fromEntries(a.essentials.map((e) => [e.slot, e.state]))
    expect(byLabel.exterior).toBe("covered")
    expect(byLabel.signage).toBe("thin")
    expect(byLabel.food_dish).toBe("covered")
    expect(byLabel.menu_board).toBe("missing")
    expect(byLabel.interior).toBe("missing")
  })

  it("only treats bar/patio as essentials when the place has them", () => {
    const without = buildListingAudit([row("exterior"), row("interior")])
    expect(without.essentials.some((e) => e.slot === "patio_outdoor")).toBe(false)
    const withPatio = buildListingAudit([row("exterior"), row("patio_outdoor")])
    expect(withPatio.essentials.some((e) => e.slot === "patio_outdoor")).toBe(true)
  })

  it("drops below-confidence reads from the aggregate", () => {
    const a = buildListingAudit([row("menu_board", { confidence: 0.2 }), row("menu_board", { confidence: 0.2 })])
    const menu = a.essentials.find((e) => e.slot === "menu_board")
    expect(menu?.state).toBe("missing") // both reads ignored
  })

  it("ranks fix-next: missing essentials before thin ones, capped at 3", () => {
    const a = buildListingAudit([row("exterior"), row("signage")]) // exterior+signage thin, others missing
    expect(a.fixNext.length).toBeLessThanOrEqual(3)
    expect(a.fixNext[0].toLowerCase()).toMatch(/^add an? /) // an "add a/an …" missing-essential instruction leads
    expect(a.fixNext.some((f) => f.toLowerCase().includes("menu board"))).toBe(true)
    expect(a.fixNext.some((f) => f.toLowerCase().includes("an interior"))).toBe(true) // a/an grammar
  })
})

describe("buildListingAudit — owner/customer split", () => {
  it("counts customer (attributed) vs owner (unattributed) photos", () => {
    const a = buildListingAudit([row("exterior"), row("interior", { customer: true }), row("food_dish", { customer: true })])
    expect(a.customerCount).toBe(2)
    expect(a.ownerCount).toBe(1)
  })

  it("only flags showSplit with enough volume", () => {
    const few = buildListingAudit([row("exterior", { customer: true }), row("interior")])
    expect(few.showSplit).toBe(false)
    const many = buildListingAudit(Array.from({ length: 6 }, (_, i) => row("exterior", { customer: i % 2 === 0 })))
    expect(many.showSplit).toBe(true)
  })
})

describe("buildShelf — honest head-to-head bars", () => {
  const ownStrong = [row("exterior"), row("signage"), row("interior"), row("menu_board"), row("food_dish"), row("staff_team")]

  it("returns null without own photos or without competitors", () => {
    expect(buildShelf([], [{ id: "c", name: "C", rows: [row("exterior")] }])).toBeNull()
    expect(buildShelf(ownStrong, [])).toBeNull()
  })

  it("bar width grows with the margin (the mkRow regression guard)", () => {
    // own covers 6/6 essentials; weak competitor covers 1/6 → big margin → wide bar.
    const big = buildShelf(ownStrong, [{ id: "c", name: "Weak", rows: [row("exterior")] }])!
    // own covers 6/6; strong competitor covers 5/6 → small margin → narrower bar.
    const small = buildShelf(ownStrong, [{ id: "c", name: "Strong", rows: [row("exterior"), row("signage"), row("interior"), row("menu_board"), row("food_dish")] }])!
    const bigCov = big.rows.find((r) => r.metric === "Coverage")!
    const smallCov = small.rows.find((r) => r.metric === "Coverage")!
    expect(bigCov.width).toBeGreaterThan(smallCov.width) // margins must be distinguishable
    expect(bigCov.width).toBeLessThanOrEqual(100)
    expect(smallCov.width).toBeGreaterThanOrEqual(30) // house floor
  })

  it("picks the strongest competitor as the benchmark", () => {
    const shelf = buildShelf(ownStrong, [
      { id: "weak", name: "Weak", rows: [row("exterior")] },
      { id: "strong", name: "Strong", rows: [row("exterior"), row("signage"), row("interior"), row("menu_board")] },
    ])!
    expect(shelf.benchmarkName).toBe("Strong")
  })

  it("never produces a width above 100 or below the floor", () => {
    const shelf = buildShelf(ownStrong, [{ id: "c", name: "C", rows: [row("food_dish", { lighting: "amateur" })] }])!
    for (const r of shelf.rows) {
      expect(r.width).toBeGreaterThanOrEqual(30)
      expect(r.width).toBeLessThanOrEqual(100)
    }
  })
})
