// food-pairing@v2 (mastery-program retrofit) test suite — mirrors the sibling suites
// (positioning-skill.test.ts / local-demand-skill.test.ts are the closest templates).
// SUPERSEDES tests/unit/skills/food-pairing.test.ts: that suite pins the @v1.1 version
// string and asserts v1.1's floor titles/shape; both concerns are re-covered here for
// v2 (the run-harness end-to-end behaviors it covered are re-covered at the bottom).
//
// SCOPE NOTE: food-pairing is fundamentals-only by design. The tests below verify the
// program pattern is correctly applied (archetypes, kill-list, stance backstop, honest
// floor, boundaries) WITHOUT asserting sommelier subtlety — that would be out of scope.
//
// THE CENTRAL SEVERITY FACT this suite encodes: all six of this skill's signals are
// info-grade by construction, so the floor is DOMAIN + CONCEPT gated, never
// severity-gated (a warning/critical gate would silence the skill and take patio-weather
// red). See the "fallback" describe block.

import { describe, test, expect } from "vitest"
import type { Dossier } from "@/lib/insights/dossier/types"
import type { MenuSnapshot } from "@/lib/content/types"
import type { Transport } from "@/lib/ai/provider"
import type { GeneratedInsight } from "@/lib/insights/types"
import { lintVoice } from "@/lib/eval/voice-rules"
import { buildRefIndex } from "@/lib/insights/dossier/types"
import { runProducerSkill } from "@/lib/skills/run"
import { CATEGORY_PRIORS } from "@/lib/skills/scoring-config"
import {
  FOOD_PAIRING_ARCHETYPES,
  foodPairingSkill,
  isFoodPairingSignal,
  isTemplateAdvice,
} from "@/lib/skills/food-pairing/skill"
import { FOOD_PAIRING_KNOWLEDGE } from "@/lib/skills/food-pairing/knowledge"

const KNOWLEDGE_VERSION = "food-pairing@v2"

// Minimal dossier: fallback() touches ruleOutputs + profile.attributes.hasPatio (the
// patio branch); parse() touches ruleOutputs; buildPrompt touches the wider profile /
// tier / location surface. Real rule outputs always carry a severity — here all of this
// skill's signals are info by construction, which the floor design relies on.
const dossier = (
  ruleOutputs: { insight_type: string; title: string; severity?: string; evidence?: Record<string, unknown> }[],
  opts?: { hasPatio?: boolean; cuisine?: string; priceTier?: string; menu?: MenuSnapshot | null; weather?: unknown[] },
) =>
  ({
    locationId: "loc-t",
    dateKey: "2026-07-03",
    generatedAt: "2026-07-03T06:00:00-04:00",
    tier: { tier: 2, maxCompetitors: 5, maxLocations: 1, ownSocialPlatforms: ["instagram"], competitorSocialPlatforms: ["instagram"], seoCadence: "weekly", briefCadence: "daily", photosPerEntity: 30, retentionDays: 90 },
    profile: {
      locationId: "loc-t",
      name: "Test House",
      timezone: "America/New_York",
      voiceTone: "warm_personal",
      attributes: { cuisine: opts?.cuisine, priceTier: opts?.priceTier, hasPatio: opts?.hasPatio, dayparts: ["dinner"] },
      capability: {},
    },
    location: { entityId: "loc-t", kind: "location", name: "Test House", menu: opts?.menu ?? null },
    competitors: [],
    demandCalendar: { events: [], weather: opts?.weather ?? [] },
    ruleOutputs,
  }) as unknown as Dossier

const step = {
  channel: "menu feature / specials board",
  platforms: [],
  audience: "guests deciding what to order this week",
  window: { note: "this week" },
}

const rawPlay = (over: Record<string, unknown>) => ({
  title: "Feature the braised short rib at dinner this cold week",
  rationale:
    "A cold snap this week; lean into the warm, slow-cooked items already on the menu and pour a bold red alongside.",
  recipe: [step],
  evidenceRefs: ["menu.menu_change_detected"],
  confidence: "medium",
  leverage: { label: "high", basisInternal: "fits the weather; high-margin signature" },
  ...over,
})

