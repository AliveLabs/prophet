// ---------------------------------------------------------------------------
// Nightly quality judge over REAL SERVED BRIEFS (ALT-543 step 5).
//
// Chris's question was "is the brief still worth its price this month?", and until now the only way
// to answer it was to read briefs by hand. lib/eval/judge.ts existed with zero runtime callers.
//
// WHY REAL BRIEFS AND NOT A FROZEN GOLDEN SET: judging a golden set means re-running runBrief over
// snapshotted dossiers, roughly ten full brief builds a night (est. $300-600/mo). Judging what we
// already served costs one model call per brief (~$0.06), because the brief and its ground truth are
// already on the row. That is ~$18/mo at ten a night. The frozen rig is the CONTROLLED experiment you
// want while actively sweeping prompts, and it is ticketed separately for exactly that window; this
// is the standing "is quality drifting?" monitor. Decided with Bryan 2026-08-01.
//
// The trade-off this design accepts, stated plainly: nightly inputs vary, so a score move here
// confounds a prompt change with an input change. It answers "is quality drifting", not "did MY
// change cause it". Do not read a single night's delta as attribution.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database.types"
import type { Brief } from "@/lib/skills/types"
import { judgeBrief, overallScore, defaultJudgeGenerate, type GenerateFn } from "@/lib/eval/judge"

export type JudgeStore = SupabaseClient<Database>

/** How many briefs to judge per run. Each is one model call, so this IS the cost dial. */
export const JUDGE_SAMPLE_SIZE = (() => {
  const n = Number(process.env.EVAL_JUDGE_SAMPLE)
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : 10
})()

/** Drop (in mean judge score, 1-5) versus the trailing mean that counts as a regression worth
 *  alerting on. 0.3 on a 4-axis 1-5 mean is a real move, not sampling noise from a 10-brief batch. */
export const JUDGE_DROP_ALERT = (() => {
  const n = Number(process.env.EVAL_JUDGE_DROP_ALERT)
  return Number.isFinite(n) && n > 0 ? n : 0.3
})()

/** Briefs to draw the trailing baseline from. Deliberately larger than the nightly sample so one
 *  bad night cannot drag the baseline down and hide the next one. */
const TRAILING_WINDOW = 60

export type JudgedRow = { locationId: string; dateKey: string; overall: number }

export type NightlyJudgeReport = {
  judged: JudgedRow[]
  /** Briefs skipped because their ground truth was truncated (scoring those records a false low). */
  skippedTruncated: number
  /** Mean of this run. Null when nothing was judged. */
  batchMean: number | null
  /** Mean of previously-judged briefs in the trailing window. Null on the first ever run. */
  trailingMean: number | null
  /** batchMean - trailingMean, negative meaning quality dropped. Null without both. */
  delta: number | null
  /** True when the drop exceeds JUDGE_DROP_ALERT. */
  regression: boolean
  errors: number
  dryRun: boolean
}

type BriefRow = { location_id: string; date_key: string; brief: unknown }

const asBrief = (row: BriefRow): Brief => row.brief as Brief

/** Mean of a numeric list, or null when empty. */
export function mean(xs: number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length
}

/**
 * Judge a sample of recently served briefs and write each verdict back onto its row.
 *
 * Never throws: a nightly quality monitor that can page the on-call by crashing is worse than one
 * that reports zero judged. Per-brief failures are counted and the run continues.
 */
export async function runNightlyJudge(opts: {
  store: JudgeStore
  sample?: number
  dryRun?: boolean
  generate?: GenerateFn
  model?: string
}): Promise<NightlyJudgeReport> {
  const sample = opts.sample ?? JUDGE_SAMPLE_SIZE
  const dryRun = !!opts.dryRun
  const generate = opts.generate ?? defaultJudgeGenerate
  const model = opts.model ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6"

  // Trailing baseline first: briefs already carrying a judge verdict.
  const { data: priorRows } = await opts.store
    .from("daily_briefs")
    .select("brief")
    .not("brief->judge", "is", null)
    .order("generated_at", { ascending: false })
    .limit(TRAILING_WINDOW)
  const trailing = (priorRows ?? [])
    .map((r) => (r.brief as Brief)?.judge?.overall)
    .filter((n): n is number => typeof n === "number")
  const trailingMean = mean(trailing)

  // Candidates: served briefs with ground truth that have NOT been judged yet.
  const { data: rows, error } = await opts.store
    .from("daily_briefs")
    .select("location_id, date_key, brief")
    .not("brief->judgeGroundTruth", "is", null)
    .is("brief->judge", null)
    .order("generated_at", { ascending: false })
    .limit(sample * 2) // over-fetch: some will be skipped as truncated
  if (error) throw new Error(`nightly judge: candidate query failed: ${error.message}`)

  const judged: JudgedRow[] = []
  let skippedTruncated = 0
  let errors = 0

  for (const row of (rows ?? []) as BriefRow[]) {
    if (judged.length >= sample) break
    const brief = asBrief(row)
    // A truncated ground truth makes the judge score real claims as ungrounded. Skipping keeps the
    // trend honest; scoring them would quietly bias the whole series downward.
    if (brief?.judgeGroundTruthTruncated) {
      skippedTruncated += 1
      continue
    }
    const groundTruth = brief?.judgeGroundTruth
    if (!groundTruth || !Array.isArray(brief.plays) || brief.plays.length === 0) continue

    try {
      const verdict = await judgeBrief(brief, groundTruth, generate)
      const overall = overallScore(verdict.scores)
      judged.push({ locationId: row.location_id, dateKey: row.date_key, overall })

      if (!dryRun) {
        const updated: Brief = {
          ...brief,
          judge: {
            overall,
            scores: verdict.scores,
            toneDeaf: verdict.toneDeaf,
            judgedAt: new Date().toISOString(),
            model,
          },
        }
        const { error: writeErr } = await opts.store
          .from("daily_briefs")
          .update({ brief: updated as never })
          .eq("location_id", row.location_id)
          .eq("date_key", row.date_key)
        // A write failure must not abort the run; the brief is simply re-judged next night.
        if (writeErr) {
          errors += 1
          console.warn(`[eval-judge] write-back failed for ${row.location_id}/${row.date_key}: ${writeErr.message}`)
        }
      }
    } catch (err) {
      errors += 1
      console.warn(`[eval-judge] judge failed for ${row.location_id}/${row.date_key}:`, err)
    }
  }

  const batchMean = mean(judged.map((j) => j.overall))
  const delta = batchMean !== null && trailingMean !== null ? batchMean - trailingMean : null
  const regression = delta !== null && delta <= -JUDGE_DROP_ALERT

  return { judged, skippedTruncated, batchMean, trailingMean, delta, regression, errors, dryRun }
}

/** One-line human summary for the cron log and the Slack alert body. */
export function summarizeJudgeRun(r: NightlyJudgeReport): string {
  const b = r.batchMean === null ? "n/a" : r.batchMean.toFixed(2)
  const t = r.trailingMean === null ? "n/a" : r.trailingMean.toFixed(2)
  const d = r.delta === null ? "n/a" : `${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(2)}`
  return (
    `judged ${r.judged.length} brief(s): mean ${b} vs trailing ${t} (${d})` +
    `${r.skippedTruncated ? `, skipped ${r.skippedTruncated} truncated` : ""}` +
    `${r.errors ? `, ${r.errors} error(s)` : ""}${r.dryRun ? " (dry-run)" : ""}`
  )
}
