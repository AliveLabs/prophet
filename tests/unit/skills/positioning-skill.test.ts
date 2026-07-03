// positioning@v4 (mastery-program v2) test suite — mirrors the sibling suites
// (local-demand-skill.test.ts is the closest template). SUPERSEDES
// positioning-fallback.test.ts and positioning-visual.test.ts: the fallback suite
// asserted v1's canned titles (now kill-listed) and the visual suite asserted the
// v3 version string; both sets of concerns are covered here (tier-aware floor
// branches + the kept-and-extended vision read).

import { describe, test, expect } from "vitest"
import type { Dossier } from "@/lib/insights/dossier/types"
import type { EntityVisualProfile, SocialPostAnalysis } from "@/lib/social/types"
import { lintVoice } from "@/lib/eval/voice-rules"
import {
  POSITIONING_ARCHETYPES,
  isPositioningSignal,
  isTemplateAdvice,
  menuRead,
  positioningSkill,
  visualPositioningRead,
} from "@/lib/skills/positioning/skill"
import { POSITIONING_KNOWLEDGE } from "@/lib/skills/positioning/knowledge"
import { priceLevelToTier } from "@/lib/places/format"

const KNOWLEDGE_VERSION = "positioning@v4"

// Minimal dossier: fallback() touches ruleOutputs + profile.attributes.priceTier (the
// tier branch); parse() touches ruleOutputs; buildPrompt touches the wider profile /
// tier / location / competitors surface. Real rule outputs always carry severity.
const dossier = (
  ruleOutputs: { insight_type: string; title: string; severity?: string; evidence?: Record<string, unknown> }[],
  opts?: { priceTier?: string; visual?: EntityVisualProfile | null },
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
      attributes: { priceTier: opts?.priceTier },
      capability: {},
    },
    location: { entityId: "loc-t", kind: "location", name: "Test House", visual: opts?.visual ?? null },
    competitors: [],
    demandCalendar: { events: [], weather: [] },
    ruleOutputs,
  }) as unknown as Dossier

const step = {
  channel: "menu wording + Google Business profile",
  platforms: [],
  audience: "guests weighing the check against the rival next door",
  window: { note: "this week, one section at a time" },
}

const rawPlay = (over: Record<string, unknown>) => ({
  title: "Take the two named house dishes up one step and say why on the menu",
  rationale:
    "The gated row shows the area pricing well above you while your reviews keep calling you a bargain; move only the dishes nobody can comparison-shop and hold the rest.",
  recipe: [step],
  evidenceRefs: ["menu.price_positioning_shift"],
  confidence: "medium",
  leverage: { label: "medium", basisInternal: "ordinal from the gated price row's direction" },
  ...over,
})

// Kept from positioning-fallback.test.ts (which this suite supersedes): the Google
// price-level mapping the floor's tier branch reads.
describe("priceLevelToTier — maps Google price levels to tiers the floor branch understands", () => {
  test("mapping", () => {
    expect(priceLevelToTier("PRICE_LEVEL_VERY_EXPENSIVE")).toBe("premium")
    expect(priceLevelToTier("PRICE_LEVEL_EXPENSIVE")).toBe("upscale")
    expect(priceLevelToTier("PRICE_LEVEL_MODERATE")).toBe("mid-market")
    expect(priceLevelToTier("PRICE_LEVEL_INEXPENSIVE")).toBe("value")
    expect(priceLevelToTier(null)).toBeUndefined()
    expect(priceLevelToTier("GARBAGE")).toBeUndefined()
  })
})

