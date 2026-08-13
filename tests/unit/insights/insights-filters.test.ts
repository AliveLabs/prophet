// The consolidated /insights filters. Every test pins a coherence rule: one filter
// state reads identically across both sections (plays and detector rows), the type
// vocabulary is the cards' own chip labels, and no numeral ever reaches a filter.

import { describe, it, expect } from "vitest"
import {
  filtersActive,
  matchesFilters,
  parseInsightFilters,
  playStatusGroup,
  rowStatusGroup,
  typeOptions,
  typeSlug,
  type FilterableInsight,
  type InsightFilterState,
} from "@/app/(dashboard)/insights/insights-filters"

const NONE: InsightFilterState = { type: "", status: "", confidence: "", impact: "" }

function item(over: Partial<FilterableInsight> = {}): FilterableInsight {
  return {
    typeLabel: "Reputation",
    statusGroup: "new",
    confidence: "high",
    impact: "medium",
    ...over,
  }
}

describe("parseInsightFilters — validated, never throwing", () => {
  it("passes valid values through", () => {
    expect(
      parseInsightFilters({ type: "local-events", status: "kept", confidence: "directional", impact: "low" }),
    ).toEqual({ type: "local-events", status: "kept", confidence: "directional", impact: "low" })
  })

  it("reads unknown or absent values as the everything-view instead of throwing", () => {
    expect(parseInsightFilters({ status: "starred", confidence: "74", impact: "huge" })).toEqual(NONE)
    expect(parseInsightFilters(undefined)).toEqual(NONE)
  })

  it("never accepts a numeric confidence or impact — word levels only", () => {
    const f = parseInsightFilters({ confidence: "0.9", impact: "3" })
    expect(f.confidence).toBe("")
    expect(f.impact).toBe("")
  })

  it("normalizes a hand-typed type param to slug form", () => {
    expect(parseInsightFilters({ type: "Local Events" }).type).toBe("local-events")
  })
})

describe("typeSlug — URL-safe, deterministic", () => {
  it("slugs the real chip labels", () => {
    expect(typeSlug("Google Business Profile")).toBe("google-business-profile")
    expect(typeSlug("Website & Menu")).toBe("website-menu")
    expect(typeSlug("Cross-domain")).toBe("cross-domain")
    expect(typeSlug("Grassroots")).toBe("grassroots")
  })

  it("collapses punctuation runs and trims edges", () => {
    expect(typeSlug("  A  --  B  ")).toBe("a-b")
    expect(typeSlug("")).toBe("")
  })
})

describe("status groups — one lifecycle read across both sections", () => {
  it("maps play actions: none=new, saved=kept, snoozed/dismissed=dismissed", () => {
    expect(playStatusGroup(null)).toBe("new")
    expect(playStatusGroup("saved")).toBe("kept")
    expect(playStatusGroup("snoozed")).toBe("dismissed")
    expect(playStatusGroup("dismissed")).toBe("dismissed")
  })

  it("maps row statuses, legacy Track positives included (mirrors insightKeptState)", () => {
    expect(rowStatusGroup("new")).toBe("new")
    for (const s of ["read", "todo", "actioned"]) expect(rowStatusGroup(s)).toBe("kept")
    for (const s of ["dismissed", "snoozed"]) expect(rowStatusGroup(s)).toBe("dismissed")
    expect(rowStatusGroup("inaccurate")).toBe("inaccurate")
  })

  it("reads an unknown row status as new rather than hiding the row", () => {
    expect(rowStatusGroup("whatever")).toBe("new")
  })
})

