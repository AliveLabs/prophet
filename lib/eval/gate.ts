// ---------------------------------------------------------------------------
// The eval gate — turns "is the new engine $300-worthy?" into a number.
//
// For a dossier: judge the NEW engine's brief AND the legacy baseline brief on
// the same ground truth, then apply the gate (clear the bar AND beat baseline,
// no tone-deaf plays). This is what `SKILLS_ENABLED` flips on.
// ---------------------------------------------------------------------------

import type { Dossier } from "@/lib/insights/dossier/types"
import type { Brief } from "@/lib/skills/types"
import {
  judgeBrief,
  overallScore,
  passesGate,
  DEFAULT_GATE,
  defaultJudgeGenerate,
  type GenerateFn,
  type GateConfig,
  type JudgeVerdict,
} from "@/lib/eval/judge"
import { buildBaselineBrief } from "@/lib/eval/baseline"

/** Compact ground truth for the judge: profile + each rule output + events. */
export function dossierSummary(d: Dossier): string {
  const rules = d.ruleOutputs
    .map((i) => `- ${i.insight_type}: ${i.title} | evidence: ${JSON.stringify(i.evidence ?? {})}`)
    .join("\n")
  const events = d.demandCalendar.events.map((e) => `- ${e.title ?? "event"} @ ${e.venue?.name ?? "venue"}`).join("\n")
  return [
    `RESTAURANT: ${d.profile.name} (${JSON.stringify(d.profile.attributes)})`,
    `CAPABILITY: ${JSON.stringify(d.profile.capability)}`,
    `RULE OUTPUTS (the only facts that exist):\n${rules || "(none)"}`,
    `EVENTS:\n${events || "(none)"}`,
  ].join("\n\n")
}

export type JudgedBrief = { brief: Brief; verdict: JudgeVerdict; overall: number }
export type GateReport = {
  candidate: JudgedBrief
  baseline: JudgedBrief
  gate: { pass: boolean; reasons: string[] }
}

export type RunGateOptions = { generate?: GenerateFn; config?: GateConfig }

export async function runEvalGate(dossier: Dossier, candidate: Brief, opts: RunGateOptions = {}): Promise<GateReport> {
  const generate = opts.generate ?? defaultJudgeGenerate
  const summary = dossierSummary(dossier)
  const baseline = buildBaselineBrief(dossier)

  const [candVerdict, baseVerdict] = await Promise.all([
    judgeBrief(candidate, summary, generate),
    judgeBrief(baseline, summary, generate),
  ])

  const gate = passesGate({ candidate: candVerdict, baseline: baseVerdict }, opts.config ?? DEFAULT_GATE)
  return {
    candidate: { brief: candidate, verdict: candVerdict, overall: overallScore(candVerdict.scores) },
    baseline: { brief: baseline, verdict: baseVerdict, overall: overallScore(baseVerdict.scores) },
    gate,
  }
}