describe("isTemplateAdvice — v1's canned floor, naked price advice, and parroted canned recs cannot survive", () => {
  test.each([
    "Answer the undercut with quality, not a discount", // v1's literal floor title #1
    "Add a value entry point, do not start a price war", // v1's literal floor title #2
    "Enter the comparison with one lower-priced item; do not start a price war", // v1's canned rationale line
    "Win the price war on your street",
    "Match their price on the lunch menu",
    "Undercut them on the weekend menu",
    "You should compete on price with the new spot",
    "Raise your prices to close the gap", // naked whole-menu price advice
    "Consider raising prices on high-margin items", // the price rule's canned rationale shape
    "Lower your prices to stay competitive",
    "Review your pricing strategy", // price rule's canned rec
    "Evaluate a price increase", // price rule's canned rec
    "Ensure your value proposition justifies the premium", // price rule's canned rationale
    "Check pricing against real feedback", // corroborated variant's canned rec
    "Lead with your value, not a lower price", // uncorroborated variant's canned rec
    "Make the premium obvious before touching price", // same source
    "Consider adding brunch or desserts", // category-gap rule's canned rec
    'Consider adding a "happy hour" offering', // promo rule's canned rec
    "Explore adding popular competitor items", // signature-item rule's canned rec
    "Update your online presence", // menu-change rule's canned rec
    "Add online reservations to your website", // conversion-gap rule's canned rec shape
    "Consider joining DoorDash and UberEats", // delivery-gap rule's canned rec
    "You may be leaving revenue on the table", // catering rule's canned rationale
    "Compare pricing with your menu", // photo price-change rule's canned rec
    "Launch a value menu to win back price shoppers", // the genericism class
    "Introduce a new value tier for weekdays",
    "Add a small service fee to every check", // fees: the highest-backlash lever
    "Charge a credit-card surcharge at the register",
    "Shrink the portions to protect margin", // quiet shrinkflation is never advice
    "Reduce portion sizes on the lunch plates",
  ])("kills: %s", (text) => {
    expect(isTemplateAdvice(text)).toBe(true)
  })

  test.each([
    // the bar: item-named, evidence-shaped positioning moves survive
    "Take the two dishes only you make up one step this month and hold the crowd-pleasers",
    "Raise the price of the smoked half chicken one step and add the farm's name to the menu the same week",
    "Fold the delivery cost into the printed price so nothing surprises anyone at the bill",
    "Retire the two flatbreads nobody orders and crown the section with the one dish that sets its frame",
    "Put one honest aspirational platter at the top of the section so the middle reads reasonable",
    "Offer a smaller portion of the seafood pasta at a price that still carries the kitchen's work",
    "Name the brisket after the house so nobody can price-shop it",
    "Let guests book a table from your site the way they already can next door",
    "Keep app prices a step above pickup and say why on your own site",
  ])("allows a real play: %s", (text) => {
    expect(isTemplateAdvice(text)).toBe(false)
  })
})

describe("isPositioningSignal — verified intake: menu + content + the rival price OCR, minus the ceded seo family", () => {
  test.each([
    "menu.price_positioning_shift",
    "menu.catering_pricing_gap",
    "menu.category_gap",
    "menu.signature_item_missing",
    "menu.promo_signal_detected",
    "menu.menu_change_detected",
    "content.conversion_feature_gap",
    "content.delivery_platform_gap",
    "photo.price_change",
    "menu.price_positioning_shift:priceDiffPct", // type:key refs resolve too
    "content.conversion_feature_gap:missingFeatures",
  ])("claims %s", (t) => {
    expect(isPositioningSignal(t)).toBe(true)
  })

  test.each([
    "seo_competitor_overtake", // CEDED: marketing@v2's competitor-move lane
    "seo_competitor_keyword_portfolio", // CEDED: same
    "seo_competitor_top_page_threat", // CEDED: same
    "seo_competitor_growth_trend", // CEDED: same
    "seo_keyword_win",
    "photo.new_content", // marketing's conquest material, no price read
    "photo.promotion_detected", // same
    "visual.category_shift",
    "social.posting_frequency_gap",
    "review.theme", // reputation's — adjacency context, never home turf
    "rating_change",
    "traffic.surge",
    "events.major_lobby_surge",
    "hours_changed",
  ])("leaves %s to siblings", (t) => {
    expect(isPositioningSignal(t)).toBe(false)
  })
})

describe("POSITIONING_ARCHETYPES — stable feedback-learning keys", () => {
  test("8 archetypes, no duplicates", () => {
    expect(POSITIONING_ARCHETYPES.length).toBe(8)
    expect(new Set(POSITIONING_ARCHETYPES).size).toBe(POSITIONING_ARCHETYPES.length)
  })
})

describe("knowledge — budget + the load-bearing sections", () => {
  test("stays well under the 40k-char prompt-budget cap", () => {
    expect(POSITIONING_KNOWLEDGE.length).toBeLessThan(25_000)
  })
  test("carries the named humility doctrine and the vision section", () => {
    expect(POSITIONING_KNOWLEDGE).toContain("SAMPLE HUMILITY DOCTRINE")
    expect(POSITIONING_KNOWLEDGE).toContain("WHAT THE PLACE LOOKS LIKE")
    expect(POSITIONING_KNOWLEDGE).toContain("FOLKLORE FLAGS")
    expect(POSITIONING_KNOWLEDGE).toContain("WHAT YOU ARE NOT")
  })
})

