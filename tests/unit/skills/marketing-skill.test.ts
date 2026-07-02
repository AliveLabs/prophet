import { describe, test, expect } from "vitest"
import type { Dossier } from "@/lib/insights/dossier/types"
import { lintVoice } from "@/lib/eval/voice-rules"
import {
  MARKETING_ARCHETYPES,
  isMarketingSignal,
  isTemplateAdvice,
  marketingSkill,
} from "@/lib/skills/marketing/skill"

// Minimal dossier: fallback() and parse() only touch ruleOutputs + tier.ownSocialPlatforms.
const dossier = (ruleOutputs: { insight_type: string; title: string }[]) =>
  ({ ruleOutputs, tier: { ownSocialPlatforms: ["instagram"] } }) as unknown as Dossier

const step = {
  channel: "Google Business",
  platforms: ["instagram"],
  audience: "nearby diners deciding where to go this week",
  window: { note: "this week" },
}

const rawPlay = (over: Record<string, unknown>) => ({
  title: "Own the early-dinner lull with a named offer",
  rationale: "Rivals peak at 8pm while the 5:00-6:30 window sits quiet.",
  recipe: [step],
  evidenceRefs: ["traffic.lull_detected"],
  confidence: "medium",
  leverage: { label: "medium", basisInternal: "ordinal from the busy-curve gap" },
  ...over,
})

describe("isTemplateAdvice — the founder-flagged templates cannot survive", () => {
  test.each([
    "Post more on social this week",
    "Post more consistently to build momentum",
    "Tighten your content plan to match what is working", // v1's literal fallback title
    "Be more active on social media",
    "Engage with your followers daily",
    "Boost your social media presence",
    "Leverage social media to raise awareness",
    "Staff up for the weekend surge", // operations' lane — a marketing play never leads with it
  ])("kills: %s", (text) => {
    expect(isTemplateAdvice(text)).toBe(true)
  })

  test.each([
    "Own the early-dinner lull with a named offer",
    "Sell your quiet window instead of waiting it out",
    "Name the dish your reviews keep praising and lead every channel with it",
    "Trial a Friday-only lunch for six weeks while your rivals fill up at noon",
  ])("allows a real play: %s", (text) => {
    expect(isTemplateAdvice(text)).toBe(false)
  })
})

describe("isMarketingSignal — the widened intake covers every marketing family", () => {
  test.each([
    "social.engagement_gap",
    "visual.professional_upgrade",
    "traffic.weekend_shift",
    "hours_changed",
    "rating.trend_down",
    "review.velocity_stall",
    "photo.promotion_detected",
    "seo_keyword_win",
    "events.competitor_hosting_event",
    "events.local_festival",
  ])("claims %s", (t) => {
    expect(isMarketingSignal(t)).toBe(true)
  })

  test.each(["menu.price_change", "cross.demand_convergence"])("leaves %s to siblings", (t) => {
    expect(isMarketingSignal(t)).toBe(false)
  })
})

describe("MARKETING_ARCHETYPES — stable feedback-learning keys", () => {
  test("11 archetypes, no duplicates", () => {
    expect(MARKETING_ARCHETYPES.length).toBe(11)
    expect(new Set(MARKETING_ARCHETYPES).size).toBe(MARKETING_ARCHETYPES.length)
  })
})

describe("parse — domain grounding and the template kill-list", () => {
  const d = dossier([])

  test("unparseable model output returns null (triggers the deterministic fallback)", () => {
    expect(marketingSkill.parse("not json shaped", d)).toBeNull()
  })

  test("suppresses a play grounded only on non-marketing refs", () => {
    const out = marketingSkill.parse({ plays: [rawPlay({ evidenceRefs: ["menu.price_change"] })] }, d)
    expect(out).toEqual([])
  })

  test("suppresses template advice even when grounded", () => {
    const out = marketingSkill.parse(
      { plays: [rawPlay({ title: "Post more consistently on Instagram", evidenceRefs: ["social.engagement_gap"] })] },
      d,
    )
    expect(out).toEqual([])
  })

  test("keeps a grounded, non-template play and stamps identity", () => {
    const out = marketingSkill.parse({ plays: [rawPlay({})] }, d)
    expect(out).toHaveLength(1)
    expect(out![0].skillId).toBe("marketing")
    expect(out![0].knowledgeVersion).toBe("marketing@v2")
    expect(out![0].evidenceRefs).toEqual(["traffic.lull_detected"])
  })
})

describe("fallback — family-aware, capped, and sharper than v1's floor", () => {
  test("prioritizes demand rhythm, then guest voice, capped at 2", () => {
    const out = marketingSkill.fallback(
      dossier([
        { insight_type: "social.engagement_gap", title: "Short video is winning nearby" },
        { insight_type: "rating.trend_down", title: "Rating slipped this month" },
        { insight_type: "traffic.weekend_shift", title: "Friday early evening runs quiet" },
      ]),
    )
    expect(out).toHaveLength(2)
    expect(out[0].evidenceRefs).toEqual(["traffic.weekend_shift"])
    expect(out[1].evidenceRefs).toEqual(["rating.trend_down"])
  })

  test("emits nothing when no marketing-family signal exists (never fabricates)", () => {
    expect(marketingSkill.fallback(dossier([{ insight_type: "menu.price_change", title: "x" }]))).toEqual([])
  })

  test("every fallback play passes the skill's own gates and the voice lint", () => {
    const out = marketingSkill.fallback(
      dossier([
        { insight_type: "traffic.weekend_shift", title: "Friday early evening runs quiet" },
        { insight_type: "review.theme_shift", title: "Guests keep praising one dish" },
        { insight_type: "photo.promotion_detected", title: "A rival posted a new promo" },
        { insight_type: "social.engagement_gap", title: "Short video is winning nearby" },
      ]),
    )
    expect(out.length).toBeGreaterThan(0)
    for (const p of out) {
      // self-consistency: the floor must survive the same gates parse() applies to the model
      expect(p.evidenceRefs.some(isMarketingSignal)).toBe(true)
      const text = `${p.title} ${p.rationale} ${p.recipe
        .map((s) => `${s.audience} ${s.channel} ${s.creativeDirection ?? ""}`)
        .join(" ")}`
      expect(isTemplateAdvice(text)).toBe(false)
      // number-free floor: no fabricated figures in the static play title
      expect(/\d/.test(p.title)).toBe(false)
      expect(p.knowledgeVersion).toBe("marketing@v2")
      // brand voice: no em dashes, no kitchen lingo, anywhere in customer-facing text
      for (const s of [p.title, p.rationale, ...p.recipe.flatMap((r) => [r.audience, r.creativeDirection ?? "", r.window.note])]) {
        expect(lintVoice(s)).toEqual([])
      }
    }
  })
})
