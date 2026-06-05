// LIVE end-to-end: real dossier from the branch -> real Claude skills -> synthesis -> voice.
// Costs a few Claude calls (authorized). Run: npx vitest run --config vitest.integration.config.ts
import { describe, it, expect, beforeAll } from "vitest"
import { readFileSync } from "fs"
import path from "path"

function loadEnvLocal() {
  try {
    const text = readFileSync(path.resolve(__dirname, "../../.env.local"), "utf8")
    for (const line of text.split("\n")) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
      if (!m) continue
      let val = m[2].trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
      if (!process.env[m[1]]) process.env[m[1]] = val
    }
  } catch {
    /* none */
  }
}

describe("LIVE Claude brief", () => {
  beforeAll(loadEnvLocal)

  it("validates the Claude model id with one tiny call", async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn("[skip] no ANTHROPIC_API_KEY")
      return
    }
    const { claudeTransport } = await import("@/lib/ai/provider")
    try {
      const out = await claudeTransport({ tier: "reasoning", prompt: 'Return ONLY this JSON: {"ok": true}', maxOutputTokens: 50 })
      console.log("[claude ok] model:", process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5 (default)", "->", JSON.stringify(out))
      expect(out).toBeTruthy()
    } catch (e) {
      console.error("[claude ERROR]", e instanceof Error ? e.message : e)
      throw e
    }
  })

  it("produces a real grounded brief from the live dossier via Claude", async () => {
    if (!process.env.ANTHROPIC_API_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
      console.warn("[skip] missing env")
      return
    }
    const { createAdminSupabaseClient } = await import("@/lib/supabase/admin")
    const { buildDossier } = await import("@/lib/insights/dossier/build")
    const { buildRefIndex } = await import("@/lib/insights/dossier/types")
    const { runBrief } = await import("@/lib/skills/pipeline")
    const { isVoiceClean } = await import("@/lib/skills/voice")
    const { evaluateBrief } = await import("@/lib/eval/checks")

    const sb = createAdminSupabaseClient()
    const { data: locs } = await sb.from("locations").select("id").ilike("name", "%Wagyu House%").limit(1)
    if (!locs?.length) {
      console.warn("[skip] Wagyu House not found")
      return
    }
    // buildDossier now also pulls own reviews -> sentiment -> review insights, and own foot traffic
    const dossier = await buildDossier(locs[0].id as string, { tier: 2 })
    console.log("[funded data]", {
      reviewThemes: dossier.location.reviews?.themes.length ?? 0,
      ownBusyTimes: !!dossier.location.busyTimes,
      reviewInsights: dossier.ruleOutputs.filter((r) => r.insight_type.startsWith("review")).length,
    })

    // LIVE full pipeline: producers -> brand-fit review -> synthesis -> voice
    const { brief, skillResults, dropped } = await runBrief(dossier)
    console.log("[skills]", skillResults.map((r) => ({ skill: r.skillId, plays: r.plays.length })))
    console.log("[dropped by review]", dropped.map((d) => d.play.title))
    console.log("[LIVE BRIEF]\n" + JSON.stringify({ headline: brief.headline, deck: brief.deck, plays: brief.plays }, null, 2))

    const index = buildRefIndex(dossier)
    for (const p of brief.plays) expect(p.evidenceRefs.every((r) => index.allowedRefs.has(r))).toBe(true)
    expect(evaluateBrief({ plays: brief.plays }, index).ok).toBe(true)
    expect(isVoiceClean(brief)).toBe(true)
  }, 240_000)
})
