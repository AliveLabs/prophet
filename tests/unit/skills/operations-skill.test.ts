import { describe, test, expect } from "vitest"
import type { Dossier } from "@/lib/insights/dossier/types"
import { lintVoice, CHEF_LINGO } from "@/lib/eval/voice-rules"
import {
  OPERATIONS_ARCHETYPES,
  isOperationsSignal,
  isTemplateAdvice,
  operationsSkill,
} from "@/lib/skills/operations/skill"
import { OPERATIONS_KNOWLEDGE } from "@/lib/skills/operations/knowledge"

// Minimal dossier: fallback() and parse() only touch ruleOutputs (+ location/competitors
// via selectInput, which these tests don't exercise). Real rule outputs always carry
// severity ("info" | "warning" | "critical") — the floor and the stance backstop gate on it.
const dossier = (ruleOutputs: { insight_type: string; title: string; severity?: string }[]) =>
  ({ ruleOutputs }) as unknown as Dossier

const step = {
  channel: "scheduling",
  platforms: [],
  audience: "your team working Friday's shifts",
  window: { note: "Friday evening, next few weeks" },
}

const rawPlay = (over: Record<string, unknown>) => ({
  title: "Add a runner for the Friday evening peak window",
  rationale: "The rival surge and your own curve agree the rush lands later now; food is ready but not reaching tables.",
  recipe: [step],
  evidenceRefs: ["traffic.surge"],
  confidence: "medium",
  leverage: { label: "medium", basisInternal: "ordinal from the window shift" },
  ...over,
})

describe("isTemplateAdvice — the bare-staffing template class cannot survive", () => {
  test.each([
    "Staff to the demand this pattern shows", // v1's literal fallback title
    "Staff to the curve this week",
    "Staff up for this surge",
    "Staff up for the weekend rush",
    "Add more staff for Friday nights",
    "Schedule extra staff during peak hours",
    "Make sure you are staffed for the dinner rush",
    "Make sure you're properly staffed this weekend",
    "Ensure adequate staffing during the surge",
    "Adjust your staffing levels to the pattern",
    "Increase staffing during peak hours",
    "Match labor to the demand", // v1's fallback rationale class
    "Prepare for increased demand this weekend",
    "Be ready for the rush",
    // marketing's lane — an operations play never sells the window:
    "Run a Tuesday afternoon special to fill the slow window",
    "Offer a happy hour discount in the quiet stretch",
    "Consider a targeted promotion at 3pm", // the traffic rules' own canned rec phrasing
    "Consider targeting Friday 6pm with a competing offer", // same source (traffic.surge)
  ])("kills: %s", (text) => {
    expect(isTemplateAdvice(text)).toBe(true)
  })

  test.each([
    "Add a runner Friday 6-8pm; your peak outruns the kitchen's hands, not its burners", // the bar
    "Slide one closer's start an hour later on Fridays and put one person on running food",
    "Stop seating the dead last hour on Mondays and bank the labor",
    "Close an hour earlier on Mondays for a month and move the prep into the earlier lull",
    "Make Tuesday afternoon the production window that pre-builds Friday's rush",
    "Write a hold-then-release rule for no-show reservations and use it every night",
    "Re-point your strongest coverage at the window that moved", // the floor title must survive
    "Hand the quiet Tuesday window to the marketing expert to sell",
  ])("allows a real play: %s", (text) => {
    expect(isTemplateAdvice(text)).toBe(false)
  })
})

describe("isOperationsSignal — the intake covers every verified operations-family rule output", () => {
  test.each([
    "traffic.baseline",
    "traffic.surge",
    "traffic.peak_shift",
    "traffic.extended_busy",
    "traffic.new_slow_period",
    "traffic.competitive_opportunity",
    "traffic.weather_suppression",
    "hours_changed",
  ])("claims %s", (t) => {
    expect(isOperationsSignal(t)).toBe(true)
  })

  test("resolves an evidence-key suffixed ref via prefix match", () => {
    expect(isOperationsSignal("traffic.surge:day")).toBe(true)
    expect(isOperationsSignal("hours_changed:field")).toBe(true)
  })

  test.each([
    "social.engagement_gap",
    "rating_change",
    "review.theme",
    "weekly_review_trend",
    "menu.price_change",
    "seo_keyword_win",
    "events.local_festival",
    "weather_forecast", // local-demand's weather prefix is NOT hours/traffic turf
  ])("leaves %s to siblings", (t) => {
    expect(isOperationsSignal(t)).toBe(false)
  })
})

describe("OPERATIONS_ARCHETYPES — stable feedback-learning keys", () => {
  test("6 archetypes, no duplicates", () => {
    expect(OPERATIONS_ARCHETYPES.length).toBe(6)
    expect(new Set(OPERATIONS_ARCHETYPES).size).toBe(OPERATIONS_ARCHETYPES.length)
  })
})

