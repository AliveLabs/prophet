// ---------------------------------------------------------------------------
// LLM-as-judge scaffold (Phase B) — the OFFLINE/nightly quality bar.
//
// Deterministic checks (checks.ts) are the CI regression guard. This is the
// quality bar that answers "is the new engine actually better than today's?".
// It scores a brief on four axes against the dossier it was built from, and
// supports an A/B column vs the legacy baseline output on the same dossier.
//
// Model-agnostic: the judge takes an injected `generate` fn so it is testable
// today (mock) and wires to lib/ai/provider.ts in Phase 2. No live call here.
// SKILLS_ENABLED may only flip in prod once the golden set clears a numeric bar
// AND beats the legacy baseline head-to-head.
// ---------------------------------------------------------------------------

import type { Brief } from "@/lib/skills/types"
import { claudeRaw, extractJson } from "@/lib/ai/provider"

/** 1-5 on each axis; the gate is defined over these. */
export type JudgeScores = {
  specificity: number // is the play concrete + recipe-level, or generic ("post more")?
  nonObviousness: number // would a sharp operator call it non-obvious, or "I knew that"?
  actionableSmallBudget: number // can a solo owner with little budget actually do it tomorrow?
  groundingFaithfulness: number // does the rationale match the cited evidence (no invented specifics)?
}

export type JudgeVerdict = {
  scores: JudgeScores
  toneDeaf: string[] // plays the judge flags as tone-deaf / risky (trust killers)
  notes: string
}

export const JUDGE_AXES: (keyof JudgeScores)[] = [
  "specificity",
  "nonObviousness",
  "actionableSmallBudget",
  "groundingFaithfulness",
]

/** A model-call function the judge depends on. Wired to lib/ai/provider.ts in Phase 2. */
export type GenerateFn = (prompt: string) => Promise<string>

export function buildJudgePrompt(brief: Brief, dossierSummary: string): string {
  return [
    "You are a hard-to-impress restaurant operator and marketer grading an AI's daily brief.",
    "Score each play 1-5 on: specificity, nonObviousness, actionableSmallBudget, groundingFaithfulness.",
    "1 = generic/obvious/un-actionable/ungrounded; 5 = a specific, non-obvious play a sharp owner could run tomorrow on a small budget, fully backed by the evidence.",
    "Also list any tone-deaf or risky plays (a price hike during a slump, an offer the dossier does not support).",
    "Use ONLY the dossier as ground truth. Penalize any number or claim not present in it.",
    "Return JSON: { scores:{specificity,nonObviousness,actionableSmallBudget,groundingFaithfulness}, toneDeaf:[], notes:'' }.",
    "",
    "=== DOSSIER (ground truth) ===",
    dossierSummary,
    "",
    "=== BRIEF UNDER REVIEW ===",
    JSON.stringify(brief, null, 2),
  ].join("\n")
}

/** Mean of the four axes — the single number the gate is defined over. */
export function overallScore(scores: JudgeScores): number {
  return JUDGE_AXES.reduce((sum, k) => sum + (scores[k] ?? 0), 0) / JUDGE_AXES.length
}

export type GateConfig = {
  /** Minimum mean judge score (1-5) required to flip SKILLS_ENABLED. */
  minOverall: number
  /** Must beat the legacy baseline's mean score by at least this margin. */
  minMarginVsBaseline: number
  /** Any tone-deaf play fails the gate outright. */
  maxToneDeaf: number
}

export const DEFAULT_GATE: GateConfig = { minOverall: 3.8, minMarginVsBaseline: 0.5, maxToneDeaf: 0 }

export type GateInput = { candidate: JudgeVerdict; baseline: JudgeVerdict }

/** The gate decision: does the candidate engine clear the bar AND beat the baseline? */
export function passesGate(input: GateInput, cfg: GateConfig = DEFAULT_GATE): { pass: boolean; reasons: string[] } {
  const reasons: string[] = []
  const cand = overallScore(input.candidate.scores)
  const base = overallScore(input.baseline.scores)
  if (cand < cfg.minOverall) reasons.push(`overall ${cand.toFixed(2)} < ${cfg.minOverall}`)
  if (cand - base < cfg.minMarginVsBaseline) {
    reasons.push(`margin ${(cand - base).toFixed(2)} < ${cfg.minMarginVsBaseline} (baseline ${base.toFixed(2)})`)
  }
  if (input.candidate.toneDeaf.length > cfg.maxToneDeaf) {
    reasons.push(`${input.candidate.toneDeaf.length} tone-deaf plays > ${cfg.maxToneDeaf}`)
  }
  return { pass: reasons.length === 0, reasons }
}

/** Live judge generate fn — Claude reasoning tier, low temperature for consistent scoring. */
export const defaultJudgeGenerate: GenerateFn = (prompt) =>
  claudeRaw({ tier: "reasoning", prompt, temperature: 0.1, maxOutputTokens: 2048 })

function clampScore(n: unknown): number {
  const v = typeof n === "number" ? n : 0
  return Math.max(0, Math.min(5, v))
}

/** Run the judge over a brief using an injected model fn (defaults to live Claude). Tolerant parse. */
export async function judgeBrief(
  brief: Brief,
  dossierSummary: string,
  generate: GenerateFn = defaultJudgeGenerate,
): Promise<JudgeVerdict> {
  const raw = await generate(buildJudgePrompt(brief, dossierSummary))
  const parsed = (extractJson(raw) ?? {}) as Partial<JudgeVerdict>
  const s = (parsed.scores ?? {}) as Partial<JudgeScores>
  return {
    scores: {
      specificity: clampScore(s.specificity),
      nonObviousness: clampScore(s.nonObviousness),
      actionableSmallBudget: clampScore(s.actionableSmallBudget),
      groundingFaithfulness: clampScore(s.groundingFaithfulness),
    },
    toneDeaf: Array.isArray(parsed.toneDeaf) ? parsed.toneDeaf.map(String) : [],
    notes: typeof parsed.notes === "string" ? parsed.notes : "",
  }
}