describe("food-pairing skill — wiring/identity (unchanged from v1.1 except the version)", () => {
  test("declares the menu category on the standard reasoning tier (not the deep pass)", () => {
    expect(foodPairingSkill.id).toBe("food-pairing")
    expect(foodPairingSkill.displayName).toBe("Food-pairing & menu expert (the kitchen)")
    expect(foodPairingSkill.category).toBe("menu")
    expect(foodPairingSkill.ownerRole).toBe("kitchen")
    expect(foodPairingSkill.kind).toBe("capitalize")
    expect(foodPairingSkill.deep).toBeFalsy()
    expect(foodPairingSkill.tier).toBe("reasoning")
    expect(foodPairingSkill.temperature).toBe(0.5)
    expect(foodPairingSkill.knowledgeVersion).toBe(KNOWLEDGE_VERSION)
  })
  test("menu carries a neutral scoring prior (earned from evidence later, not asserted)", () => {
    expect(CATEGORY_PRIORS.menu).toBe(1.0)
  })
  test("fundamentals-only: learns from usage (click/ask), NOT an external food-trend feed", () => {
    expect(foodPairingSkill.learning?.streams).toEqual(["click", "ask"])
    expect(foodPairingSkill.learning?.streams).not.toContain("external")
    expect(foodPairingSkill.learning?.playTypeLeadDomain).toBe("menu")
    expect(foodPairingSkill.learning?.acceptedLearningKinds).toEqual(["editorial"])
  })
})

describe("FOOD_PAIRING_ARCHETYPES — stable feedback-learning keys", () => {
  test("5 archetypes, no duplicates", () => {
    expect(FOOD_PAIRING_ARCHETYPES.length).toBe(5)
    expect(new Set(FOOD_PAIRING_ARCHETYPES).size).toBe(FOOD_PAIRING_ARCHETYPES.length)
  })
  test("carries the designed set", () => {
    expect(FOOD_PAIRING_ARCHETYPES).toEqual([
      "weather_match_feature",
      "seasonal_swap",
      "signature_spotlight",
      "add_on_merchandise",
      "obvious_pairing",
    ])
  })
})

describe("isFoodPairingSignal — verified intake: the 4 menu-feature rows + the 2 weather cues, minus PRICE", () => {
  test.each([
    "menu.signature_item_missing",
    "menu.category_gap",
    "menu.menu_change_detected",
    "menu.promo_signal_detected",
    "visual.weather_patio",
    "traffic.weather_suppression",
    "menu.menu_change_detected:delta", // type:key refs resolve to their base rule
    "visual.weather_patio:has_patio_photos",
  ])("claims %s", (t) => {
    expect(isFoodPairingSignal(t)).toBe(true)
  })

  test.each([
    "menu.price_positioning_shift", // EXCLUDED: positioning@v4's territory (price)
    "menu.catering_pricing_gap", // EXCLUDED: positioning@v4's territory (price)
    "menu.price_positioning_shift:priceDiffPct", // even suffixed, the price row is excluded
    "photo.price_change", // positioning/marketing, not food-pairing
    "social.posting_frequency_gap", // marketing
    "review.theme", // reputation
    "rating_change",
    "traffic.surge", // operations (only weather_suppression is shared)
    "events.major_lobby_surge", // local-demand
    "seo_organic_visibility_up", // the quiet-week off-domain signal
    "hours_changed",
  ])("leaves %s to siblings (price rows structurally excluded)", (t) => {
    expect(isFoodPairingSignal(t)).toBe(false)
  })
})

