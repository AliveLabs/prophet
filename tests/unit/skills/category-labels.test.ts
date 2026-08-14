// ALT-554 — the shared operator-facing category vocabulary.
//
// The bug this guards was never a wiring bug: the category KEYS always lined up across
// the settings sliders, the feed chips, and the card chips. Three separate copies of the
// label map drifted apart on the WORDS, so a slider named one thing moved chips named
// another. These tests hold the single map complete in both directions, and hold the one
// distinction we kept on purpose: detector rows name their signal source, not a category.

import { describe, it, expect } from "vitest"
import { CATEGORY_LABEL } from "@/lib/skills/category-labels"
import { CATEGORY_ORDER, DEFAULT_CATEGORY_PRIORS } from "@/lib/skills/category-priors"
import { CATEGORY_PRIORS } from "@/lib/skills/scoring-config"
import { SOURCE_LABELS } from "@/lib/insights/scoring"
import { latestBriefCategoryCounts } from "@/lib/insights/insight-pool"
import type { Category } from "@/lib/skills/types"

describe("CATEGORY_LABEL is the single source of truth for category names", () => {
  it("resolves every category the sliders render, with no orphan labels the other way", () => {
    // Sliders → labels: every control has a name.
    for (const cat of CATEGORY_ORDER) {
      expect(CATEGORY_LABEL[cat], `no label for "${cat}"`).toBeTruthy()
    }
    // Labels → sliders: no name describes a category that no longer exists.
    for (const key of Object.keys(CATEGORY_LABEL)) {
      expect(CATEGORY_ORDER, `orphan label key "${key}"`).toContain(key as Category)
    }
    expect(Object.keys(CATEGORY_LABEL).length).toBe(CATEGORY_ORDER.length)
  })

  it("covers exactly the categories the ranker prices, so a slider can never be nameless", () => {
    expect(Object.keys(CATEGORY_LABEL).sort()).toEqual(Object.keys(CATEGORY_PRIORS).sort())
    expect(Object.keys(CATEGORY_LABEL).sort()).toEqual(Object.keys(DEFAULT_CATEGORY_PRIORS).sort())
  })

  it("names each category distinctly and in the operator's plain words", () => {
    const labels = Object.values(CATEGORY_LABEL)
    expect(new Set(labels).size, "two categories share a name").toBe(labels.length)
    for (const label of labels) {
      expect(label.trim()).toBe(label)
      expect(label).not.toMatch(/[—–]/) // no em/en dashes in shipped copy
      // The old settings labels carried their scope in parentheses, which is exactly what
      // stopped them matching a chip. Scope lives in the per-category tooltip now.
      expect(label).not.toMatch(/[()]/)
    }
  })

  it("keeps the settings word and the card word identical for the ones that used to diverge", () => {
    // These four are the divergences ALT-554 reported. `convergence` was the worst:
    // "Cross-signal convergence" on the slider vs "Cross-domain" on the card, no shared word.
    expect(CATEGORY_LABEL.convergence).toBe("Cross-domain")
    expect(CATEGORY_LABEL.demand).toBe("Demand")
    expect(CATEGORY_LABEL.social).toBe("Social")
    expect(CATEGORY_LABEL.grassroots).toBe("Grassroots")
  })

  it("stays separate from the detector-row source vocabulary (different objects)", () => {
    // A detector row has no engine Category; its chip names the signal it came from. The
    // two vocabularies must not collide, or a filter option would mean two things at once.
    const shared = Object.values(CATEGORY_LABEL).filter((l) =>
      (Object.values(SOURCE_LABELS) as string[]).includes(l),
    )
    expect(shared, `category and source labels collide on: ${shared.join(", ")}`).toEqual([])
  })
})

describe("latestBriefCategoryCounts — the number shown beside each slider", () => {
  it("counts the latest brief's plays per category and names the brief it read", () => {
    const got = latestBriefCategoryCounts([
      { category: "demand", last_seen_date: "2026-08-13" },
      { category: "demand", last_seen_date: "2026-08-13" },
      { category: "menu", last_seen_date: "2026-08-13" },
    ])
    expect(got.dateKey).toBe("2026-08-13")
    expect(got.counts).toEqual({ demand: 2, menu: 1 })
  })

  it("reports no brief when there is nothing to count, so no counts render at all", () => {
    // A column of zeroes would read as "these sliders do nothing" — worse than silence.
    expect(latestBriefCategoryCounts([])).toEqual({ dateKey: null, counts: {} })
  })

  it("skips uncategorised plays: they have no slider to sit beside", () => {
    const got = latestBriefCategoryCounts([
      { category: null, last_seen_date: "2026-08-13" },
      { category: "social", last_seen_date: "2026-08-13" },
    ])
    expect(got.counts).toEqual({ social: 1 })
    expect(got.dateKey).toBe("2026-08-13")
  })

  it("names the most recent date when a brief straddles two date keys", () => {
    const got = latestBriefCategoryCounts([
      { category: "menu", last_seen_date: "2026-08-12" },
      { category: "menu", last_seen_date: "2026-08-13" },
    ])
    expect(got.dateKey).toBe("2026-08-13")
    expect(got.counts).toEqual({ menu: 2 })
  })

  it("only ever counts categories the sliders can actually name", () => {
    const got = latestBriefCategoryCounts(
      CATEGORY_ORDER.map((cat) => ({ category: cat, last_seen_date: "2026-08-13" })),
    )
    for (const key of Object.keys(got.counts)) {
      expect(CATEGORY_LABEL[key as Category]).toBeTruthy()
    }
  })
})
