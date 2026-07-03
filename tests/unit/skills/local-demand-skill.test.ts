import { describe, test, expect } from "vitest"
import type { Dossier } from "@/lib/insights/dossier/types"
import { lintVoice } from "@/lib/eval/voice-rules"
import {
  LOCAL_DEMAND_ARCHETYPES,
  isLocalDemandSignal,
  isTemplateAdvice,
  localDemandSkill,
} from "@/lib/skills/local-demand/skill"

// Minimal dossier: fallback() touches ruleOutputs + profile.attributes.hasPatio (the
// concept gate for the patio floor play); parse() touches ruleOutputs. Real rule
// outputs always carry severity ("info" | "warning" | "critical") — the floor and the
// stance backstop gate on it.
const dossier = (
  ruleOutputs: { insight_type: string; title: string; severity?: string }[],
  opts?: { hasPatio?: boolean },
) =>
  ({
    ruleOutputs,
    profile: { attributes: { hasPatio: opts?.hasPatio ?? false } },
  }) as unknown as Dossier

const step = {
  channel: "in-store service plan + order-ahead",
  platforms: [],
  audience: "the pre-show crowd on a hard deadline",
  window: { note: "Friday, from five thirty until curtain" },
}

const rawPlay = (over: Record<string, unknown>) => ({
  title: "Hold the pre-show express run for the Friday curtain",
  rationale: "The show two blocks over starts at eight; promise seated by six, out by seven thirty, three dishes, no decisions.",
  recipe: [step],
  evidenceRefs: ["events.major_lobby_surge"],
  confidence: "medium",
  leverage: { label: "medium", basisInternal: "ordinal from the event signal's validated window" },
  ...over,
})

describe("isTemplateAdvice — the event-heads-up class and parroted canned recs cannot survive", () => {
  test.each([
    "Prepare for the demand this signal points to", // v1's literal floor title #1
    "Capture the crowd this signal brings", // v1's literal floor title #2
    "Right by the action tonight. Come in before or after.", // v1's literal canned copy
    "Prepare for the crowd this weekend",
    "Prepare for the rush the game will bring",
    "Get your team ready before it lands", // v1's literal floor rationale
    "Be ready for the surge on Friday",
    "Brace for the influx of event traffic",
    "Capture the crowd before it arrives", // buildSurgeInsight's literal canned rec
    "Capture the foot traffic from the festival",
    "A limited-time offer could convert foot traffic into new customers", // weekend-spike rule's canned rec
    "Staff up for the event",
    "Adjust staffing for Friday", // dense-day rule's literal canned rec
    "Review scheduling to ensure you are prepared for higher demand", // same source
    "Run a weekend special at your restaurant", // weekend-spike rule's canned rec
    "Post on social media before the weekend", // same source
    "Consider a themed promotion around the event", // new-high-signal rule's canned rec
    "Run a counter-promotion to capture overflow", // competitor-hosting rule's canned rec (marketing's lane)
  ])("kills: %s", (text) => {
    expect(isTemplateAdvice(text)).toBe(true)
  })

  test.each([
    // the bar: the timed window + mechanism play survives
    "The arena empties at nine forty; hold four tables and run the short menu from nine thirty",
    "Promise ticket holders seated by six, fed, and out the door by seven thirty",
    "Move one person from the dining room to packing delivery orders before Thursday's storm",
    "Post how to reach you and where to park the day before the street closure",
    "Set the patio before the window opens and keep it walk-in friendly",
    "Hold your bar seating for the let-out wave and quote honest waits at the door",
    "Put a QR signup on every table for the one night these guests are in the building",
  ])("allows a real play: %s", (text) => {
    expect(isTemplateAdvice(text)).toBe(false)
  })
})

