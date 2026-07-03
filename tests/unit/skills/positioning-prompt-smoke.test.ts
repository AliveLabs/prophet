// buildPrompt smoke — bare + rich prompts stay sane and inside the token budget
// (guerrilla precedent: a ~40k-char prompt at medium effort silently timed out into
// the fallback). Run via the mirror harness with positioning@v4 aliased in.

import { describe, test, expect } from "vitest"
import type { Dossier } from "@/lib/insights/dossier/types"
import type { MenuSnapshot } from "@/lib/content/types"
import { positioningSkill } from "@/lib/skills/positioning/skill"
import { competitiveWeekDossier } from "@/tests/fixtures/dossiers/competitive-week"
import { quietWeekDossier } from "@/tests/fixtures/dossiers/quiet-week"

// A deliberately fat scraped menu (~160 items with descriptions) to prove the distilled
// read keeps the prompt flat where v1 (whole MenuSnapshot objects) would have ballooned.
function fatMenu(): MenuSnapshot {
  const categories = Array.from({ length: 8 }, (_, c) => ({
    name: `Section ${String.fromCharCode(65 + c)}`,
    menuType: "dine_in" as const,
    items: Array.from({ length: 20 }, (_, i) => ({
      name: `Dish ${c}-${i} with a long descriptive name`,
      description:
        "A slow-braised, house-made plate with a long menu description that would eat the token budget if passed raw to the model, twenty times per section, eight sections per rival.",
      price: `$${10 + i}`,
      priceValue: 10 + i,
      tags: ["house"],
    })),
  }))
  return {
    menuUrl: "https://x.test/menu",
    capturedAt: "2026-07-01T00:00:00Z",
    screenshot: null,
    currency: "USD",
    categories,
    parseMeta: { itemsTotal: 160, confidence: "high", notes: [] },
  }
}

describe("buildPrompt smoke (positioning@v4)", () => {
  test("bare dossier: compact prompt, no optional keys, playbook present", () => {
    const { systemCached = "", system, prompt } = positioningSkill.buildPrompt(quietWeekDossier)
    expect(systemCached).toContain("SAMPLE HUMILITY DOCTRINE")
    expect(prompt).not.toContain("visualProfile")
    expect(prompt).toContain('"ownMenuRead": null')
    const total = systemCached.length + system.length + prompt.length
    console.log(`[smoke] bare prompt chars: system=${systemCached.length + system.length} user=${prompt.length} total=${total}`)
    expect(total).toBeLessThan(40_000)
  })

  test("rich dossier (fat own menu + 5 fat rival menus): the distilled read holds the budget", () => {
    const rich: Dossier = {
      ...competitiveWeekDossier,
      location: { ...competitiveWeekDossier.location, menu: fatMenu() },
      competitors: Array.from({ length: 5 }, (_, i) => ({
        entityId: `comp-${i}`,
        kind: "competitor" as const,
        name: `Rival ${i}`,
        menu: fatMenu(),
      })),
    }
    const { systemCached = "", system, prompt } = positioningSkill.buildPrompt(rich)
    const total = systemCached.length + system.length + prompt.length
    console.log(`[smoke] rich prompt chars: system=${systemCached.length + system.length} user=${prompt.length} total=${total}`)
    // the raw menus alone would be ~6 x ~30k chars; the distilled read must stay flat
    expect(prompt.length).toBeLessThan(20_000)
    expect(total).toBeLessThan(45_000)
    expect(prompt).not.toContain("slow-braised, house-made plate with a long menu description")
  })
})
