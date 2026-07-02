import { describe, test, expect } from "vitest"
import type { Dossier } from "@/lib/insights/dossier/types"
import { lintVoice } from "@/lib/eval/voice-rules"
import {
  REPUTATION_ARCHETYPES,
  isReputationSignal,
  isTemplateAdvice,
  reputationSkill,
} from "@/lib/skills/reputation/skill"

// Minimal dossier: fallback() and parse() only touch ruleOutputs (+ location/competitors
// via selectInput, which these tests don't exercise). Real rule outputs always carry
// severity ("info" | "warning" | "critical") — the floor and the stance backstop gate on it.
const dossier = (ruleOutputs: { insight_type: string; title: string; severity?: string }[]) =>
  ({ ruleOutputs }) as unknown as Dossier

const step = {
  channel: "Google Business review replies",
  platforms: [],
  audience: "the guests who raised it and every future reader",
  window: { note: "this week" },
}

const rawPlay = (over: Record<string, unknown>) => ({
  title: "Fix the Friday wait your reviews keep naming",
  rationale: "Wait complaints cluster on the same window the traffic signal shows as your busiest.",
  recipe: [step],
  evidenceRefs: ["review.theme"],
  confidence: "medium",
  leverage: { label: "medium", basisInternal: "ordinal from the theme's mention weight" },
  ...over,
})

describe("isTemplateAdvice — generic, ceded, and policy-violating advice cannot survive", () => {
  test.each([
    "Act on what your reviews are telling you", // v1's literal fallback title
    "Reply to your reviews this week",
    "Respond to reviews within a day",
    "Respond to negative reviews promptly and professionally",
    "Thank your reviewers for the feedback",
    "Monitor your online reputation",
    "Keep an eye on your reviews",
    // the ceded earn-side — marketing owns the ask:
    "Ask for reviews at the register",
    "Ask happy customers to leave a review",
    "Get more reviews to boost your rating",
    // policy red lines — gating, incentives, scrubbing:
    "Only ask happy guests, not the upset ones",
    "Offer a free dessert for a review",
    "Remove negative reviews from your profile",
    // corporate-boilerplate response tells:
    "We take all feedback seriously",
    "We are sorry for your experience",
  ])("kills: %s", (text) => {
    expect(isTemplateAdvice(text)).toBe(true)
  })

  test.each([
    "Fix the complaint your reviews repeat, then show the fix",
    "Answer the three reviews naming the Friday wait with the exact change you made",
    "Respond to the guest who named the cold burger with the fix you made",
    "Flag the review that describes someone else's visit, and expect a slow answer",
    "Their reviews keep flagging slow service, and your speed is the claim to own",
    "Hand marketing the review ask once the wait complaints are fixed", // the urgency handoff must survive
  ])("allows a real play: %s", (text) => {
    expect(isTemplateAdvice(text)).toBe(false)
  })
})

describe("isReputationSignal — the widened intake covers every review-family rule output", () => {
  test.each([
    "rating_change",
    "weekly_rating_trend", // previously orphaned: v1's ["rating","review"] missed the weekly_ prefix
    "review_velocity_falling",
    "review_velocity_rising",
    "weekly_review_trend", // also previously orphaned
    "review.theme",
    "review_themes",
  ])("claims %s", (t) => {
    expect(isReputationSignal(t)).toBe(true)
  })

  test.each([
    "social.engagement_gap",
    "traffic.lull_detected",
    "hours_changed", // operations/marketing turf — NOT reputation's
    "menu.price_change",
    "seo_keyword_win",
    "events.local_festival",
  ])("leaves %s to siblings", (t) => {
    expect(isReputationSignal(t)).toBe(false)
  })
})

describe("REPUTATION_ARCHETYPES — stable feedback-learning keys", () => {
  test("6 archetypes, no duplicates", () => {
    expect(REPUTATION_ARCHETYPES.length).toBe(6)
    expect(new Set(REPUTATION_ARCHETYPES).size).toBe(REPUTATION_ARCHETYPES.length)
  })
})

