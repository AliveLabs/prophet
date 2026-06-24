// ---------------------------------------------------------------------------
// GET /api/cron/ask-mining — PIPELINE 3 (ASK-TICKET QUESTIONS) for the Learning Spine (P17a).
//
// Two modes (cheap, deterministic, NO LLM):
//   - NIGHTLY (default / ?mode=nightly): route recent GROUNDED ask_history to the skill(s) each
//     question touches and report routed coverage. No write.
//   - WEEKLY (?mode=weekly): cluster recurring grounded asks into skill_knowledge `question_demand`
//     (coverage gap) / `editorial` (framing) CANDIDATE rows for HUMAN review (TicketAdmin). Then runs
//     AUTO-PROMOTION (§2.4): corroborated external_trend + supported feedback_pattern → active, stale
//     rows → retired. ★ question_demand is NEVER auto-promoted — it stays candidate for the human gate.
//
// SAFE BY CONSTRUCTION: a missing ask_history / skill_knowledge → no-op run (floor = today; the brief
// path is unaffected). `?dryRun=1` does everything EXCEPT write. Auth: Bearer CRON_SECRET (mirrors
// rollup-feedback / ingest-knowledge-feeds).
// ---------------------------------------------------------------------------

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { runAskMining, type AskMiningStore } from "@/lib/skills/ask-mining-run"
import { runPromotion, type PromotionStore } from "@/lib/skills/promotion-run"

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
    const askResult = await runAskMining({
      store: createAdminSupabaseClient() as unknown as AskMiningStore,
      mode,
      dryRun,
    })

    // AUTO-PROMOTION runs at the END of the WEEKLY distill (§2.4) — never on the nightly routing pass.
    // It is the single chokepoint where corroborated trends + supported feedback patterns reach
    // `active` and stale rows retire; question_demand is never in its decision set (human-only).
    let promotion: Awaited<ReturnType<typeof runPromotion>> | null = null
    if (mode === "weekly") {
      promotion = await runPromotion({
        store: createAdminSupabaseClient() as unknown as PromotionStore,
        dryRun,
      })
      console.log(
        `[ask-mining] weekly: asks ${askResult.groundedAsks}/${askResult.asksRead} grounded, candidates ${askResult.candidates}, rows ${askResult.rowsWritten}; auto-promote ${promotion.promoted}, retire ${promotion.retired}${dryRun ? " (dry-run)" : ""}`,
      )
    } else {
      console.log(
        `[ask-mining] nightly: asks ${askResult.groundedAsks}/${askResult.asksRead} grounded, routed ${askResult.routedPairs} pairs${dryRun ? " (dry-run)" : ""}`,
      )
    }

    return Response.json({ ...askResult, promotion })
  } catch (err) {
    // A learning-system outage must never page as a brief-breaking error — log + 200 so the cron
    // surface stays green and the brief path (which never touches this) is unaffected.
    console.warn("[ask-mining] run failed:", err instanceof Error ? err.message : err)
    return Response.json({ ok: false, error: err instanceof Error ? err.message : "ask-mining failed" })
  }
}
