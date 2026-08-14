// Deterministic menu extraction, tested against REAL captured markdown.
//
// The fixtures in tests/fixtures/menu-markdown/ are verbatim Firecrawl markdown captured
// 2026-08-14 from the live sites. They are committed because the whole argument for this
// module is empirical: the markdown is byte-stable, the model over it was not. Measured
// item counts from three back-to-back runs per page:
//
//   page                        model            deterministic
//   sugarbacon.com/dinner-menu  60 / 60 / 60     60 / 60 / 60
//   sugarbacon.com/drink-menu   58 / 58 / 58     58 / 58 / 58
//   fogharbor.com/menu          69 / 80 / 79     200 / 200 / 200
//   bushschicken.com/menu        8 /  0 /  9       0 /   0 /   0
//
// bushschicken is the important zero: its menu is a JPEG and the page text contains no
// prices at all, yet the model returned "Fried Chicken Meal $8.99" on two of three runs.

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  parseMenuMarkdown,
  parseItemLine,
  priceSignalCount,
  classifyItemKind,
  MIN_PRICE_SIGNALS_FOR_MODEL,
} from "@/lib/content/menu-markdown"

const FIXTURES = join(process.cwd(), "tests/fixtures/menu-markdown")
const fixture = (name: string) => readFileSync(join(FIXTURES, `${name}.md`), "utf8")

describe("parseItemLine", () => {
  it("reads a heading item priced after a pipe", () => {
    const parsed = parseItemLine("Fried Green Tomatoes | 12")
    expect(parsed?.name).toBe("Fried Green Tomatoes")
    expect(parsed?.variants).toEqual([{ label: "Fried Green Tomatoes", price: "12", priceValue: 12 }])
  })

  it("splits labelled size variants into one item each", () => {
    const parsed = parseItemLine("Caesar Salad | Small 6 | Large 12")
    expect(parsed?.variants.map((v) => [v.label, v.priceValue])).toEqual([
      ["Caesar Salad (Small)", 6],
      ["Caesar Salad (Large)", 12],
    ])
  })

  it("carries a size label forward when the price comes first", () => {
    const parsed = parseItemLine("Filet   6 oz | 35   10 oz | 49")
    expect(parsed?.variants.map((v) => [v.label, v.priceValue])).toEqual([
      ["Filet 6 oz", 35],
      ["Filet 10 oz", 49],
    ])
  })

  it("prices a wine at the glass and keeps the bottle price out of the name", () => {
    const parsed = parseItemLine("Liberty School 14|50")
    expect(parsed?.name).toBe("Liberty School")
    expect(parsed?.variants).toEqual([{ label: null, price: "14", priceValue: 14 }])
  })

  it("keeps a size in the name when there is one price", () => {
    const parsed = parseItemLine("Ribeye 14 oz | 54")
    expect(parsed?.variants.map((v) => [v.label, v.priceValue])).toEqual([["Ribeye 14 oz", 54]])
  })

  it("reads a market-price item as a name with no price", () => {
    const parsed = parseItemLine("Tomahawk 40 oz | Mrkt")
    expect(parsed?.name).toBe("Tomahawk 40 oz")
    expect(parsed?.variants).toEqual([])
  })

  it("reads a currency-marked price on an unpiped line", () => {
    const parsed = parseItemLine("Crab Cakes $20")
    expect(parsed?.name).toBe("Crab Cakes")
    expect(parsed?.variants[0].priceValue).toBe(20)
  })

  it("splits two currency-marked prices on one line into portions", () => {
    const parsed = parseItemLine("Kumamoto Oysters ½ dozen $29 dozen $54")
    expect(parsed?.variants.map((v) => [v.label, v.priceValue])).toEqual([
      ["Kumamoto Oysters (½ dozen)", 29],
      ["Kumamoto Oysters (dozen)", 54],
    ])
  })

  it("is not fooled by prose or a bare number in running text", () => {
    expect(parseItemLine("Voted Best Chicken for Two Decades")).toBeNull()
    expect(parseItemLine("Served with garlic mashed potatoes and 2 sauces")).toBeNull()
  })

  it("refuses out-of-range numbers so a year is never a price", () => {
    expect(parseItemLine("Copyright 2026")?.variants ?? []).toEqual([])
  })
})

