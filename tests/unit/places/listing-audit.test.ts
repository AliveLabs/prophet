import { describe, it, expect } from "vitest"
import { buildListingAudit, buildShelf, isOwnerPhoto, pickCoverPhoto, pickCoverPhotoWithFocal, pickInsightPhoto, type PhotoRow } from "@/lib/places/listing-audit"
import { normalizeFocal, type PhotoCategory } from "@/lib/providers/photos"

const BIZ = "Testaurant Grill"

// Minimal PhotoRow builder. `owner` → attributed to the business (owner upload);
// `customer` → attributed to a reviewer; neither → no attribution.
function row(
  category: PhotoCategory,
  opts: {
    lighting?: "professional" | "amateur" | "unknown"
    owner?: boolean
    customer?: boolean
    confidence?: number
    url?: string
  } = {},
): PhotoRow {
  const displayName = opts.owner ? BIZ : opts.customer ? "A. Reviewer" : null
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
    author_attribution: displayName ? [{ displayName }] : [],
    ...(opts.url ? { image_url: opts.url } : {}),
  }
}

describe("normalizeFocal", () => {
  it("clamps to [0,1] and defaults missing/garbage to center", () => {
    expect(normalizeFocal({ x: 0.2, y: 0.9 })).toEqual({ x: 0.2, y: 0.9 })
    expect(normalizeFocal({ x: -1, y: 2 })).toEqual({ x: 0, y: 1 })
    expect(normalizeFocal(undefined)).toEqual({ x: 0.5, y: 0.5 })
    expect(normalizeFocal({ x: "nope", y: null })).toEqual({ x: 0.5, y: 0.5 })
  })
})

describe("pickCoverPhotoWithFocal", () => {
  it("returns the chosen photo's focal — center when it was analyzed before focal existed", () => {
    expect(pickCoverPhotoWithFocal([row("food_dish", { url: "f.jpg" })])).toEqual({ url: "f.jpg", focal: { x: 0.5, y: 0.5 } })
  })
  it("carries a stored focal point through", () => {
    const r: PhotoRow = {
      image_url: "g.jpg",
      analysis_result: {
        category: "food_dish", subcategory: "", tags: [], extracted_text: "",
        promotional_content: false, promotional_details: "",
        quality_signals: { lighting: "professional", staging: "styled" },
        confidence: 0.9, notable_changes: "", focal_point: { x: 0.7, y: 0.2 },
      },
    }
    expect(pickCoverPhotoWithFocal([r])).toEqual({ url: "g.jpg", focal: { x: 0.7, y: 0.2 } })
  })
})

describe("pickInsightPhoto — category-aware pick", () => {
  it("prefers the earliest matching category in the prefer list, not the generic cover priority", () => {
    const rows = [row("food_dish", { url: "food.jpg" }), row("interior", { url: "int.jpg" })]
    // interior first → interior, even though food_dish outranks it for a generic cover
    expect(pickInsightPhoto(rows, ["interior", "food_dish"])).toBe("int.jpg")
    // food first → food; same rows, different prefer order → different photo (the variety guarantee)
    expect(pickInsightPhoto(rows, ["food_dish", "interior"])).toBe("food.jpg")
  })

  it("falls back to the best overall cover when no preferred category is present", () => {
    expect(pickInsightPhoto([row("staff_team", { url: "staff.jpg" })], ["food_dish", "menu_board"])).toBe("staff.jpg")
  })

  it("returns null when there are no usable (url'd) photos", () => {
    expect(pickInsightPhoto([], ["food_dish"])).toBeNull()
    expect(pickInsightPhoto([row("food_dish")], ["food_dish"])).toBeNull()
  })
})

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

describe("isOwnerPhoto", () => {
  it("is true only when attribution matches the business name", () => {
    expect(isOwnerPhoto([{ displayName: BIZ }], BIZ)).toBe(true)
    expect(isOwnerPhoto([{ displayName: "Jane D" }], BIZ)).toBe(false)
    expect(isOwnerPhoto([], BIZ)).toBe(false)
    expect(isOwnerPhoto([{ displayName: BIZ }], undefined)).toBe(false) // no ownerName → can't tell
  })
  it("matches case- and punctuation-insensitively", () => {
    expect(isOwnerPhoto([{ displayName: BIZ }], "  testaurant   grill!! ")).toBe(true)
  })
})

describe("buildListingAudit — owner/customer split (owner = business-attributed)", () => {
  it("counts owner (business) vs customer (reviewer)", () => {
    const a = buildListingAudit(
      [row("exterior", { owner: true }), row("interior", { customer: true }), row("food_dish", { customer: true })],
      { ownerName: BIZ },
    )
    expect(a.ownerCount).toBe(1)
    expect(a.customerCount).toBe(2)
  })

  it("without an ownerName, nothing is owner → the split self-suppresses", () => {
    const a = buildListingAudit([row("exterior", { owner: true }), row("interior", { customer: true })])
    expect(a.ownerCount).toBe(0)
    expect(a.showSplit).toBe(false)
  })

  it("showSplit needs volume AND a genuine mix", () => {
    // 6 photos but all customer-attributed → no owner → suppressed (the real prod case)
    const allCustomer = buildListingAudit(Array.from({ length: 6 }, () => row("exterior", { customer: true })), { ownerName: BIZ })
    expect(allCustomer.showSplit).toBe(false)
    // 6 photos, a real owner/customer mix → fires
    const mixed = buildListingAudit(
      [row("exterior", { owner: true }), row("interior", { owner: true }), ...Array.from({ length: 4 }, () => row("food_dish", { customer: true }))],
      { ownerName: BIZ },
    )
    expect(mixed.showSplit).toBe(true)
    expect(mixed.ownerCount).toBe(2)
    expect(mixed.customerCount).toBe(4)
  })

  it("segments the gallery by owner vs customer (only rows with an image_url)", () => {
    const a = buildListingAudit(
      [row("exterior", { owner: true, url: "o1" }), row("interior", { customer: true, url: "c1" }), row("food_dish", { customer: true })],
      { ownerName: BIZ },
    )
    expect(a.ownerPhotos.map((p) => p.url)).toEqual(["o1"])
    expect(a.customerPhotos.map((p) => p.url)).toEqual(["c1"]) // the url-less customer row is still counted, just not rendered
  })
})

describe("pickCoverPhoto (ALT-152 — own-listing image fallback)", () => {
  it("returns null with no photos or none with an image_url", () => {
    expect(pickCoverPhoto([])).toBeNull()
    expect(pickCoverPhoto([row("exterior")])).toBeNull() // no url on this row
  })

  it("prefers a professional, high-priority-slot shot over an amateur one", () => {
    const url = pickCoverPhoto([
      row("staff_team", { lighting: "amateur", url: "amateur-staff" }),
      row("food_dish", { lighting: "professional", url: "pro-dish" }),
    ])
    expect(url).toBe("pro-dish")
  })

  it("falls back to any photo with a url when nothing scores above zero", () => {
    const url = pickCoverPhoto([row("other", { url: "only-option" })])
    expect(url).toBe("only-option")
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
