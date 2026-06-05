// LIVE PRECOMPUTE (writes): runs the real cron-route code path against the branch —
// buildDossier -> runBrief (skills + brand-fit review + synthesis + voice) -> saveBrief —
// then reads it back via getBrief to confirm persistence. Populates daily_briefs so the
// home can render a real, precomputed brief (no LLM at render time).
// Run: npx vitest run --config vitest.integration.config.ts tests/integration/precompute-brief.live.test.ts
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

describe("LIVE precompute brief -> daily_briefs", () => {
  beforeAll(loadEnvLocal)

  it("builds, persists, and reads back a real Wagyu House brief", async () => {
    if (!process.env.ANTHROPIC_API_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
      console.warn("[skip] missing env")
      return
    }
    const { createAdminSupabaseClient } = await import("@/lib/supabase/admin")
    const { buildDossier } = await import("@/lib/insights/dossier/build")
    const { runBrief } = await import("@/lib/skills/pipeline")
    const { saveBrief, getBrief } = await import("@/lib/insights/daily-brief")

    const sb = createAdminSupabaseClient()
    const { data: locs } = await sb
      .from("locations")
      .select("id, name, organization_id")
      .ilike("name", "%Wagyu House%")
      .limit(1)
    if (!locs?.length) {
      console.warn("[skip] Wagyu House not found")
      return
    }
    const loc = locs[0]
    console.log("[precompute target]", { id: loc.id, name: loc.name, org: loc.organization_id })

    const dossier = await buildDossier(loc.id as string, { tier: 2 })
    const { brief, dropped } = await runBrief(dossier)
    await saveBrief(brief)
    console.log("[saved brief]", {
      locationId: brief.locationId,
      dateKey: brief.dateKey,
      headline: brief.headline,
      plays: brief.plays.length,
      dropped: dropped.length,
    })
    console.log("[FULL BRIEF]\n" + JSON.stringify(brief, null, 2))

    // read it back the way the home will
    const readBack = await getBrief(loc.id as string)
    expect(readBack).toBeTruthy()
    expect(readBack?.headline).toBe(brief.headline)
    expect(readBack?.plays.length).toBe(brief.plays.length)
    console.log("[read-back OK] getBrief returned the persisted brief")
  }, 300_000)
})