describe("isTemplateAdvice — generic feature/special advice and parroted canned recs cannot survive", () => {
  test.each([
    "Put your standout item front and center", // v1.1's literal floor title #1 (replaced)
    "Feature the dish that fits this week's weather", // v1.1's literal floor title #2 (replaced)
    "Feature your best dish this weekend", // the generic feature class
    "Feature your signature item on social",
    "Promote a special to drive traffic",
    "Promote your best seller",
    "Run a special this week",
    "Add a new special to the menu",
    "Introduce a new dish for the season",
    "Push your top seller at lunch",
    "Update your menu to stay fresh",
    "Consider adding brunch or desserts", // category-gap rule's canned rec
    'Consider adding a "happy hour" offering', // promo rule's canned rec
    "Explore adding popular competitor items", // signature-item rule's canned rec
    "Update your online presence", // menu-change rule's canned rec
    "Highlight outdoor dining options", // patio rule's canned rec
    "Focus on delivery and indoor experience", // suppression rule's canned rec
  ])("kills: %s", (text) => {
    expect(isTemplateAdvice(text)).toBe(true)
  })

  test.each([
    // the bar: dish + daypart + week-specific features survive
    "Feature the braised short rib at dinner while this cold snap holds",
    "Pull the house gumbo to the top of the specials board as your signature this week",
    "Pair the crispy calamari with a crisp lager as a combo the register can ring",
    "Put a light chilled ceviche out front on the patio while the warm weather holds",
    "Swap in the peach cobbler now that stone fruit is in season",
    "Make the smoked half chicken the easy answer to what to order this week",
    "Feature the French onion soup at dinner and pour a bold red alongside it",
  ])("allows a real feature: %s", (text) => {
    expect(isTemplateAdvice(text)).toBe(false)
  })
})

describe("knowledge — budget + the load-bearing sections + fundamentals scope", () => {
  test("stays modest: well under the siblings' size (fundamentals-only, do not gold-plate)", () => {
    // positioning 22.5k, local-demand 19.5k; food-pairing is the lowest-stakes skill and
    // must stay tighter. Cap generously but firmly below the siblings.
    expect(FOOD_PAIRING_KNOWLEDGE.length).toBeLessThan(18_000)
  })
  test("buildPrompt worst-case (fat menu) stays in the safe band, no raw-menu leak", () => {
    // v2 caps summarizeMenu at 6x8 items; an 8x12 cap pushed a fat menu's built prompt to
    // ~43k, into the silent-timeout zone guerrilla was throttled by. The 6x8 cap lands it
    // ~33.4k. Assert under 36k so a re-loosened cap or a raw-menu leak fails CI (the
    // regression guard the sibling smoke tests all carry).
    const fatMenu: MenuSnapshot = {
      menuUrl: "https://x.test/menu",
      capturedAt: "2026-07-01T00:00:00Z",
      screenshot: null,
      currency: "USD",
      categories: Array.from({ length: 12 }, (_, c) => ({
        name: `Section ${String.fromCharCode(65 + c)}`,
        menuType: "dine_in" as const,
        items: Array.from({ length: 30 }, (_, i) => ({
          name: `Dish ${c}-${i} with a long descriptive name`,
          description: "A long menu description that must never reach the prompt.",
          price: `$${10 + i}`,
          priceValue: 10 + i,
          tags: ["house", "popular", "chef-pick", "spicy"],
        })),
      })),
      parseMeta: { itemsTotal: 360, confidence: "high", notes: [] },
    }
    const d = dossier([{ insight_type: "menu.signature_item_missing", title: "x", severity: "info" }], { menu: fatMenu })
    const { systemCached = "", system, prompt } = foodPairingSkill.buildPrompt(d)
    const total = systemCached.length + system.length + prompt.length
    expect(total).toBeLessThan(36_000)
    expect(prompt).not.toContain("A long menu description that must never reach the prompt.")
    expect(prompt).not.toContain("priceValue")
  })
  test("carries the program-pattern sections", () => {
    expect(FOOD_PAIRING_KNOWLEDGE).toContain("STAY FUNDAMENTAL")
    expect(FOOD_PAIRING_KNOWLEDGE).toContain("OBVIOUS PAIRINGS")
    expect(FOOD_PAIRING_KNOWLEDGE).toContain("FOLKLORE FLAGS")
    expect(FOOD_PAIRING_KNOWLEDGE).toContain("WHAT YOU ARE NOT")
    expect(FOOD_PAIRING_KNOWLEDGE).toContain("THE BAR")
  })
  test("no em/en dashes anywhere in the prompt body (brand canon)", () => {
    expect(/[—–]/.test(FOOD_PAIRING_KNOWLEDGE)).toBe(false)
  })
  test("preserves the fundamentals intent verbatim in spirit (stop dumb pairings, not sommelier)", () => {
    expect(FOOD_PAIRING_KNOWLEDGE.toLowerCase()).toContain("stop dumb pairings")
    expect(FOOD_PAIRING_KNOWLEDGE.toLowerCase()).toContain("not a")
    expect(FOOD_PAIRING_KNOWLEDGE).toContain("out of scope")
  })
})