describe("parse — domain grounding, the template kill-list, and deliberate stance", () => {
  const d = dossier([])

  test("unparseable model output returns null (triggers the deterministic fallback)", () => {
    expect(positioningSkill.parse("not json shaped", d)).toBeNull()
  })

  test("suppresses a play grounded only on non-positioning refs", () => {
    const out = positioningSkill.parse({ plays: [rawPlay({ evidenceRefs: ["review.theme"] })] }, d)
    expect(out).toEqual([])
  })

  test("suppresses a play grounded only on the ceded seo_competitor refs", () => {
    const out = positioningSkill.parse({ plays: [rawPlay({ evidenceRefs: ["seo_competitor_overtake"] })] }, d)
    expect(out).toEqual([])
  })

  test("suppresses template advice even when grounded", () => {
    const out = positioningSkill.parse(
      { plays: [rawPlay({ title: "Answer the undercut with quality, not a discount" })] },
      d,
    )
    expect(out).toEqual([])
  })

  test("suppresses a parroted canned rule recommendation even when grounded", () => {
    const out = positioningSkill.parse({ plays: [rawPlay({ title: "Evaluate a price increase" })] }, d)
    expect(out).toEqual([])
  })

  test("suppresses naked whole-menu price advice even when grounded", () => {
    const out = positioningSkill.parse(
      { plays: [rawPlay({ rationale: "The rival is cheaper, so raise your prices across the menu." })] },
      d,
    )
    expect(out).toEqual([])
  })

  test("keeps a grounded, non-template play and stamps identity", () => {
    const out = positioningSkill.parse({ plays: [rawPlay({})] }, d)
    expect(out).toHaveLength(1)
    expect(out![0].skillId).toBe("positioning")
    expect(out![0].knowledgeVersion).toBe(KNOWLEDGE_VERSION)
    expect(out![0].evidenceRefs).toEqual(["menu.price_positioning_shift"])
    expect(out![0].kind).toBe("positioning")
    expect(out![0].ownerRole).toBe("owner")
  })

  test("stance backstop: an unset stance becomes fix when a cited ref is warning-grade", () => {
    const withWarning = dossier([
      { insight_type: "menu.price_positioning_shift", title: "A rival sits well under your dine-in check", severity: "warning" },
    ])
    const out = positioningSkill.parse({ plays: [rawPlay({})] }, withWarning)
    expect(out![0].stance).toBe("fix")
  })

  test("stance backstop resolves an evidence-key suffixed ref to its base rule", () => {
    const withCritical = dossier([
      { insight_type: "menu.catering_pricing_gap", title: "A rival undercuts your catering", severity: "critical" },
    ])
    const out = positioningSkill.parse(
      { plays: [rawPlay({ evidenceRefs: ["menu.catering_pricing_gap:priceDiffPct"] })] },
      withCritical,
    )
    expect(out![0].stance).toBe("fix")
  })

  test("stance backstop: an unset stance becomes capture on info-grade refs", () => {
    const withInfo = dossier([
      { insight_type: "menu.category_gap", title: "A rival lists categories you don't", severity: "info" },
    ])
    const out = positioningSkill.parse({ plays: [rawPlay({ evidenceRefs: ["menu.category_gap"] })] }, withInfo)
    expect(out![0].stance).toBe("capture")
  })

  test("the model's deliberate stance is preserved (maintain stays maintain)", () => {
    const withWarning = dossier([
      { insight_type: "menu.price_positioning_shift", title: "A rival sits well under your check", severity: "warning" },
    ])
    const out = positioningSkill.parse({ plays: [rawPlay({ stance: "maintain" })] }, withWarning)
    expect(out![0].stance).toBe("maintain")
  })
})

