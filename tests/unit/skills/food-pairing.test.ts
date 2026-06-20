// P6 — the food-pairing / kitchen skill. Category "menu" (neutral prior), standard reasoning
// tier (NOT the deep pass). Grounds features on menu.* + weather/seasonal rule outputs; the raw
// menu is context (pick a real dish), never a citable figure.

import { describe, it, expect } from "vitest"
import { foodPairingSkill } from "@/lib/skills/food-pairing/skill"
import { runProducerSkill } from "@/lib/skills/run"
import { CATEGORY_PRIORS } from "@/lib/skills/scoring-config"
import { buildRefIndex } from "@/lib/insights/dossier/types"
import { competitiveWeekDossier } from "@/tests/fixtures/dossiers/competitive-week"
import type { Dossier } from "@/lib/insights/dossier/types"
import type { GeneratedInsight } from "@/lib/insights/types"
import type { Transport } from "@/lib/ai/provider"
import type { MenuSnapshot } from "@/lib/content/types"

const sig = (insight_type: string, title: string): GeneratedInsight => ({
  insight_type,
  title,
  summary: "",
  confidence: "medium",
  severity: "info",
  evidence: {},
  recommendations: [],
})
const withSignals = (sigs: GeneratedInsight[]): Dossier => ({ ...competitiveWeekDossier, ruleOutputs: sigs })

describe("food-pairing skill — wiring", () => {
  it("declares the menu category on the standard reasoning tier (not the deep pass)", () => {
    expect(foodPairingSkill.id).toBe("food-pairing")
    expect(foodPairingSkill.category).toBe("menu")
    expect(foodPairingSkill.ownerRole).toBe("kitchen")
    expect(foodPairingSkill.deep).toBeFalsy()
    expect(foodPairingSkill.tier).toBe("reasoning")
  })
  it("menu carries a neutral scoring prior (earned from evidence later, not asserted)", () => {
    expect(CATEGORY_PRIORS.menu).toBe(1.0)
  })
})

describe("food-pairing skill — deterministic fallback", () => {
  it("emits a grounded feature play from a menu signal, WITHOUT claiming a weather rationale", () => {
    const plays = foodPairingSkill.fallback(withSignals([sig("menu.signature_item_missing", "No signature dish stands out")]))
    expect(plays).toHaveLength(1)
    expect(plays[0].skillId).toBe("food-pairing")
    expect(plays[0].ownerRole).toBe("kitchen")
    expect(plays[0].kind).toBe("capitalize")
    expect(plays[0].evidenceRefs).toEqual(["menu.signature_item_missing"])
    // Honesty (review finding #5): a menu-grounded play must not imply weather grounding it lacks.
    expect(plays[0].rationale.toLowerCase()).not.toContain("weather")
  })
  it("grounds on a weather-cue signal, and the copy DOES speak to weather", () => {
    const plays = foodPairingSkill.fallback(withSignals([sig("traffic.weather_suppression", "A cold snap is keeping people in")]))
    expect(plays).toHaveLength(1)
    expect(plays[0].evidenceRefs).toEqual(["traffic.weather_suppression"])
    expect(plays[0].rationale.toLowerCase()).toContain("weather")
  })
  it("does NOT fire on a PRICE menu signal — that is the positioning skill's territory", () => {
    expect(foodPairingSkill.fallback(withSignals([sig("menu.price_positioning_shift", "You are pricier than a rival")]))).toEqual([])
  })
  it("emits NOTHING when no menu-feature or weather-cue signal is present (no signal, no feature)", () => {
    expect(
      foodPairingSkill.fallback(withSignals([sig("events.new_high_signal_event", "Game Friday"), sig("seo_keyword_win", "Won a keyword")])),
    ).toEqual([])
    expect(foodPairingSkill.fallback(withSignals([]))).toEqual([])
  })
})

describe("food-pairing skill — parse", () => {
  const rawPlay = (evidenceRefs: string[]) => ({
    title: "Feature the braised short rib this cold week",
    rationale: "A cold snap; lean into the warm, slow-cooked items already on the menu.",
    recipe: [{ channel: "specials board", audience: "guests deciding this week" }],
    confidence: "medium",
    leverage: { label: "high", basisInternal: "fits the weather; high-margin signature" },
    evidenceRefs,
  })
  it("coerces model JSON into stamped plays", () => {
    const plays = foodPairingSkill.parse([rawPlay(["menu.menu_change_detected"])], competitiveWeekDossier)
    expect(plays).toHaveLength(1)
    expect(plays![0].skillId).toBe("food-pairing")
    expect(plays![0].knowledgeVersion).toBe("food-pairing@v1")
  })
  it("returns null on unparseable output so the deterministic fallback runs", () => {
    expect(foodPairingSkill.parse("not json at all", competitiveWeekDossier)).toBeNull()
  })
})

describe("food-pairing skill — buildPrompt surfaces the real menu (pick a dish that exists)", () => {
  it("includes actual item names but NOT raw menu prices (a price is not grounded evidence)", () => {
    const menu: MenuSnapshot = {
      menuUrl: null,
      capturedAt: "2026-06-20T00:00:00Z",
      screenshot: null,
      currency: "USD",
      categories: [
        {
          name: "Mains",
          menuType: "dine_in",
          items: [{ name: "Braised Short Rib", description: "slow-cooked", price: "$28", priceValue: 28, tags: ["gluten-free"] }],
        },
      ],
      parseMeta: { itemsTotal: 1, confidence: "high", notes: [] },
    }
    const d: Dossier = { ...competitiveWeekDossier, location: { ...competitiveWeekDossier.location, menu } }
    const { prompt } = foodPairingSkill.buildPrompt(d)
    expect(prompt).toContain("Braised Short Rib")
    expect(prompt).not.toContain("$28")
  })
})

describe("food-pairing skill — run.ts ground-filter end-to-end (model failure -> fallback)", () => {
  const failing: Transport = async () => {
    throw new Error("model down")
  }
  it("falls back to deterministic plays, all grounded in real rule outputs", async () => {
    const d = withSignals([sig("menu.signature_item_missing", "No signature dish")])
    const res = await runProducerSkill(foodPairingSkill, d, { transport: failing })
    expect(res.status).toBe("ok")
    expect(res.plays.length).toBeGreaterThan(0)
    const allowed = buildRefIndex(d).allowedRefs
    for (const p of res.plays) expect(p.evidenceRefs.every((r) => allowed.has(r))).toBe(true)
  })
  it("a model failure with ONLY a non-menu signal yields zero plays (no signal, no play)", async () => {
    // events.* is local-demand's, not food-pairing's — the zero-play invariant must hold end-to-end.
    const d = withSignals([sig("events.new_high_signal_event", "Game Friday")])
    const res = await runProducerSkill(foodPairingSkill, d, { transport: failing })
    expect(res.status).toBe("ok")
    expect(res.plays).toEqual([])
  })
})