describe("parse — domain grounding, the template kill-list, and deliberate stance", () => {
  const d = dossier([])

  test("unparseable model output returns null (triggers the deterministic fallback)", () => {
    expect(foodPairingSkill.parse("not json shaped", d)).toBeNull()
  })

  test("keeps a grounded, non-template play and stamps identity", () => {
    const out = foodPairingSkill.parse({ plays: [rawPlay({})] }, d)
    expect(out).toHaveLength(1)
    expect(out![0].skillId).toBe("food-pairing")
    expect(out![0].knowledgeVersion).toBe(KNOWLEDGE_VERSION)
    expect(out![0].kind).toBe("capitalize")
    expect(out![0].ownerRole).toBe("kitchen")
    expect(out![0].evidenceRefs).toEqual(["menu.menu_change_detected"])
  })

  test("suppresses a play grounded only on an EXCLUDED price ref (positioning's territory)", () => {
    const out = foodPairingSkill.parse({ plays: [rawPlay({ evidenceRefs: ["menu.price_positioning_shift"] })] }, d)
    expect(out).toEqual([])
  })

  test("suppresses a play grounded only on a borrowed non-food-pairing ref", () => {
    const out = foodPairingSkill.parse({ plays: [rawPlay({ evidenceRefs: ["events.major_lobby_surge"] })] }, d)
    expect(out).toEqual([])
  })

  test("suppresses generic feature advice even when grounded", () => {
    const out = foodPairingSkill.parse({ plays: [rawPlay({ title: "Feature your best dish this weekend" })] }, d)
    expect(out).toEqual([])
  })

  test("suppresses a parroted canned rule recommendation even when grounded", () => {
    const out = foodPairingSkill.parse({ plays: [rawPlay({ title: "Explore adding popular competitor items" })] }, d)
    expect(out).toEqual([])
  })

  test("stance backstop: unset stance becomes capture on this skill's info-grade refs (the norm)", () => {
    const withInfo = dossier([{ insight_type: "menu.menu_change_detected", title: "Your menu changed", severity: "info" }])
    const out = foodPairingSkill.parse({ plays: [rawPlay({})] }, withInfo)
    expect(out![0].stance).toBe("capture")
  })

  test("stance backstop: unset stance becomes fix if a cited ref is ever warning-grade (forward-compat)", () => {
    // No food-pairing rule emits warning today, but the resolution is kept for the future.
    const withWarning = dossier([{ insight_type: "menu.menu_change_detected", title: "Your menu changed", severity: "warning" }])
    const out = foodPairingSkill.parse({ plays: [rawPlay({})] }, withWarning)
    expect(out![0].stance).toBe("fix")
  })

  test("stance backstop resolves an evidence-key suffixed ref to its base rule", () => {
    const withWarning = dossier([{ insight_type: "visual.weather_patio", title: "Patio weather", severity: "warning" }])
    const out = foodPairingSkill.parse({ plays: [rawPlay({ evidenceRefs: ["visual.weather_patio:has_patio_photos"] })] }, withWarning)
    expect(out![0].stance).toBe("fix")
  })

  test("the model's deliberate stance is preserved (maintain stays maintain, never inferred)", () => {
    const out = foodPairingSkill.parse({ plays: [rawPlay({ stance: "maintain" })] }, d)
    expect(out![0].stance).toBe("maintain")
  })
})