describe("isLocalDemandSignal — verified intake: the demand family, minus the ceded competitor events", () => {
  test.each([
    "events.major_lobby_surge",
    "events.access_suppression",
    "events.upcoming_dense_day",
    "events.weekend_density_spike",
    "events.new_high_signal_event",
    "visual.weather_patio",
    "traffic.weather_suppression", // the storm signal — v1's "weather" prefix never matched it
    "cross_event_seo_opportunity",
    "events.major_lobby_surge:pct_lift", // type:key refs resolve too
  ])("claims %s", (t) => {
    expect(isLocalDemandSignal(t)).toBe(true)
  })

  test.each([
    "events.competitor_hosting_event", // CEDED: marketing's conquest lane
    "events.competitor_event_cadence_up", // CEDED: same
    "traffic.surge", // operations' turf (a rival's curve, not a dated window)
    "traffic.baseline",
    "hours_changed",
    "social.posting_frequency_gap",
    "review.theme",
    "menu.price_positioning_shift",
    "seo_organic_visibility_up",
  ])("leaves %s to siblings", (t) => {
    expect(isLocalDemandSignal(t)).toBe(false)
  })
})

describe("LOCAL_DEMAND_ARCHETYPES — stable feedback-learning keys", () => {
  test("7 archetypes, no duplicates", () => {
    expect(LOCAL_DEMAND_ARCHETYPES.length).toBe(7)
    expect(new Set(LOCAL_DEMAND_ARCHETYPES).size).toBe(LOCAL_DEMAND_ARCHETYPES.length)
  })
})

describe("parse — domain grounding, the template kill-list, and deliberate stance", () => {
  const d = dossier([])

  test("unparseable model output returns null (triggers the deterministic fallback)", () => {
    expect(localDemandSkill.parse("not json shaped", d)).toBeNull()
  })

  test("suppresses a play grounded only on non-demand refs", () => {
    const out = localDemandSkill.parse({ plays: [rawPlay({ evidenceRefs: ["traffic.surge"] })] }, d)
    expect(out).toEqual([])
  })

  test("suppresses a play grounded only on the ceded competitor-event refs", () => {
    const out = localDemandSkill.parse(
      { plays: [rawPlay({ evidenceRefs: ["events.competitor_hosting_event"] })] },
      d,
    )
    expect(out).toEqual([])
  })

  test("suppresses template advice even when grounded", () => {
    const out = localDemandSkill.parse(
      { plays: [rawPlay({ title: "Prepare for the crowd this signal brings", evidenceRefs: ["events.major_lobby_surge"] })] },
      d,
    )
    expect(out).toEqual([])
  })

  test("suppresses a parroted canned rule recommendation even when grounded", () => {
    const out = localDemandSkill.parse(
      { plays: [rawPlay({ title: "Capture the crowd before it arrives", evidenceRefs: ["events.major_lobby_surge"] })] },
      d,
    )
    expect(out).toEqual([])
  })

  test("keeps a grounded, non-template play and stamps identity", () => {
    const out = localDemandSkill.parse({ plays: [rawPlay({})] }, d)
    expect(out).toHaveLength(1)
    expect(out![0].skillId).toBe("local-demand")
    expect(out![0].knowledgeVersion).toBe("local-demand@v2")
    expect(out![0].evidenceRefs).toEqual(["events.major_lobby_surge"])
  })

  test("stance backstop: an unset stance becomes fix when a cited ref is warning-grade", () => {
    const withWarning = dossier([
      { insight_type: "events.access_suppression", title: "Drive-thru/lot access at risk: the arena", severity: "warning" },
    ])
    const out = localDemandSkill.parse(
      { plays: [rawPlay({ evidenceRefs: ["events.access_suppression"] })] },
      withWarning,
    )
    expect(out![0].stance).toBe("fix")
  })

  test("stance backstop resolves an evidence-key suffixed ref to its base rule", () => {
    const withCritical = dossier([
      { insight_type: "events.major_lobby_surge", title: "Major event nearby", severity: "critical" },
    ])
    const out = localDemandSkill.parse(
      { plays: [rawPlay({ evidenceRefs: ["events.major_lobby_surge:pct_lift"] })] },
      withCritical,
    )
    expect(out![0].stance).toBe("fix")
  })

  test("stance backstop: an unset stance becomes capture on info-grade refs", () => {
    const withInfo = dossier([
      { insight_type: "events.new_high_signal_event", title: "New notable event nearby", severity: "info" },
    ])
    const out = localDemandSkill.parse(
      { plays: [rawPlay({ evidenceRefs: ["events.new_high_signal_event"] })] },
      withInfo,
    )
    expect(out![0].stance).toBe("capture")
  })

  test("the model's deliberate stance is preserved (maintain stays maintain)", () => {
    const withWarning = dossier([
      { insight_type: "events.major_lobby_surge", title: "Major event nearby", severity: "warning" },
    ])
    const out = localDemandSkill.parse({ plays: [rawPlay({ stance: "maintain" })] }, withWarning)
    expect(out![0].stance).toBe("maintain")
  })
})

