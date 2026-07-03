// buildPrompt smoke + size regression — guerrilla's built prompt must stay inside the token budget
// so the producer can run at medium effort without tripping the ~120s timeout that silently degrades
// it to the number-free fallback. Mirrors positioning-prompt-smoke.test.ts.
//
// HISTORY (M11, 2026-07-03): guerrilla was pinned to effort "low" on the belief its prompt was
// "~40k chars". That figure was stale — the P16 refactor already distilled selectInput to slim
// per-archetype anchor summaries, so the real built prompt is ~20.9k (bare) / ~26.4k (rich: a full
// partner catalog + dated events + a check-average signal), the SMALLEST of the six producers and
// below the ~26-32k band the five mastered siblings run at medium without timing out. This test locks
// the ceiling so the prompt can never silently re-bloat past the hazard again.
//
// Run via the mirror harness with guerrilla@v2.2 aliased in (repo untouched).

import { describe, test, expect } from "vitest"
import { guerrillaMarketingSkill } from "@/lib/skills/guerrilla-marketing/skill"
import { competitiveWeekDossier } from "@/tests/fixtures/dossiers/competitive-week"
import type { Dossier, PartnerEntitySummary } from "@/lib/insights/dossier/types"
import type { GeneratedInsight } from "@/lib/insights/types"
import type { NormalizedEvent } from "@/lib/events/types"

// The timeout-safe ceiling: guerrilla's heaviest realistic prompt (~26.4k) plus headroom, still well
// under the ~32k the largest passing sibling (positioning) runs at medium. If a future edit pushes the
// prompt past this, the fix is to tighten the knowledge prose, NOT to re-pin effort to "low".
const PROMPT_SIZE_CEILING = 34_000

function partner(name: string, partnerType: string, partnerLabel: string, sizeBand = "medium"): PartnerEntitySummary {
  return { name, partnerType, partnerLabel, distanceMi: 0.8, sizeBand, sizeProxyLow: 40, sizeProxyHigh: 60, sizeProxyKind: "enrollment band" }
}
function sig(insight_type: string, title = insight_type, evidence: Record<string, unknown> = {}): GeneratedInsight {
  return { insight_type, title, summary: "A representative rule-output summary line for the dossier body.", confidence: "medium", severity: "info", evidence, recommendations: [] }
}
function datedEvent(title: string, when = "2026-07-04T11:00:00Z"): NormalizedEvent {
  return { uid: title, title, startDatetime: when, venue: { name: title }, distanceMiles: 0.3, magnitude: "moderate", role: "local_foot", source: "dataforseo_google_events", keyword: "events", dateRange: "week" } as NormalizedEvent
}

// The heaviest realistic dossier: a partner in every archetype's type set + dated events + a
// check-average price signal (which loads the scaled spirit-night economics into selectInput).
function richDossier(): Dossier {
  return {
    ...competitiveWeekDossier,
    ruleOutputs: [
      sig("traffic.new_slow_period", "Tuesday nights went quiet"),
      sig("events.new_high_signal_event", "Street festival two blocks away Saturday"),
      sig("social.crowd_perception_gap", "Locals do not realize how busy you get"),
      sig("menu.price_positioning_shift", "price", { locationAvgPrice: 18.5 }),
    ],
    partnerEntities: [
      partner("Forney High School", "school", "school / PTA", "large"),
      partner("Rockwall Elementary", "school", "school / PTA", "medium"),
      partner("Pinnacle Tower Offices", "office", "office / coworking"),
      partner("Baylor Scott Clinic", "hospital", "hospital / clinic"),
      partner("Iron Peak Gym", "gym", "gym"),
      partner("Backyard Brewery", "brewery", "brewery / taproom"),
      partner("Grace Community Church", "church", "church"),
      partner("Forney Youth Soccer", "youth_sports", "youth sports league"),
      partner("Prestige Motors", "dealership", "car dealership"),
      partner("Downtown Cinema", "theater", "movie theater"),
    ],
    demandCalendar: {
      ...competitiveWeekDossier.demandCalendar,
      events: [datedEvent("July 4th Street Fair"), datedEvent("Downtown Summer Concert", "2026-07-11T18:00:00Z")],
    },
  }
}

describe("buildPrompt smoke (guerrilla@v2.2)", () => {
  test("bare dossier: compact prompt, playbook + core rule present", () => {
    const { systemCached = "", system, prompt } = guerrillaMarketingSkill.buildPrompt(competitiveWeekDossier)
    // the playbook rides in the cached prefix
    expect(systemCached).toContain("NAME THE ANCHOR OR DON'T SPEAK")
    expect(systemCached).toContain("SPIRIT NIGHT")
    // T6: the engine-wide AUDIENCE_FRAME rides in the cached prefix for every producer.
    expect(systemCached).toContain("WHO YOU ARE WRITING FOR")
    expect(systemCached).toContain("SHOW the move; never JUSTIFY it to a peer")
    // T6: the guerrilla knowledge carries the WRITE FOR THE OWNER closer + the fixed band line.
    expect(systemCached).toContain("WRITE FOR THE OWNER")
    expect(systemCached).not.toContain("a larger enrollment band scales up")
    // no partners/events → the anchor arrays in the user prompt are empty
    expect(prompt).toContain('"spiritNightAnchors": []')
    const total = systemCached.length + system.length + prompt.length
    console.log(`[smoke] bare prompt chars: system=${systemCached.length + system.length} user=${prompt.length} total=${total}`)
    expect(total).toBeLessThan(PROMPT_SIZE_CEILING)
  })

  test("rich dossier (full partner catalog + dated events): stays under the timeout ceiling", () => {
    const { systemCached = "", system, prompt } = guerrillaMarketingSkill.buildPrompt(richDossier())
    const total = systemCached.length + system.length + prompt.length
    console.log(`[smoke] rich prompt chars: system=${systemCached.length + system.length} user=${prompt.length} total=${total}`)
    // the loaded anchors + scaled economics ride in the user prompt but stay flat
    expect(prompt).toContain("Forney High School")
    expect(prompt).toContain("projectedEconomics")
    expect(total).toBeLessThan(PROMPT_SIZE_CEILING)

    // T6: the raw internal taxonomy must NEVER enter the prompt. The anchors carry a plain-prose
    // `description` instead of partnerLabel / sizeBand / sizeProxyKind. The fixture partners are all
    // typed with sizeProxyKind "enrollment band"; that string must not appear anywhere in the prompt.
    expect(prompt).not.toContain("enrollment band")
    expect(prompt).not.toContain("sizeProxyKind")
    expect(prompt).not.toContain("sizeBand")
    expect(prompt).not.toContain("partnerLabel")
    expect(prompt).not.toContain("school / PTA") // the raw partnerLabel value
    // the plain owner-facing sentence is what the model reads instead:
    expect(prompt).toContain('"description"')
    expect(prompt).toContain("with roughly 40-60 families")
  })

  test("the skill runs at medium effort (unthrottled) — never silently re-pin to low", () => {
    // The whole point of keeping the prompt under the ceiling: the producer runs at medium.
    expect(guerrillaMarketingSkill.effort).toBe("medium")
  })
})