describe("parse — domain grounding, the template kill-list, and deliberate stance", () => {
  const d = dossier([])

  test("unparseable model output returns null (triggers the deterministic fallback)", () => {
    expect(operationsSkill.parse("not json shaped", d)).toBeNull()
  })

  test("suppresses a play grounded only on non-operations refs", () => {
    const out = operationsSkill.parse({ plays: [rawPlay({ evidenceRefs: ["menu.price_change"] })] }, d)
    expect(out).toEqual([])
  })

  test("suppresses bare staffing advice even when grounded", () => {
    const out = operationsSkill.parse(
      { plays: [rawPlay({ title: "Staff up for this surge", evidenceRefs: ["traffic.surge"] })] },
      d,
    )
    expect(out).toEqual([])
  })

  test("suppresses v1's literal fallback title even when grounded", () => {
    const out = operationsSkill.parse(
      { plays: [rawPlay({ title: "Staff to the demand this pattern shows", evidenceRefs: ["traffic.surge"] })] },
      d,
    )
    expect(out).toEqual([])
  })

  test("suppresses sell-the-window advice even when grounded (marketing's lane)", () => {
    const out = operationsSkill.parse(
      {
        plays: [
          rawPlay({
            title: "Run a Tuesday special in the dead window",
            evidenceRefs: ["traffic.competitive_opportunity"],
          }),
        ],
      },
      d,
    )
    expect(out).toEqual([])
  })

  test("keeps a grounded, window+position play and stamps identity", () => {
    const out = operationsSkill.parse({ plays: [rawPlay({})] }, d)
    expect(out).toHaveLength(1)
    expect(out![0].skillId).toBe("operations")
    expect(out![0].knowledgeVersion).toBe("operations@v2")
    expect(out![0].kind).toBe("ops")
    expect(out![0].ownerRole).toBe("gm")
    expect(out![0].evidenceRefs).toEqual(["traffic.surge"])
  })

  test("stance backstop: an unset stance becomes fix when a cited ref is warning-grade", () => {
    const withWarning = dossier([
      { insight_type: "traffic.surge", title: "Rival traffic surged on Fridays at 6pm", severity: "warning" },
    ])
    const out = operationsSkill.parse({ plays: [rawPlay({})] }, withWarning)
    expect(out![0].stance).toBe("fix")
  })

  test("stance backstop resolves an evidence-key suffixed ref to its base rule", () => {
    const withWarning = dossier([
      { insight_type: "traffic.surge", title: "Rival traffic surged on Fridays at 6pm", severity: "warning" },
    ])
    const out = operationsSkill.parse({ plays: [rawPlay({ evidenceRefs: ["traffic.surge:day"] })] }, withWarning)
    expect(out![0].stance).toBe("fix")
  })

  test("stance backstop: an unset stance becomes capture on info-grade refs", () => {
    const withInfo = dossier([
      { insight_type: "traffic.baseline", title: "Rival traffic patterns captured", severity: "info" },
    ])
    const out = operationsSkill.parse({ plays: [rawPlay({ evidenceRefs: ["traffic.baseline"] })] }, withInfo)
    expect(out![0].stance).toBe("capture")
  })

  test("the model's deliberate stance is preserved (maintain stays maintain)", () => {
    const withWarning = dossier([
      { insight_type: "traffic.surge", title: "Rival traffic surged on Fridays at 6pm", severity: "warning" },
    ])
    const out = operationsSkill.parse({ plays: [rawPlay({ stance: "maintain" })] }, withWarning)
    expect(out![0].stance).toBe("maintain")
  })
})

