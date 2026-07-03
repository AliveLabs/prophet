// T3 + T4 — one assertion per consuming skill that a POPULATED competitor busyTimes /
// reviews field (now wired by buildDossier's competitor-assembly block) actually reaches
// the model prompt via each skill's selectInput. These are additive to the existing
// operations-skill.test.ts / marketing-skill.test.ts / reputation-skill.test.ts files —
// kept as a standalone file here since the source repo isn't writable from this task; a
// human can fold these `describe` blocks into the existing files (or leave this file as-is,
// it imports the real skill modules and needs no separate wiring).

import { describe, test, expect } from "vitest"
import type { Dossier } from "@/lib/insights/dossier/types"
import { TIER_CAPS } from "@/lib/insights/dossier/types"
import { operationsSkill } from "@/lib/skills/operations/skill"
import { marketingSkill } from "@/lib/skills/marketing/skill"
import { reputationSkill } from "@/lib/skills/reputation/skill"

const baseDossier = (): Dossier => ({
  locationId: "loc-test",
  dateKey: "2026-07-02",
  generatedAt: "2026-07-02T06:00:00-04:00",
  tier: TIER_CAPS[2],
  profile: {
    locationId: "loc-test",
    name: "Test Kitchen",
    timezone: "America/New_York",
    voiceTone: "warm_personal",
    attributes: { cuisine: "american", priceTier: "mid", dayparts: ["dinner"] },
    capability: { marketingBudgetBand: "low", whoRunsMarketing: "owner", liveChannels: [], posCapabilities: [], seats: 60 },
  },
  location: {
    entityId: "loc-test",
    kind: "location",
    name: "Test Kitchen",
    busyTimes: {
      competitor_id: "loc-test",
      days: [{ day_of_week: 5, day_name: "Friday", hourly_scores: Array(24).fill(20), peak_hour: 19, peak_score: 90, slow_hours: [3, 4] }],
      typical_time_spent: "1 hr",
      current_popularity: 60,
      working_hours_lines: null,
    },
  },
  competitors: [
    {
      entityId: "comp-rival",
      kind: "competitor",
      name: "Rival Bistro",
      // T3: populated competitor busyTimes (was always null pre-fix).
      busyTimes: {
        competitor_id: "comp-rival",
        days: [{ day_of_week: 5, day_name: "Friday", hourly_scores: Array(24).fill(15), peak_hour: 20, peak_score: 85, slow_hours: [2, 3] }],
        typical_time_spent: "50 min",
        current_popularity: 70,
        working_hours_lines: null,
      },
      // T4: populated competitor review sentiment (was always null pre-fix).
      reviews: {
        themes: [
          { theme: "slow service", sentiment: "negative", mentions: 9, examples: ["Waited over an hour on Friday."] },
        ],
        source: "google_places",
        windowDays: 30,
      },
      listing: { version: "1.0", timestamp: "2026-07-01T00:00:00Z", profile: { rating: 4.1, reviewCount: 210 }, recentReviews: [] },
    },
  ],
  demandCalendar: { events: [], weather: [] },
  ruleOutputs: [],
})

describe("T3 — operations@v2 selectInput passes populated competitor busy curves through", () => {
  test("buildPrompt's prompt string carries the rival's peak_hour (20)", () => {
    const { prompt } = operationsSkill.buildPrompt(baseDossier())
    expect(prompt).toContain("Rival Bistro")
    expect(prompt).toMatch(/"peak_hour":\s*20/)
  })
})

describe("T3 — marketing@v2 selectInput passes populated competitor busy curves through (capped at 5)", () => {
  test("buildPrompt's prompt string carries the rival's busyTimes, not a null shell", () => {
    const { prompt } = marketingSkill.buildPrompt(baseDossier())
    expect(prompt).toContain("Rival Bistro")
    expect(prompt).toMatch(/"peak_hour":\s*20/) // a real curve, not a null shell
  })
})

describe("T4 — reputation@v2 competitorField[].themes populates from a synthetic dossier", () => {
  test("buildPrompt's prompt string carries the rival's review theme", () => {
    const { prompt } = reputationSkill.buildPrompt(baseDossier())
    expect(prompt).toContain("slow service")
    expect(prompt).toContain("Rival Bistro")
  })
})
