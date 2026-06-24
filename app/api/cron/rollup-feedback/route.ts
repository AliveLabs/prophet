// ---------------------------------------------------------------------------
// GET /api/cron/rollup-feedback — PIPELINE 2 (CLICK FEEDBACK) for the Learning Spine (P15).
//
// Two modes (cheap-deterministic by default; the weekly LLM-free distill is opt-in via ?mode=weekly):
//   - NIGHTLY (default / ?mode=nightly): recompute skill_feedback_rollup from raw thumbs
//     (brief_feedback) + directional actions (play_actions), mapped through the feedback-signals BAND,
//     with Bayesian smoothing + the small-N/confidence guard + the confounder guard. No LLM.
//   - WEEKLY (?mode=weekly): distill the STRONGEST, most STABLE rollup rows into skill_knowledge
//     `feedback_pattern` candidate/shadow rows (reusing P14's table + candidate→active promotion).
//
// SAFE BY CONSTRUCTION: a missing skill_feedback_rollup / brief_feedback table → no-op run (floor =
// today; the brief path, which only READS the rollup loose-typed, is unaffected). `?dryRun=1` does
// everything EXCEPT write. Auth: Bearer CRON_SECRET (mirrors ingest-knowledge-feeds / weekly-digest).
// ---------------------------------------------------------------------------

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { runFeedbackRollup, type RecomputeStore } from "@/lib/skills/feedback-rollup"
import { distillFeedbackPatterns } from "@/lib/skills/feedback-distill-run"

export const maxDuration = 300

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(req.url)
  const dryRun = url.searchParams.get("dryRun") === "1"
  const mode = url.searchParams.get("mode") === "weekly" ? "weekly" : "nightly"

  try {
    if (mode === "weekly") {
      const result = await distillFeedbackPatterns({
        store: createAdminSupabaseClient() as unknown as Parameters<typeof distillFeedbackPatterns>[0]["store"],
        dryRun,
      })
      console.log(
        `[rollup-feedback] weekly distilled ${result.candidates} patterns (rows read ${result.rollupRows})${dryRun ? " (dry-run)" : ""}`,
      )
      return Response.json({ mode, ...result })
    }

    const result = await runFeedbackRollup({
      store: createAdminSupabaseClient() as unknown as RecomputeStore,
      dryRun,
    })
    console.log(
      `[rollup-feedback] nightly events ${result.feedbackRows}, resolved ${result.resolved}/${result.resolved + result.unresolved}, rows ${result.rollupRows} (global ${result.globalRows})${dryRun ? " (dry-run)" : ""}`,
    )
    return Response.json({ mode, ...result })
  } catch (err) {
    // A learning-system outage must never page as a brief-breaking error — log + 200 so the cron
    // surface stays green and the brief path (which only reads the rollup loose-typed) is unaffected.
    console.warn("[rollup-feedback] run failed:", err instanceof Error ? err.message : err)
    return Response.json({ ok: false, error: err instanceof Error ? err.message : "rollup failed" })
  }
}