describe("fallback — a severity-gated, tier-aware floor: at most 2 number-free plays", () => {
  // Fixture-shaped: the golden constraint's row (competitive-week / arena-week carry
  // exactly this warning-grade type; evidence keys there differ from prod's, so the
  // floor must never depend on evidence keys).
  const priceWarning = {
    insight_type: "menu.price_positioning_shift",
    title: "A rival sits well under your dine-in check",
    severity: "warning",
    evidence: { competitor: "Rival", their_avg: 12.11, your_avg: 19.99 },
  }
  const cateringWarning = {
    insight_type: "menu.catering_pricing_gap",
    title: "A rival undercuts your catering menu",
    severity: "warning",
  }
  const conversionWarning = {
    insight_type: "content.conversion_feature_gap",
    title: "A rival offers online reservations, catering services on their website",
    severity: "warning",
  }

  test("GOLDEN CONSTRAINT: a warning-grade price row + premium tier yields one grounded story play", () => {
    const out = positioningSkill.fallback(dossier([priceWarning], { priceTier: "premium" }))
    expect(out).toHaveLength(1)
    expect(out[0].evidenceRefs).toEqual(["menu.price_positioning_shift"])
    expect(out[0].stance).toBe("fix")
    expect(out[0].kind).toBe("positioning")
    expect(out[0].knowledgeVersion).toBe(KNOWLEDGE_VERSION)
    // premium answer is the value story, never the cheap plate
    expect(`${out[0].title} ${out[0].rationale}`.toLowerCase()).not.toContain("cheap door")
  })

  test("'upscale' also takes the premium branch", () => {
    const out = positioningSkill.fallback(dossier([priceWarning], { priceTier: "upscale" }))
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe("Put the proof behind your price where guests decide")
  })

  test("a confirmed value tier takes the comparison re-entry branch", () => {
    const out = positioningSkill.fallback(dossier([priceWarning], { priceTier: "value" }))
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe("Open one cheap door in a lane your big sellers don't own")
    expect(out[0].evidenceRefs).toEqual(["menu.price_positioning_shift"])
  })

  test("'mid-market' also takes the re-entry branch", () => {
    const out = positioningSkill.fallback(dossier([priceWarning], { priceTier: "mid-market" }))
    expect(out[0].title).toBe("Open one cheap door in a lane your big sellers don't own")
  })

  test("an UNKNOWN tier takes the story branch, never the cheap plate (v1 defaulted the other way)", () => {
    const out = positioningSkill.fallback(dossier([priceWarning]))
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe("Put the proof behind your price where guests decide")
  })

  test("an info-grade price row never produces a floor play (the severity gate holds)", () => {
    const out = positioningSkill.fallback(
      dossier([{ ...priceWarning, severity: "info" }], { priceTier: "premium" }),
    )
    expect(out).toEqual([])
  })

  test("a critical catering row outranks a warning dine-in row; type priority breaks severity ties", () => {
    const critCatering = { ...cateringWarning, severity: "critical" }
    const bySeverity = positioningSkill.fallback(dossier([priceWarning, critCatering], { priceTier: "premium" }))
    expect(bySeverity[0].evidenceRefs).toEqual(["menu.catering_pricing_gap"])
    const byPriority = positioningSkill.fallback(dossier([cateringWarning, priceWarning], { priceTier: "premium" }))
    expect(byPriority[0].evidenceRefs).toEqual(["menu.price_positioning_shift"])
  })

  test("a warning-grade conversion gap yields the parity play", () => {
    const out = positioningSkill.fallback(dossier([conversionWarning]))
    expect(out).toHaveLength(1)
    expect(out[0].evidenceRefs).toEqual(["content.conversion_feature_gap"])
    expect(out[0].stance).toBe("fix")
  })

  test("price + conversion together yield two DIFFERENT plays, price first, capped at 2", () => {
    const out = positioningSkill.fallback(
      dossier([conversionWarning, priceWarning, cateringWarning], { priceTier: "premium" }),
    )
    expect(out).toHaveLength(2)
    expect(out[0].evidenceRefs).toEqual(["menu.price_positioning_shift"])
    expect(out[1].evidenceRefs).toEqual(["content.conversion_feature_gap"])
    expect(out[0].title).not.toBe(out[1].title)
  })

  test("info-grade menu-shape rows never manufacture a floor play (info is their ceiling by construction)", () => {
    const out = positioningSkill.fallback(
      dossier([
        { insight_type: "menu.category_gap", title: "A rival lists categories you don't", severity: "info" },
        { insight_type: "menu.signature_item_missing", title: "A rival lists items you don't", severity: "info" },
        { insight_type: "menu.promo_signal_detected", title: "A rival promotes happy hour", severity: "info" },
        { insight_type: "menu.menu_change_detected", title: "Your menu shrank", severity: "info" },
        { insight_type: "content.delivery_platform_gap", title: "A rival is on more delivery apps", severity: "info" },
      ]),
    )
    expect(out).toEqual([])
  })

  test("photo.price_change never triggers the floor, even at warning grade (one photo is one data point)", () => {
    const out = positioningSkill.fallback(
      dossier([{ insight_type: "photo.price_change", title: "Price change detected at a rival", severity: "warning" }]),
    )
    expect(out).toEqual([])
  })

  test("an info-grade conversion gap (one missing feature) never triggers the floor", () => {
    const out = positioningSkill.fallback(dossier([{ ...conversionWarning, severity: "info" }]))
    expect(out).toEqual([])
  })

  test("emits nothing when no positioning-family signal exists (a quiet week stays quiet)", () => {
    expect(positioningSkill.fallback(dossier([]))).toEqual([])
    expect(
      positioningSkill.fallback(dossier([{ insight_type: "seo_organic_visibility_up", title: "x", severity: "info" }])),
    ).toEqual([])
  })

  test("floor plays pass the skill's own gates, ship no canned customer copy, and stay number-free and voice-clean", () => {
    const out = positioningSkill.fallback(
      dossier([priceWarning, conversionWarning], { priceTier: "premium" }),
    )
    expect(out.length).toBe(2)
    for (const p of out) {
      // self-consistency: the floor must survive the same gates parse() applies to the model
      expect(p.evidenceRefs.some(isPositioningSignal)).toBe(true)
      const text = `${p.title} ${p.rationale} ${p.recipe
        .map((s) => `${s.audience} ${s.channel} ${s.offer ?? ""} ${s.copy ?? ""} ${s.creativeDirection ?? ""}`)
        .join(" ")}`
      expect(isTemplateAdvice(text)).toBe(false)
      // the floor never ships paste-anywhere customer copy
      expect(p.recipe.every((s) => s.copy === undefined)).toBe(true)
      // number-free floor: the rule rows carry the gated figures; the floor never repeats
      // them (fixture titles are digit-free)
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

  test("the value-branch floor play is also gate-clean and number-free", () => {
    const out = positioningSkill.fallback(dossier([priceWarning], { priceTier: "value" }))
    const p = out[0]
    const text = `${p.title} ${p.rationale} ${p.recipe.map((s) => `${s.audience} ${s.channel} ${s.creativeDirection ?? ""}`).join(" ")}`
    expect(isTemplateAdvice(text)).toBe(false)
    expect(/\d/.test(text)).toBe(false)
    for (const s of [p.title, p.rationale]) expect(lintVoice(s)).toEqual([])
  })
})

// ── The kept-and-extended vision asset (supersedes positioning-visual.test.ts) ────────
function postAnalysis(over: Partial<SocialPostAnalysis>): SocialPostAnalysis {
  return {
    contentCategory: "food_dish",
    subcategory: "",
    tags: [],
    extractedText: "",
    foodPresentation: { platingQuality: "high", portionAppeal: "generous", colorVibrancy: "vibrant" },
    visualQuality: { lighting: "professional", composition: "professional", editing: "polished" },
    brandSignals: { logoVisible: true, brandColorsPresent: true, visualStyleConsistency: "on_brand" },
    atmosphereSignals: { crowdLevel: "packed", energy: "high", timeOfDay: "evening" },
    promotionalContent: false,
    promotionalDetails: "",
    confidence: 0.9,
    ...over,
  }
}

const visual: EntityVisualProfile = {
  entityType: "location",
  entityId: "loc-t",
  entityName: "Test House",
  platform: "instagram",
  contentMix: { food_dish: 0.6, interior_ambiance: 0.3, repost_meme: 0.1 },
  avgVisualQualityScore: 88,
  professionalContentPct: 72,
  foodPresentationScore: 91,
  brandConsistencyScore: 84,
  promotionalContentPct: 10,
  crowdSignalScore: 70,
  postAnalyses: [
    { postId: "p1", analysis: postAnalysis({}), engagement: 120 },
    {
      postId: "p2",
      analysis: postAnalysis({
        contentCategory: "interior_ambiance",
        foodPresentation: { platingQuality: "n/a", portionAppeal: "n/a", colorVibrancy: "n/a" },
        atmosphereSignals: { crowdLevel: "busy", energy: "relaxed", timeOfDay: "day" },
      }),
      engagement: 80,
    },
  ],
}

describe("visualPositioningRead — the kept vision asset, extended with plating/portion/promo reads", () => {
  test("distils scores + top content + atmosphere + the new level-word reads", () => {
    const read = visualPositioningRead(visual)!
    expect(read.foodPresentationScore).toBe(91)
    expect(read.topContent[0].category).toBe("food_dish")
    expect(read.atmosphere).toContain("packed")
    expect(read.platingRead).toBe("high") // dominant across food shots, n/a excluded
    expect(read.portionRead).toBe("generous")
    expect(read.promotionalContentPct).toBe(10) // the deal-heaviness read
  })

  test("returns null for no profile and for an empty/zero profile (absence guard)", () => {
    expect(visualPositioningRead(null)).toBeNull()
    expect(visualPositioningRead(undefined)).toBeNull()
    expect(
      visualPositioningRead({
        ...visual,
        contentMix: {},
        avgVisualQualityScore: 0,
        professionalContentPct: 0,
        foodPresentationScore: 0,
        brandConsistencyScore: 0,
        promotionalContentPct: 0,
        crowdSignalScore: 0,
        postAnalyses: [],
      }),
    ).toBeNull()
  })

  test("prompt folds the distilled read in, never the raw postAnalyses array", () => {
    const { prompt } = positioningSkill.buildPrompt(dossier([], { visual }))
    expect(prompt).toContain("visualProfile")
    expect(prompt).toContain("foodPresentationScore")
    expect(prompt).toContain("platingRead")
    expect(prompt).toContain("food_dish")
    expect(prompt).not.toContain("postAnalyses")
    expect(prompt).not.toContain("postId")
  })

  test("ABSENCE GUARD: no visual -> the prompt omits visualProfile entirely", () => {
    const { prompt } = positioningSkill.buildPrompt(dossier([], { visual: null }))
    expect(prompt).not.toContain("visualProfile")
  })

  test("the playbook teaches the look as pricing evidence (knowledge section present)", () => {
    const { systemCached } = positioningSkill.buildPrompt(dossier([], { visual }))
    expect(systemCached).toContain("WHAT THE PLACE LOOKS LIKE")
  })
})

describe("menuRead — the distilled, sample-honest menu shape (never the raw menu)", () => {
  const snapshot = {
    menuUrl: "https://x.test/menu",
    capturedAt: "2026-07-01T00:00:00Z",
    screenshot: null,
    currency: "USD",
    categories: [
      {
        name: "Mains",
        menuType: "dine_in" as const,
        items: [
          { name: "Smoked Half Chicken", description: null, price: "$18", priceValue: 18, tags: [] },
          { name: "Brisket Plate", description: null, price: "$24", priceValue: 24, tags: [] },
          { name: "House Burger", description: null, price: "$15", priceValue: 15, tags: [] },
        ],
      },
      {
        name: "Sides",
        menuType: "dine_in" as const,
        items: [{ name: "Fries", description: null, price: "$5", priceValue: 5, tags: [] }],
      },
    ],
    parseMeta: { itemsTotal: 4, confidence: "medium" as const, notes: ["menu page truncated"] },
  }

  test("carries structure, the comparable-meal band, ladder ends, and scrape metadata", () => {
    const read = menuRead(snapshot)!
    expect(read.scrapeConfidence).toBe("medium")
    expect(read.itemsSeenInScrape).toBe(4)
    expect(read.scrapeNotes).toEqual(["menu page truncated"])
    const bucket = read.buckets[0]
    expect(bucket.menuType).toBe("dine_in")
    expect(bucket.categories).toEqual(["Mains", "Sides"])
    // the comparable lens excludes the non-meal side (fries), same as the price rules
    expect(bucket.comparableMealCount).toBe(3)
    expect(bucket.comparableMealBand).toEqual({ low: 15, median: 18, high: 24 })
    expect(bucket.highestPriced[0]).toEqual({ name: "Brisket Plate", price: 24 })
    expect(bucket.lowestPriced[0]).toEqual({ name: "Fries", price: 5 })
  })

  test("returns null for a missing or empty menu (the input key is then omitted)", () => {
    expect(menuRead(null)).toBeNull()
    expect(menuRead(undefined)).toBeNull()
    expect(menuRead({ ...snapshot, categories: [] })).toBeNull()
    const { prompt } = positioningSkill.buildPrompt(dossier([]))
    expect(prompt).toContain('"ownMenuRead": null')
  })
})