describe("parseMenuMarkdown against real captured pages", () => {
  it("reads Sugarbacon's dinner menu whole, matching the model's best run exactly", () => {
    const parsed = parseMenuMarkdown(fixture("sugarbacon-dinner-menu"))
    expect(parsed.credible).toBe(true)
    expect(parsed.itemsTotal).toBe(60)
    expect(parsed.categoriesTotal).toBe(6)
    expect(parsed.menu?.categories.map((c) => c.name)).toEqual([
      "STARTERS",
      "Handhelds",
      "SIDES",
      "Entrées",
      "SALADS",
      "Steaks",
    ])
  })

  it("keeps Sugarbacon's category names verbatim, which the model churned run to run", () => {
    // Three live model runs of the SAME page named the first drink section "Specialty
    // Cocktails", then "Red Wine" / "Red Wines" / "Red" for the second. Category names are
    // the merge and union keys, so churn there fragments a menu into duplicate sections.
    const parsed = parseMenuMarkdown(fixture("sugarbacon-drink-menu"))
    expect(parsed.credible).toBe(true)
    expect(parsed.itemsTotal).toBe(58)
    expect(parsed.menu?.categories.map((c) => c.name)).toEqual([
      "SPECIALTY COCKTAILS",
      "Red",
      "Sparkling & White",
      "MCKINNEY Bottled Beer",
      "MCKINNEY DRAFT BEER",
    ])
  })

  it("reads a bullet-list menu the model under-read by more than half", () => {
    const parsed = parseMenuMarkdown(fixture("fogharbor-menu"))
    expect(parsed.credible).toBe(true)
    expect(parsed.itemsTotal).toBe(200)
    // The model's three runs returned 69, 80 and 79 for this page.
    expect(parsed.itemsTotal).toBeGreaterThan(80)
    const starters = parsed.menu?.categories.find((c) => c.name === "Starters")
    expect(starters?.items.find((i) => i.name === "Crab Cakes")).toMatchObject({
      priceValue: 20,
      description: "Two crab cakes, harissa aioli, mixed greens and roasted red peppers",
    })
  })

  it("finds nothing on an image-only menu, and gates the model off it entirely", () => {
    const markdown = fixture("bushschicken-menu")
    const parsed = parseMenuMarkdown(markdown)
    expect(parsed.itemsTotal).toBe(0)
    expect(parsed.credible).toBe(false)
    expect(parsed.usable).toBe(false)
    // Zero priced text on the page. This is the gate that stopped us paying a model to
    // invent "Fried Chicken Meal $8.99" off a JPEG.
    expect(priceSignalCount(markdown)).toBe(0)
    expect(priceSignalCount(markdown)).toBeLessThan(MIN_PRICE_SIGNALS_FOR_MODEL)
  })

  it("is byte-stable: the same markdown always parses to the same menu", () => {
    const markdown = fixture("sugarbacon-dinner-menu")
    const a = parseMenuMarkdown(markdown)
    const b = parseMenuMarkdown(markdown)
    expect(JSON.stringify(a.menu)).toBe(JSON.stringify(b.menu))
  })

  it("drops navigation, footers and phone numbers", () => {
    const parsed = parseMenuMarkdown(fixture("sugarbacon-dinner-menu"))
    const names = (parsed.menu?.categories ?? []).flatMap((c) => c.items.map((i) => i.name))
    for (const junk of ["Contact Us:", "RESTAURANT", "MORE", "Make a Reservation"]) {
      expect(names).not.toContain(junk)
    }
    expect(names.some((n) => /\(469\)/.test(n))).toBe(false)
  })

  it("never emits an unpriced-heavy parse as usable", () => {
    // A page of section headings and prose, one stray price: not a menu.
    const parsed = parseMenuMarkdown(["# About", "We opened in 1998", "Lunch special $9"].join("\n"))
    expect(parsed.credible).toBe(false)
  })

  it("returns an empty verdict for empty input rather than throwing", () => {
    for (const input of [null, undefined, "", "   \n  "]) {
      const parsed = parseMenuMarkdown(input)
      expect(parsed.menu).toBeNull()
      expect(parsed.credible).toBe(false)
      expect(parsed.itemsTotal).toBe(0)
    }
  })
})

describe("classifyItemKind", () => {
  it("classifies from the category first, then the item", () => {
    expect(classifyItemKind("Old Fashioned", "SPECIALTY COCKTAILS")).toBe("drink")
    expect(classifyItemKind("Truffle Fries", "SIDES")).toBe("side")
    expect(classifyItemKind("Short Rib", "Entrées")).toBe("entree")
    expect(classifyItemKind("Tiramisu", "Desserts")).toBe("dessert")
    expect(classifyItemKind("2 Piece Meal", "Chicken")).toBe("combo_meal")
    expect(classifyItemKind("8 Piece Family Pack", "Menu")).toBe("family_pack")
  })

  it("returns null rather than guessing", () => {
    expect(classifyItemKind("Gift Certificate", "Other")).toBeNull()
  })
})