describe("fallback — a narrow, severity-gated, rival-attributed honest floor", () => {
  test("fires exactly one fix-stance play on a warning-grade rival window shift", () => {
    const out = operationsSkill.fallback(
      dossier([
        { insight_type: "traffic.surge", title: "Bachi Box traffic surged on Fridays at 6pm", severity: "warning" },
      ]),
    )
    expect(out).toHaveLength(1)
    expect(out[0].stance).toBe("fix")
    expect(out[0].kind).toBe("ops")
    expect(out[0].ownerRole).toBe("gm")
    expect(out[0].evidenceRefs).toEqual(["traffic.surge"])
    expect(out[0].knowledgeVersion).toBe("operations@v2")
    // the rival attribution rides in via the quoted signal title; the canned text
    // itself never claims "your traffic" anything
    expect(out[0].rationale).toContain("Bachi Box traffic surged on Fridays at 6pm")
    expect(out[0].rationale.toLowerCase()).not.toContain("your traffic")
  })

  test("emits nothing when no operations-family signal exists (never fabricates)", () => {
    expect(operationsSkill.fallback(dossier([]))).toEqual([])
    expect(
      operationsSkill.fallback(dossier([{ insight_type: "menu.price_change", title: "x", severity: "warning" }])),
    ).toEqual([])
  })

  test("info-grade rival shifts never produce a floor play (the quiet-week golden contract)", () => {
    const out = operationsSkill.fallback(
      dossier([
        { insight_type: "traffic.peak_shift", title: "Rival's Friday peak shifted", severity: "info" },
        { insight_type: "traffic.extended_busy", title: "Rival staying busier longer", severity: "info" },
      ]),
    )
    expect(out).toEqual([])
  })

  test("a baseline capture never triggers the floor, even at warning severity (v1's defect)", () => {
    // v1's floor served its staffing template off info-grade baseline captures of a
    // RIVAL's curve — the misattribution class. A baseline is a first look, not a move.
    const out = operationsSkill.fallback(
      dossier([{ insight_type: "traffic.baseline", title: "Rival traffic patterns captured", severity: "warning" }]),
    )
    expect(out).toEqual([])
  })

  test("a set-wide quiet gap never triggers the floor (marketing's window to sell)", () => {
    const out = operationsSkill.fallback(
      dossier([
        { insight_type: "traffic.competitive_opportunity", title: "Gap: Tuesday 3pm, all competitors slow", severity: "warning" },
      ]),
    )
    expect(out).toEqual([])
  })

  test("a rival going quiet never triggers the floor (no honest canned ops move exists)", () => {
    const out = operationsSkill.fallback(
      dossier([
        { insight_type: "traffic.new_slow_period", title: "Rival showing reduced traffic on Tuesdays", severity: "warning" },
      ]),
    )
    expect(out).toEqual([])
  })

  test("a rival's hours change never triggers the floor (entity/detail-free row needs the model's read)", () => {
    const out = operationsSkill.fallback(
      dossier([{ insight_type: "hours_changed", title: "Hours updated", severity: "warning" }]),
    )
    expect(out).toEqual([])
  })

  test("a weather-suppression note never triggers the floor (weather context, not a rival move)", () => {
    const out = operationsSkill.fallback(
      dossier([
        { insight_type: "traffic.weather_suppression", title: "Severe weather, traffic insights adjusted", severity: "warning" },
      ]),
    )
    expect(out).toEqual([])
  })

  test("the floor is capped at one play even with several warning shifts", () => {
    const out = operationsSkill.fallback(
      dossier([
        { insight_type: "traffic.surge", title: "Bachi Box traffic surged on Fridays at 6pm", severity: "warning" },
        { insight_type: "traffic.surge", title: "O-Ku traffic surged on Saturdays at 7pm", severity: "warning" },
      ]),
    )
    expect(out).toHaveLength(1)
  })

  test("the floor play passes the skill's own gates and the voice lint (self-consistency)", () => {
    const out = operationsSkill.fallback(
      dossier([
        { insight_type: "traffic.surge", title: "Bachi Box traffic surged on Fridays at 6pm", severity: "warning" },
      ]),
    )
    expect(out.length).toBeGreaterThan(0)
    for (const p of out) {
      // self-consistency: the floor must survive the same gates parse() applies to the model
      expect(p.evidenceRefs.some(isOperationsSignal)).toBe(true)
      const text = `${p.title} ${p.rationale} ${p.recipe
        .map((s) => `${s.audience} ${s.channel} ${s.offer ?? ""} ${s.copy ?? ""} ${s.creativeDirection ?? ""}`)
        .join(" ")}`
      expect(isTemplateAdvice(text)).toBe(false)
      // the floor never ships customer-facing copy or an offer (nothing to sell here)
      expect(p.recipe.every((s) => s.copy === undefined && s.offer === undefined)).toBe(true)
      // number-free floor: no fabricated figures in the static play title
      expect(/\d/.test(p.title)).toBe(false)
      expect(p.knowledgeVersion).toBe("operations@v2")
      // brand voice: no em dashes, no kitchen lingo, anywhere in operator-facing text
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

describe("the playbook itself", () => {
  test("is free of the banned kitchen lingo (the machine-checkable deny-list)", () => {
    for (const { term } of CHEF_LINGO) {
      expect(OPERATIONS_KNOWLEDGE.match(term)).toBeNull()
    }
  })

  test("stays well inside the prompt token budget", () => {
    // guerrilla precedent: ~40k chars of prompt at medium effort silently times out.
    // The playbook is the largest fixed block; keep it comfortably small.
    expect(OPERATIONS_KNOWLEDGE.length).toBeLessThan(20000)
  })

  test("names v1's fallback title as the anti-pattern and teaches the window+position bar", () => {
    expect(OPERATIONS_KNOWLEDGE).toContain("Staff to the demand this pattern shows")
    expect(OPERATIONS_KNOWLEDGE).toContain("WINDOW + POSITION + REASON")
  })
})
