// LIVE eval gate: new engine (real Claude) vs the legacy baseline, scored by the live judge.
// Deterministic fixture (no Supabase needed) + Claude. Run:
//   npx vitest run --config vitest.integration.config.ts tests/integration/eval-gate.live.test.ts
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

describe("LIVE eval gate (new engine vs legacy baseline)", () => {
  beforeAll(loadEnvLocal)

  it("scores the new engine and the baseline, and reports the gate", async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn("[skip] no ANTHROPIC_API_KEY")
      return
    }
    const { competitiveWeekDossier } = await import("@/tests/fixtures/dossiers/competitive-week")
    const { runBrief } = await import("@/lib/skills/pipeline")
    const { runEvalGate } = await import("@/lib/eval/gate")

    // NEW engine, live Claude — full pipeline incl. graduated brand-fit review
    const { brief: candidate, dropped } = await runBrief(competitiveWeekDossier)

    // Judge candidate vs legacy baseline, live
    const report = await runEvalGate(competitiveWeekDossier, candidate)

    console.log("[GATE SCORECARD]", {
      candidate: { overall: report.candidate.overall.toFixed(2), scores: report.candidate.verdict.scores, headline: candidate.headline },
      baseline: { overall: report.baseline.overall.toFixed(2), scores: report.baseline.verdict.scores },
      gate: report.gate,
      toneDeaf: report.candidate.verdict.toneDeaf,
      droppedByReview: dropped.map((d) => ({ title: d.play.title, reason: d.reason })),
    })

    expect(report.candidate.overall).toBeGreaterThan(report.baseline.overall)
  }, 240_000)
})