describe("fallback — a narrow, severity-gated floor: at most 2 plays TOTAL, never two per signal", () => {
  const surgeWarning = { insight_type: "events.major_lobby_surge", title: "Major event nearby: a scheduled match", severity: "warning" }
  const accessWarning = { insight_type: "events.access_suppression", title: "Drive-thru/lot access at risk: the arena", severity: "warning" }
  const patioInfo = { insight_type: "visual.weather_patio", title: "Warm weather patio opportunity", severity: "info" }

  test("a warning-grade surge signal yields exactly ONE play (v1's two-per-signal doubling is dead)", () => {
    const out = localDemandSkill.fallback(dossier([surgeWarning]))
    expect(out).toHaveLength(1)
    expect(out[0].stance).toBe("capture")
    expect(out[0].kind).toBe("prepare")
    expect(out[0].evidenceRefs).toEqual(["events.major_lobby_surge"])
    expect(out[0].knowledgeVersion).toBe("local-demand@v2")
  })

  test("the access-risk signal yields one FIX-stance play (a road closure is a demand risk)", () => {
    const out = localDemandSkill.fallback(dossier([accessWarning]))
    expect(out).toHaveLength(1)
    expect(out[0].stance).toBe("fix")
    expect(out[0].evidenceRefs).toEqual(["events.access_suppression"])
  })

  test("surge + access together yield two DIFFERENT plays, one per signal", () => {
    const out = localDemandSkill.fallback(dossier([surgeWarning, accessWarning]))
    expect(out).toHaveLength(2)
    expect(out[0].evidenceRefs).toEqual(["events.major_lobby_surge"])
    expect(out[1].evidenceRefs).toEqual(["events.access_suppression"])
    expect(out[0].title).not.toBe(out[1].title)
  })

  test("the floor is capped at 2 even when surge, access, and patio all fire", () => {
    const out = localDemandSkill.fallback(dossier([surgeWarning, accessWarning, patioInfo], { hasPatio: true }))
    expect(out).toHaveLength(2)
    expect(out.map((p) => p.evidenceRefs[0])).toEqual(["events.major_lobby_surge", "events.access_suppression"])
  })

  test("an info-grade keyword event never produces a floor play (info is that rule's ceiling by construction)", () => {
    const out = localDemandSkill.fallback(
      dossier([{ insight_type: "events.new_high_signal_event", title: "New notable event nearby", severity: "info" }]),
    )
    expect(out).toEqual([])
  })

  test("an info-grade dense day never produces a floor play (the severity gate holds)", () => {
    const out = localDemandSkill.fallback(
      dossier([{ insight_type: "events.upcoming_dense_day", title: "Eight events on Friday", severity: "info" }]),
    )
    expect(out).toEqual([])
  })

  test("a warning-grade dense day IS an unambiguous dated demand window and gets the floor play", () => {
    const out = localDemandSkill.fallback(
      dossier([{ insight_type: "events.upcoming_dense_day", title: "A packed Friday near you", severity: "warning" }]),
    )
    expect(out).toHaveLength(1)
    expect(out[0].evidenceRefs).toEqual(["events.upcoming_dense_day"])
  })

  test("a critical surge outranks a warning dense day; type priority breaks severity ties", () => {
    const critDense = { insight_type: "events.upcoming_dense_day", title: "A packed Friday near you", severity: "critical" }
    const warnSurge = { insight_type: "events.major_lobby_surge", title: "Major event nearby", severity: "warning" }
    const bySeverity = localDemandSkill.fallback(dossier([warnSurge, critDense]))
    expect(bySeverity[0].evidenceRefs).toEqual(["events.upcoming_dense_day"])
    const warnDense = { ...critDense, severity: "warning" }
    const byPriority = localDemandSkill.fallback(dossier([warnDense, warnSurge]))
    expect(byPriority[0].evidenceRefs).toEqual(["events.major_lobby_surge"])
  })

  test("ceded competitor-event signals never trigger the floor, even at warning grade", () => {
    const out = localDemandSkill.fallback(
      dossier([
        { insight_type: "events.competitor_hosting_event", title: "A rival is hosting an event", severity: "warning" },
        { insight_type: "events.competitor_event_cadence_up", title: "A rival is ramping events", severity: "warning" },
      ]),
    )
    expect(out).toEqual([])
  })

  test("the patio window fires ONLY with the profile's own patio flag (the signal's photo proxy is competitor photos)", () => {
    const withPatio = localDemandSkill.fallback(dossier([patioInfo], { hasPatio: true }))
    expect(withPatio).toHaveLength(1)
    expect(withPatio[0].evidenceRefs).toEqual(["visual.weather_patio"])
    expect(withPatio[0].stance).toBe("capture")
    const withoutPatio = localDemandSkill.fallback(dossier([patioInfo], { hasPatio: false }))
    expect(withoutPatio).toEqual([])
  })

  test("storm notes and cross-demand corroboration never manufacture a floor play", () => {
    const out = localDemandSkill.fallback(
      dossier([
        { insight_type: "traffic.weather_suppression", title: "Severe weather today", severity: "info" },
        { insight_type: "cross_event_seo_opportunity", title: "Event-driven traffic opportunity detected", severity: "info" },
      ]),
    )
    expect(out).toEqual([])
  })

  test("emits nothing when no demand-family signal exists (a quiet week stays quiet)", () => {
    expect(localDemandSkill.fallback(dossier([]))).toEqual([])
    expect(
      localDemandSkill.fallback(dossier([{ insight_type: "seo_organic_visibility_up", title: "x", severity: "info" }])),
    ).toEqual([])
  })

  test("floor plays pass the skill's own gates, ship no canned customer copy, and stay number-free and voice-clean", () => {
    const out = localDemandSkill.fallback(dossier([surgeWarning, accessWarning, patioInfo], { hasPatio: true }))
    expect(out.length).toBeGreaterThan(0)
    for (const p of out) {
      // self-consistency: the floor must survive the same gates parse() applies to the model
      expect(p.evidenceRefs.some(isLocalDemandSignal)).toBe(true)
      const text = `${p.title} ${p.rationale} ${p.recipe
        .map((s) => `${s.audience} ${s.channel} ${s.offer ?? ""} ${s.copy ?? ""} ${s.creativeDirection ?? ""}`)
        .join(" ")}`
      expect(isTemplateAdvice(text)).toBe(false)
      // v1's canned copy ("Right by the action tonight...") is gone: the floor never
      // ships paste-anywhere customer copy at all
      expect(p.recipe.every((s) => s.copy === undefined)).toBe(true)
      // number-free floor: no fabricated figures anywhere in the play text (fixture titles are digit-free)
      expect(/\d/.test(text)).toBe(false)
      expect(p.knowledgeVersion).toBe("local-demand@v2")
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