describe("fallback — a DOMAIN + CONCEPT gated floor (not severity-gated), at most 2 number-free plays", () => {
  const menuSig = { insight_type: "menu.signature_item_missing", title: "No signature dish stands out", severity: "info" }
  const patioSig = { insight_type: "visual.weather_patio", title: "Patio weather all weekend", severity: "info" }
  const suppressionSig = { insight_type: "traffic.weather_suppression", title: "A cold snap is keeping people in", severity: "info" }

  test("emits a grounded feature play from a menu signal, WITHOUT claiming a weather rationale", () => {
    const out = foodPairingSkill.fallback(dossier([menuSig]))
    expect(out).toHaveLength(1)
    expect(out[0].skillId).toBe("food-pairing")
    expect(out[0].ownerRole).toBe("kitchen")
    expect(out[0].kind).toBe("capitalize")
    expect(out[0].evidenceRefs).toEqual(["menu.signature_item_missing"])
    expect(out[0].knowledgeVersion).toBe(KNOWLEDGE_VERSION)
    // Honesty: a menu-grounded play must not imply weather grounding it lacks.
    expect(`${out[0].title} ${out[0].rationale}`.toLowerCase()).not.toContain("weather")
  })

  test("grounds on a weather-cue signal, and the copy DOES speak to weather", () => {
    const out = foodPairingSkill.fallback(dossier([suppressionSig]))
    expect(out).toHaveLength(1)
    expect(out[0].evidenceRefs).toEqual(["traffic.weather_suppression"])
    expect(out[0].rationale.toLowerCase()).toContain("weather")
  })

  test("GOLDEN CONSTRAINT: fires on visual.weather_patio WITH the patio flag -> the patio-weather feature", () => {
    // patio-weather's only rule output is visual.weather_patio (info) + hasPatio: true; this
    // keeps that golden green (local-demand@v2 fires there too — the deliberate shared read).
    const out = foodPairingSkill.fallback(dossier([patioSig], { hasPatio: true }))
    expect(out).toHaveLength(1)
    expect(out[0].evidenceRefs).toEqual(["visual.weather_patio"])
    expect(out[0].rationale.toLowerCase()).toContain("weather")
    expect(`${out[0].title} ${out[0].rationale}`.toLowerCase()).toContain("patio")
  })

  test("CONCEPT GATE: visual.weather_patio WITHOUT a patio flag still grounds a weather-fit feature, but claims NO patio", () => {
    const out = foodPairingSkill.fallback(dossier([patioSig], { hasPatio: false }))
    expect(out).toHaveLength(1)
    expect(out[0].evidenceRefs).toEqual(["visual.weather_patio"])
    expect(out[0].rationale.toLowerCase()).toContain("weather")
    // The word "patio" may appear ONLY in the grounding citation (the cited signal's title
    // is "Patio weather all weekend"); the skill's OWN copy must make no patio-possession
    // claim when the profile does not confirm one (the photo evidence is a competitor proxy).
    // Strip the "Grounded in <title>." citation, then assert the remaining authored copy is
    // patio-free — this is the honest-attribution guarantee.
    expect(out[0].title.toLowerCase()).not.toContain("patio")
    const authored = out[0].rationale.replace(/grounded in [^.]*\./i, "").toLowerCase()
    expect(authored).not.toContain("patio")
  })

  test("does NOT fire on a PRICE menu signal — that is positioning@v4's territory", () => {
    expect(foodPairingSkill.fallback(dossier([{ insight_type: "menu.price_positioning_shift", title: "You are pricier than a rival", severity: "warning" }]))).toEqual([])
    expect(foodPairingSkill.fallback(dossier([{ insight_type: "menu.catering_pricing_gap", title: "Catering gap", severity: "warning" }]))).toEqual([])
  })

  test("emits NOTHING when no menu-feature or weather-cue signal is present (no signal, no feature)", () => {
    expect(
      foodPairingSkill.fallback(dossier([{ insight_type: "events.new_high_signal_event", title: "Game Friday", severity: "info" }, { insight_type: "seo_keyword_win", title: "Won a keyword", severity: "info" }])),
    ).toEqual([])
    expect(foodPairingSkill.fallback(dossier([]))).toEqual([])
    // the quiet-week fixture's only signal is off-domain -> honest quiet brief
    expect(foodPairingSkill.fallback(dossier([{ insight_type: "seo_organic_visibility_up", title: "steady", severity: "info" }]))).toEqual([])
  })

  test("caps at 2 plays even when many food-pairing signals are present", () => {
    const out = foodPairingSkill.fallback(dossier([menuSig, patioSig, suppressionSig, { insight_type: "menu.category_gap", title: "gap", severity: "info" }], { hasPatio: true }))
    expect(out.length).toBe(2)
    // distinct signals -> distinct evidence refs
    expect(new Set(out.flatMap((p) => p.evidenceRefs)).size).toBe(2)
  })

  test("floor plays pass the skill's own gates, ship no canned customer copy, and stay number-free and voice-clean", () => {
    const out = foodPairingSkill.fallback(dossier([menuSig, patioSig], { hasPatio: true }))
    expect(out.length).toBe(2)
    for (const p of out) {
      // self-consistency: the floor must survive the same gates parse() applies to the model
      expect(p.evidenceRefs.some(isFoodPairingSignal)).toBe(true)
      const text = `${p.title} ${p.rationale} ${p.recipe
        .map((s) => `${s.audience} ${s.channel} ${s.offer ?? ""} ${s.copy ?? ""} ${s.creativeDirection ?? ""}`)
        .join(" ")}`
      expect(isTemplateAdvice(text)).toBe(false)
      // the floor never ships paste-anywhere customer copy
      expect(p.recipe.every((s) => s.copy === undefined)).toBe(true)
      // number-free floor: no margin/cost/time figures, no invented numbers
      expect(/\d/.test(text)).toBe(false)
      expect(p.knowledgeVersion).toBe(KNOWLEDGE_VERSION)
      // brand voice: no em dashes, no kitchen lingo, anywhere in customer-facing text
      for (const s of [
        p.title,
        p.rationale,
        ...p.recipe.flatMap((r) => [r.audience, r.channel, r.window.note, r.creativeDirection ?? "", ...(r.dependencies ?? [])]),
      ]) {
        expect(lintVoice(s)).toEqual([])
      }
    }
  })
})