describe("matchesFilters — the #213 status semantics plus type and word levels", () => {
  it("the default view (All active) hides what the operator cleared", () => {
    expect(matchesFilters(item({ statusGroup: "new" }), NONE)).toBe(true)
    expect(matchesFilters(item({ statusGroup: "kept" }), NONE)).toBe(true)
    expect(matchesFilters(item({ statusGroup: "dismissed" }), NONE)).toBe(false)
    expect(matchesFilters(item({ statusGroup: "inaccurate" }), NONE)).toBe(false)
  })

  it("an explicit status view shows exactly its group, cleared items included", () => {
    const dismissed: InsightFilterState = { ...NONE, status: "dismissed" }
    expect(matchesFilters(item({ statusGroup: "dismissed" }), dismissed)).toBe(true)
    expect(matchesFilters(item({ statusGroup: "new" }), dismissed)).toBe(false)

    const inaccurate: InsightFilterState = { ...NONE, status: "inaccurate" }
    expect(matchesFilters(item({ statusGroup: "inaccurate" }), inaccurate)).toBe(true)
    expect(matchesFilters(item({ statusGroup: "kept" }), inaccurate)).toBe(false)
  })

  it("type matches on the card's own chip label, via its slug", () => {
    const f: InsightFilterState = { ...NONE, type: "google-business-profile" }
    expect(matchesFilters(item({ typeLabel: "Google Business Profile" }), f)).toBe(true)
    expect(matchesFilters(item({ typeLabel: "Local Events" }), f)).toBe(false)
  })

  it("confidence and impact filter on word levels only", () => {
    const f: InsightFilterState = { ...NONE, confidence: "directional", impact: "high" }
    expect(matchesFilters(item({ confidence: "directional", impact: "high" }), f)).toBe(true)
    expect(matchesFilters(item({ confidence: "high", impact: "high" }), f)).toBe(false)
    expect(matchesFilters(item({ confidence: "directional", impact: "medium" }), f)).toBe(false)
  })

  it("filters compose: every set filter must match", () => {
    const f: InsightFilterState = { type: "reputation", status: "kept", confidence: "high", impact: "medium" }
    expect(matchesFilters(item({ statusGroup: "kept" }), f)).toBe(true)
    expect(matchesFilters(item({ statusGroup: "kept", typeLabel: "Social" }), f)).toBe(false)
  })

  it("applies identically to a play-shaped and a row-shaped descriptor", () => {
    // The whole point of the descriptor: a play and a row with the same read filter
    // the same way, section notwithstanding.
    const play = item({ typeLabel: "Social", statusGroup: "kept", confidence: "medium", impact: "low" })
    const row = { ...play }
    const f: InsightFilterState = { type: "social", status: "kept", confidence: "medium", impact: "low" }
    expect(matchesFilters(play, f)).toBe(matchesFilters(row, f))
  })
})

describe("typeOptions — derived from the data actually present", () => {
  it("dedupes by slug, keeps the first label, sorts alphabetically", () => {
    expect(
      typeOptions(["Reputation", "Local Events", "Reputation", "Google Business Profile"]),
    ).toEqual([
      { value: "google-business-profile", label: "Google Business Profile" },
      { value: "local-events", label: "Local Events" },
      { value: "reputation", label: "Reputation" },
    ])
  })

  it("keeps the play vocabulary and the row vocabulary as separate honest options", () => {
    // A play's chip says "Social" (its play category); a row's says "Social Media"
    // (its source stream). Neither is folded into the other — no third vocabulary.
    const opts = typeOptions(["Social", "Social Media"])
    expect(opts.map((o) => o.value)).toEqual(["social", "social-media"])
  })

  it("drops empty labels and returns [] for no data", () => {
    expect(typeOptions(["", "Menu"])).toEqual([{ value: "menu", label: "Menu" }])
    expect(typeOptions([])).toEqual([])
  })
})

describe("filtersActive", () => {
  it("is false for the everything-view and true when anything narrows", () => {
    expect(filtersActive(NONE)).toBe(false)
    expect(filtersActive({ ...NONE, type: "menu" })).toBe(true)
    expect(filtersActive({ ...NONE, status: "new" })).toBe(true)
    expect(filtersActive({ ...NONE, confidence: "high" })).toBe(true)
    expect(filtersActive({ ...NONE, impact: "low" })).toBe(true)
  })
})
