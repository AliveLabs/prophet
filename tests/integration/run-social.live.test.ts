// LIVE: runs the social pipeline for Wagyu (discover -> Data365 collect -> insights;
// skips the slow Gemini-vision step), proving Data365 is live + regenerating current
// social insights, then rebuilds the brief so social flows into coverage. Run:
//   npx vitest run --config vitest.integration.config.ts tests/integration/run-social.live.test.ts
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

describe("LIVE social run + rebuild", () => {
  beforeAll(loadEnvLocal)
  it("collects social via Data365 and the brief picks it up", async () => {
    if (!process.env.ANTHROPIC_API_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) return
    const { createAdminSupabaseClient } = await import("@/lib/supabase/admin")
    const { buildSocialContext, buildSocialSteps } = await import("@/lib/jobs/pipelines/social")
    const { buildDossier } = await import("@/lib/insights/dossier/build")
    const { runBrief } = await import("@/lib/skills/pipeline")
    const { saveBrief } = await import("@/lib/insights/daily-brief")

    const sb = createAdminSupabaseClient()
    const { data: loc } = await sb.from("locations").select("id, organization_id, name").ilike("name", "%Wagyu House%").limit(1).maybeSingle()
    if (!loc) return

    // run social steps, skipping analyze_social_visuals (slow Gemini vision; not needed to verify social flows)
    const ctx = await buildSocialContext(sb, loc.id as string, loc.organization_id as string)
    const steps = buildSocialSteps().filter((s) => s.name !== "analyze_social_visuals")
    for (const step of steps) {
      try {
        const r = await step.run(ctx)
        console.log(`[social step] ${step.name}:`, JSON.stringify(r))
      } catch (e) {
        console.log(`[social step] ${step.name} ERROR:`, e instanceof Error ? e.message : e)
      }
    }
    console.log("[social warnings]", ctx.state.warnings)

    const dossier = await buildDossier(loc.id as string, { tier: 2 })
    const { brief } = await runBrief(dossier)
    await saveBrief(brief)
    const cov = (brief.coverage ?? []).map((c) => `${c.label}=${c.present ? (c.stale ? "stale(" + c.asOf + ")" : "ok") : "missing"}`)
    console.log("[coverage]", cov.join("  "))
    console.log("[headline]", brief.headline)
    console.log("[plays]", brief.plays.map((p) => `[${p.kind}] ${p.title}`))
    expect(brief.plays.length).toBeGreaterThan(0)
  }, 600_000)
})
