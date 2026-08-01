// ---------------------------------------------------------------------------
// GET /api/cron/eval-judge — nightly quality judge over REAL SERVED BRIEFS (ALT-543 step 5).
//
// Converts "we think the brief is still good" into a number. Samples recently served briefs that
// carry their captured ground truth, scores each with lib/eval/judge.ts, writes the verdict back to
// `brief->judge`, and compares the batch mean against a trailing mean. A drop past the threshold
// posts a Slack alert.
//
// COST: one model call per brief judged, so EVAL_JUDGE_SAMPLE (default 10) is the spend dial —
// roughly $18/mo at ten a night. Deliberately NOT a frozen golden set: that would mean ten full
// brief REBUILDS a night (est. $300-600/mo) because buildDossier hits paid vendors. The frozen rig
// is ticketed separately, scoped to prompt/model sweep windows.
//
// `?dryRun=1` judges and reports WITHOUT writing verdicts back or alerting — note it still spends
// the model calls, since the judging is the point. Auth: Bearer CRON_SECRET (mirrors the other crons).
// ---------------------------------------------------------------------------

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { postSlackAlert } from "@/lib/ops/slack"
import { runNightlyJudge, summarizeJudgeRun, type JudgeStore } from "@/lib/eval/nightly-judge"

export const maxDuration = 300

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(req.url)
  const dryRun = url.searchParams.get("dryRun") === "1"
  const sampleParam = Number(url.searchParams.get("sample"))
  const sample = Number.isInteger(sampleParam) && sampleParam >= 1 && sampleParam <= 100 ? sampleParam : undefined

  try {
    const report = await runNightlyJudge({
      store: createAdminSupabaseClient() as unknown as JudgeStore,
      sample,
      dryRun,
    })
    const summary = summarizeJudgeRun(report)
    console.log(`[eval-judge] ${summary}`)

    // Alert only on a real drop. A quality monitor that pages on noise gets muted, and a muted
    // monitor is worse than none — same reasoning as the watchdog's probe-only failure rule.
    if (report.regression && !dryRun) {
      await postSlackAlert(
        `Ticket brief quality DROPPED: ${summary}. ` +
          `Judged briefs are real served output; check recent prompt/model/effort changes.`,
      )
    }
    return Response.json(report)
  } catch (err) {
    // Never 500 the cron on a judging problem: it would page as an infra failure when the pipeline
    // is fine. Report it and let the watchdog's own probe own real infra alerting.
    const message = err instanceof Error ? err.message : "eval-judge failed"
    console.error(`[eval-judge] run failed: ${message}`)
    return Response.json({ error: message, judged: [] }, { status: 200 })
  }
}
