// LIVE COHERENT REFRESH (writes + spends API credits): runs the real refresh-all
// orchestrator for Wagyu House (every signal pipeline EXCEPT photos — the slow/costly
// one), so all snapshots + rule outputs regenerate at TODAY's date_key coherently.
// Then rebuilds the dossier + brief + persists. Run explicitly:
//   npx vitest run --config vitest.integration.config.ts tests/integration/refresh-and-rebuild.live.test.ts
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
  } catch {}
}

describe("LIVE coherent refresh + rebuild", () => {
  beforeAll(loadEnvLocal)

  it("refreshes all signals then rebuilds the brief", async () => {
    if (!process.env.ANTHROPIC_API_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) return
    const { createAdminSupabaseClient } = await import("@/lib/supabase/admin")
    const { buildRefreshAllContext, buildRefreshAllSteps } = await import("@/lib/jobs/pipelines/refresh-all")
    const { buildDossier } = await import("@/lib/insights/dossier/build")
    const { runBrief } = await import("@/lib/skills/pipeline")
    const { saveBrief } = await import("@/lib/insights/daily-brief")

    const sb = createAdminSupabaseClient()
    const { data: locs } = await sb.from("locations").select("id, organization_id, name").ilike("name", "%Wagyu House%").limit(1)
    if (!locs?.length) return
    const loc = locs[0]
    console.log("[refresh target]", { id: loc.id, org: loc.organization_id, name: loc.name })

    // ── run the coherent refresh (skip photos: slow + costly + the 300s-timeout pipeline) ──
    const parentCtx = await buildRefreshAllContext(sb, loc.id as string, loc.organization_id as string)
    const steps = buildRefreshAllSteps().filter((s) => s.name !== "photos_pipeline")
    for (const step of steps) {
      const t0 = Date.now()
      const res = await step.run(parentCtx)
      console.log(`[pipeline] ${step.name} (${Date.now() - t0}ms):`, JSON.stringify(res))
    }

    // ── rebuild the brief on the freshly refreshed data ──
    const dossier = await buildDossier(loc.id as string, { tier: 2 })
    console.log("[dossier post-refresh]", {
      events: dossier.demandCalendar.events.length,
      weatherDays: dossier.demandCalendar.weather.length,
      ruleOutputs: dossier.ruleOutputs.length,
      competitorsScraped: dossier.competitors.filter((c) => c.listing || c.menu).length + "/" + dossier.competitors.length,
    })
    const { brief, dropped } = await runBrief(dossier)
    await saveBrief(brief)
    console.log("[FULL BRIEF]\n" + JSON.stringify(brief, null, 2))
    console.log("[dropped]", dropped.map((d) => d.play.title))
    expect(brief.plays.length).toBeGreaterThan(0)
  }, 900_000)
})
