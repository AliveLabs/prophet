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
// Real rule outputs always carry severity ("info" | "warning" | "critical") — the floor gates on it.
const dossier = (ruleOutputs: { insight_type: string; title: string; severity?: string; evidence?: Record<string, unknown> }[]) =>
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

  // T2 — own-scoped demand-curve rules (lib/insights/own-traffic-insights.ts) use the
  // `hours.own_*` prefix specifically so they land in isRhythmSignal's turf (rhythm =
  // traffic.* + anything startsWith("hours")). Verifies the naming requirement holds
  // for marketing's intake, not just operations'.
  test.each(["hours.own_dead_edge_hour", "hours.own_slow_window", "hours.own_peak_drift"])(
    "claims T2 own-curve ref %s (hours.own_* prefix match)",
    (t) => {
      expect(isMarketingSignal(t)).toBe(true)
    },
  )
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

describe("fallback — family-aware, capped, and an honest floor", () => {
  test("prioritizes demand rhythm, then guest voice, capped at 2", () => {
    // T1: the rhythm family's floor is pinned via a pick override to
    // traffic.competitive_opportunity (info-severity by design, exempt from the warning
    // gate) — a plain traffic.* warning (e.g. weekend_shift) no longer selects it.
    const out = marketingSkill.fallback(
      dossier([
        { insight_type: "social.engagement_gap", title: "Short video is winning nearby", severity: "warning" },
        {
          insight_type: "review.theme",
          title: "Review theme: smash burger (positive)",
          severity: "info", // positive themes are info-severity; the praise pick is exempt from the warning gate
          evidence: { theme: "smash burger", sentiment: "positive", mentions: 9 },
        },
        {
          insight_type: "traffic.competitive_opportunity",
          title: "Gap in Friday 5pm demand, all competitors slow",
          severity: "info",
          evidence: { day: "Friday", hour: 17, competitor_count: 2 },
        },
      ]),
    )
    expect(out).toHaveLength(2)
    expect(out[0].evidenceRefs).toEqual(["traffic.competitive_opportunity"])
    expect(out[1].evidenceRefs).toEqual(["review.theme"])
  })

  test("guest-voice floor boundary: negative themes and rating diffs never trigger the praise play", () => {
    // A NEGATIVE theme is reputation@v2's fix-side floor; a rating diff is ambiguous-attribution.
    // Neither may select marketing's praise template (which would read as tone-deaf on a complaint).
    const out = marketingSkill.fallback(
      dossier([
        {
          insight_type: "review.theme",
          title: "Review theme: slow service (negative)",
          severity: "warning",
          evidence: { theme: "slow service", sentiment: "negative", mentions: 6 },
        },
        { insight_type: "rating.trend_down", title: "Rating slipped this month", severity: "warning" },
      ]),
    )
    expect(out).toEqual([])
  })

  test("emits nothing when no marketing-family signal exists (never fabricates)", () => {
    expect(marketingSkill.fallback(dossier([{ insight_type: "menu.price_change", title: "x", severity: "warning" }]))).toEqual([])
  })

  test("info-grade signals never produce a floor play (the quiet-week golden contract)", () => {
    const out = marketingSkill.fallback(
      dossier([
        { insight_type: "traffic.weekend_shift", title: "Friday early evening runs quiet", severity: "info" },
        { insight_type: "social.engagement_gap", title: "Short video is winning nearby", severity: "info" },
      ]),
    )
    expect(out).toEqual([])
  })

  test("an own-win seo signal never selects the conquest template, even at warning severity", () => {
    // amplify-the-win is a MODEL play with earned framing, not a canned floor template
    const out = marketingSkill.fallback(
      dossier([{ insight_type: "seo_organic_visibility_up", title: "Your search visibility is up", severity: "warning" }]),
    )
    expect(out).toEqual([])
  })

  test("a competitor-scoped seo signal does trigger the conquest floor play", () => {
    const out = marketingSkill.fallback(
      dossier([{ insight_type: "seo_new_competitor_ads_detected", title: "A rival started paid search on your category", severity: "warning" }]),
    )
    expect(out).toHaveLength(1)
    expect(out[0].evidenceRefs).toEqual(["seo_new_competitor_ads_detected"])
  })

  // T1: arming traffic.surge (previously dormant — the traffic pipeline hardcoded
  // previous:null) must not let the rhythm family's plain warning-gate fire off a
  // RIVAL's surge (misattribution: "sell your quiet window" grounded in a competitor's
  // traffic going UP). The rhythm family's floor is now pinned via a pick override to
  // traffic.competitive_opportunity — the one honest, set-wide sell-your-window signal.
  test("rhythm floor: a rival traffic.surge (warning) alone never triggers the sell-your-window play", () => {
    const out = marketingSkill.fallback(
      dossier([
        {
          insight_type: "traffic.surge",
          title: "O-Ku traffic surged on Fridays at 7pm",
          severity: "warning",
          evidence: { competitor_name: "O-Ku", day: "Friday", hour: 19, previous_score: 40, current_score: 75 },
        },
      ]),
    )
    expect(out).toEqual([])
  })

  test("rhythm floor: traffic.competitive_opportunity (info) fires exactly one rhythm play grounded on it", () => {
    const out = marketingSkill.fallback(
      dossier([
        {
          insight_type: "traffic.competitive_opportunity",
          title: "Gap in Tuesday 3pm demand, all competitors slow",
          severity: "info",
          evidence: { day: "Tuesday", hour: 15, competitor_count: 2 },
        },
      ]),
    )
    expect(out).toHaveLength(1)
    expect(out[0].evidenceRefs).toEqual(["traffic.competitive_opportunity"])
  })

  test("every fallback play passes the skill's own gates and the voice lint", () => {
    const out = marketingSkill.fallback(
      dossier([
        {
          insight_type: "traffic.competitive_opportunity",
          title: "Gap in Friday 5pm demand, all competitors slow",
          severity: "info",
          evidence: { day: "Friday", hour: 17, competitor_count: 2 },
        },
        {
          insight_type: "review.theme",
          title: "Review theme: smash burger (positive)",
          severity: "info",
          evidence: { theme: "smash burger", sentiment: "positive", mentions: 9 },
        },
        { insight_type: "photo.promotion_detected", title: "A rival posted a new promo", severity: "warning" },
        { insight_type: "social.engagement_gap", title: "Short video is winning nearby", severity: "warning" },
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