describe("buildPrompt — surfaces the real menu (pick a dish that exists) but never raw prices", () => {
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

  test("includes actual item names + tags but NOT raw menu prices (a price is not grounded evidence)", () => {
    const { prompt } = foodPairingSkill.buildPrompt(dossier([], { menu }))
    expect(prompt).toContain("Braised Short Rib")
    expect(prompt).toContain("gluten-free")
    expect(prompt).not.toContain("$28")
    expect(prompt).not.toContain("slow-cooked") // descriptions dropped too
  })

  test("a menu-less dossier omits the menu (null) rather than fabricating one", () => {
    const { prompt } = foodPairingSkill.buildPrompt(dossier([]))
    expect(prompt).toContain('"menu": null')
  })

  test("the playbook rides in the cached prefix and teaches the fundamentals scope", () => {
    const { systemCached } = foodPairingSkill.buildPrompt(dossier([], { menu }))
    expect(systemCached).toContain("STAY FUNDAMENTAL")
    expect(systemCached).toContain("WHAT YOU ARE NOT")
  })
})

describe("run.ts ground-filter end-to-end (model failure -> deterministic fallback)", () => {
  const failing: Transport = async () => {
    throw new Error("model down")
  }
  const sig = (insight_type: string, title: string): GeneratedInsight => ({
    insight_type,
    title,
    summary: "",
    confidence: "medium",
    severity: "info",
    evidence: {},
    recommendations: [],
  })

  test("falls back to deterministic plays, all grounded in real rule outputs", async () => {
    const d = dossier([{ insight_type: "menu.signature_item_missing", title: "No signature dish", severity: "info" }])
    const res = await runProducerSkill(foodPairingSkill, { ...d, ruleOutputs: [sig("menu.signature_item_missing", "No signature dish")] }, { transport: failing })
    expect(res.status).toBe("ok")
    expect(res.plays.length).toBeGreaterThan(0)
    const allowed = buildRefIndex({ ...d, ruleOutputs: [sig("menu.signature_item_missing", "No signature dish")] }).allowedRefs
    for (const p of res.plays) expect(p.evidenceRefs.every((r) => allowed.has(r))).toBe(true)
  })

  test("a model failure with ONLY a non-food-pairing signal yields zero plays (no signal, no play)", async () => {
    const d = { ...dossier([]), ruleOutputs: [sig("events.new_high_signal_event", "Game Friday")] }
    const res = await runProducerSkill(foodPairingSkill, d, { transport: failing })
    expect(res.status).toBe("ok")
    expect(res.plays).toEqual([])
  })

  test("a model failure with ONLY an excluded price signal yields zero plays (positioning's lane)", async () => {
    const d = { ...dossier([]), ruleOutputs: [sig("menu.price_positioning_shift", "Pricier than a rival")] }
    const res = await runProducerSkill(foodPairingSkill, d, { transport: failing })
    expect(res.status).toBe("ok")
    expect(res.plays).toEqual([])
  })
})
