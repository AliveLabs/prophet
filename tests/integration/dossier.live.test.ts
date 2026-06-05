// LIVE read-only smoke test against the Supabase branch.
// Proves the real data path: branch -> dossier -> deterministic engine -> grounded brief.
// No Claude, no spend (engine forced down the deterministic fallback path).
// Run: npx vitest run --config vitest.integration.config.ts

import { describe, it, expect, beforeAll } from "vitest"
import { readFileSync } from "fs"
import path from "path"

function loadEnvLocal() {
  try {
    const text = readFileSync(path.resolve(__dirname, "../../.env.local"), "utf8")
    for (const line of text.split("\n")) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
      if (!m) continue
      const key = m[1]
      let val = m[2].trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (!process.env[key]) process.env[key] = val
    }
  } catch {
    /* no .env.local */
  }
}

const haveSupabase = () => !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY

describe("LIVE dossier + deterministic engine (read-only)", () => {
  beforeAll(loadEnvLocal)

  it("builds a real dossier from the branch and produces a grounded brief", async () => {
    if (!haveSupabase()) {
      console.warn("[skip] Supabase env not present")
      return
    }
    const { createAdminSupabaseClient } = await import("@/lib/supabase/admin")
    const { buildDossier } = await import("@/lib/insights/dossier/build")
    const { buildRefIndex } = await import("@/lib/insights/dossier/types")
    const { runProducerSkills } = await import("@/lib/skills/run")
    const { PRODUCER_SKILLS } = await import("@/lib/skills/registry")
    const { synthesize } = await import("@/lib/skills/synthesis")
    const { voicePass, isVoiceClean } = await import("@/lib/skills/voice")
    const { evaluateBrief } = await import("@/lib/eval/checks")
    const failing = async () => {
      throw new Error("offline (forcing deterministic path)")
    }

    const sb = createAdminSupabaseClient()
    const { data: locs } = await sb.from("locations").select("id, name").ilike("name", "%Wagyu House%").limit(1)
    if (!locs?.length) {
      const { data: sample } = await sb.from("locations").select("name").limit(8)
      console.warn("[skip] Wagyu House not found. Sample locations:", (sample ?? []).map((s) => s.name))
      return
    }
    const locationId = locs[0].id as string

    const dossier = await buildDossier(locationId, { tier: 2 })
    const byPrefix: Record<string, number> = {}
    for (const r of dossier.ruleOutputs) {
      const p = r.insight_type.split(/[._]/)[0]
      byPrefix[p] = (byPrefix[p] ?? 0) + 1
    }
    console.log("[dossier]", {
      location: dossier.profile.name,
      competitors: dossier.competitors.length,
      ruleOutputs: dossier.ruleOutputs.length,
      ruleTypesByPrefix: byPrefix,
      events: dossier.demandCalendar.events.length,
      weatherDays: dossier.demandCalendar.weather.length,
      ownMenu: !!dossier.location.menu,
      competitorMenus: dossier.competitors.filter((c) => !!c.menu).length,
    })
    expect(dossier.profile.name).toBeTruthy()

    const results = await runProducerSkills(PRODUCER_SKILLS, dossier, { transport: failing })
    const brief = await voicePass(await synthesize(dossier, results, { transport: failing }))
    const index = buildRefIndex(dossier)
    console.log("[brief]", {
      headline: brief.headline,
      plays: brief.plays.map((p) => ({ title: p.title, kind: p.kind, refs: p.evidenceRefs })),
    })

    // every play grounded + eval-clean + voice-clean (or an honest empty/quiet brief)
    for (const p of brief.plays) {
      expect(p.evidenceRefs.every((r) => index.allowedRefs.has(r))).toBe(true)
    }
    expect(evaluateBrief({ plays: brief.plays }, index).ok).toBe(true)
    expect(isVoiceClean(brief)).toBe(true)
  })
})