describe("parse — domain grounding, the template kill-list, and deliberate stance", () => {
  const d = dossier([])

  test("unparseable model output returns null (triggers the deterministic fallback)", () => {
    expect(reputationSkill.parse("not json shaped", d)).toBeNull()
  })

  test("suppresses a play grounded only on non-reputation refs", () => {
    const out = reputationSkill.parse({ plays: [rawPlay({ evidenceRefs: ["traffic.lull_detected"] })] }, d)
    expect(out).toEqual([])
  })

  test("suppresses template advice even when grounded", () => {
    const out = reputationSkill.parse(
      { plays: [rawPlay({ title: "Reply to your reviews this week", evidenceRefs: ["review.theme"] })] },
      d,
    )
    expect(out).toEqual([])
  })

  test("suppresses policy-violating advice even when grounded", () => {
    const out = reputationSkill.parse(
      { plays: [rawPlay({ title: "Offer a free dessert for a review", evidenceRefs: ["review.theme"] })] },
      d,
    )
    expect(out).toEqual([])
  })

  test("keeps a grounded, non-template play and stamps identity", () => {
    const out = reputationSkill.parse({ plays: [rawPlay({})] }, d)
    expect(out).toHaveLength(1)
    expect(out![0].skillId).toBe("reputation")
    expect(out![0].knowledgeVersion).toBe("reputation@v2")
    expect(out![0].evidenceRefs).toEqual(["review.theme"])
  })

  test("stance backstop: an unset stance becomes fix when a cited ref is warning-grade", () => {
    const withWarning = dossier([
      { insight_type: "review.theme", title: "Review theme: slow service (negative)", severity: "warning" },
    ])
    const out = reputationSkill.parse({ plays: [rawPlay({})] }, withWarning)
    expect(out![0].stance).toBe("fix")
  })

  test("stance backstop resolves an evidence-key suffixed ref to its base rule", () => {
    const withWarning = dossier([
      { insight_type: "review.theme", title: "Review theme: slow service (negative)", severity: "warning" },
    ])
    const out = reputationSkill.parse({ plays: [rawPlay({ evidenceRefs: ["review.theme:examples"] })] }, withWarning)
    expect(out![0].stance).toBe("fix")
  })

  test("stance backstop: an unset stance becomes capture on info-grade refs", () => {
    const withInfo = dossier([
      { insight_type: "review_themes", title: "What reviewers say: Rival Cafe", severity: "info" },
    ])
    const out = reputationSkill.parse({ plays: [rawPlay({ evidenceRefs: ["review_themes"] })] }, withInfo)
    expect(out![0].stance).toBe("capture")
  })

  test("the model's deliberate stance is preserved (maintain stays maintain)", () => {
    const withWarning = dossier([
      { insight_type: "review.theme", title: "Review theme: slow service (negative)", severity: "warning" },
    ])
    const out = reputationSkill.parse({ plays: [rawPlay({ stance: "maintain" })] }, withWarning)
    expect(out![0].stance).toBe("maintain")
  })
})

describe("fallback — a narrow, severity-gated, honest floor", () => {
  test("fires exactly one fix-stance play on a warning-grade own review theme", () => {
    const out = reputationSkill.fallback(
      dossier([{ insight_type: "review.theme", title: "Review theme: slow service (negative)", severity: "warning" }]),
    )
    expect(out).toHaveLength(1)
    expect(out[0].stance).toBe("fix")
    expect(out[0].evidenceRefs).toEqual(["review.theme"])
    expect(out[0].knowledgeVersion).toBe("reputation@v2")
  })

  test("emits nothing when no reputation-family signal exists (never fabricates)", () => {
    expect(reputationSkill.fallback(dossier([]))).toEqual([])
    expect(
      reputationSkill.fallback(dossier([{ insight_type: "menu.price_change", title: "x", severity: "warning" }])),
    ).toEqual([])
  })

  test("info-grade themes never produce a floor play (the quiet-week golden contract)", () => {
    const out = reputationSkill.fallback(
      dossier([{ insight_type: "review.theme", title: "Review theme: friendly staff (positive)", severity: "info" }]),
    )
    expect(out).toEqual([])
  })

  test("a warning-grade rating change alone never triggers the floor (entity attribution is ambiguous)", () => {
    // rating_change / review_velocity rows are competitor-scoped diffs that don't name the
    // entity — the model path handles them with the attribution doctrine; the canned floor
    // must not claim "your rating fell" (v1's floor misattributed exactly this).
    const out = reputationSkill.fallback(
      dossier([
        { insight_type: "rating_change", title: "Rating decreased", severity: "warning" },
        { insight_type: "review_velocity_falling", title: "Review velocity changed", severity: "warning" },
      ]),
    )
    expect(out).toEqual([])
  })

  test("competitor theme summaries (info) never trigger the floor", () => {
    const out = reputationSkill.fallback(
      dossier([{ insight_type: "review_themes", title: "What reviewers say: Rival Cafe", severity: "info" }]),
    )
    expect(out).toEqual([])
  })

  test("the floor is capped at one play even with several warning themes", () => {
    const out = reputationSkill.fallback(
      dossier([
        { insight_type: "review.theme", title: "Review theme: slow service (negative)", severity: "warning" },
        { insight_type: "review.theme", title: "Review theme: cold food (negative)", severity: "warning" },
      ]),
    )
    expect(out).toHaveLength(1)
  })

  test("the floor play passes the skill's own gates and the voice lint (self-consistency)", () => {
    const out = reputationSkill.fallback(
      dossier([{ insight_type: "review.theme", title: "Review theme: slow service (negative)", severity: "warning" }]),
    )
    expect(out.length).toBeGreaterThan(0)
    for (const p of out) {
      // self-consistency: the floor must survive the same gates parse() applies to the model
      expect(p.evidenceRefs.some(isReputationSignal)).toBe(true)
      const text = `${p.title} ${p.rationale} ${p.recipe
        .map((s) => `${s.audience} ${s.channel} ${s.creativeDirection ?? ""}`)
        .join(" ")}`
      expect(isTemplateAdvice(text)).toBe(false)
      // v1's canned reply draft is gone: the floor never ships paste-anywhere response copy
      expect(p.recipe.every((s) => s.copy === undefined)).toBe(true)
      // number-free floor: no fabricated figures in the static play title
      expect(/\d/.test(p.title)).toBe(false)
      expect(p.knowledgeVersion).toBe("reputation@v2")
      // brand voice: no em dashes, no kitchen lingo, anywhere in customer-facing text
      for (const s of [
        p.title,
        p.rationale,
        ...p.recipe.flatMap((r) => [r.audience, r.channel, r.window.note, ...(r.dependencies ?? [])]),
      ]) {
        expect(lintVoice(s)).toEqual([])
      }
    }
  })
})
