// ---------------------------------------------------------------------------
// Learning Spine L3 (P17a) — AUTO-PROMOTION + RETIRE RUNNER (thin DB wrapper around the pure
// promotion policy in promotion.ts). Runs at the END of the weekly distill (§2.4):
//   - reads candidate/shadow/active skill_knowledge rows;
//   - decides the status flips (decidePromotions): corroborated external_trend + supported
//     feedback_pattern → active; active rows past their window → retired; question_demand + editorial
//     → NEVER touched (human-only);
//   - applies each flip as a status update.
//
// FAIL-SOFT: a missing/unreadable skill_knowledge → no-op run (floor = today). dryRun decides but never
// writes. One bad update never aborts the run. RETIRE/ROLLBACK stays deploy-free (it's a status flip).
// ---------------------------------------------------------------------------

import { decidePromotions, type PromotableRow, type PromotionDecision } from "@/lib/skills/promotion"

/** Loose surface: reads candidate/shadow/active rows, updates a row's status by id (service-role). */
export type PromotionStore = {
  from: (t: string) => {
    select: (cols: string) => {
      in: (c: string, vals: string[]) => Promise<{ data: Record<string, unknown>[] | null; error: unknown }>
    }
    update: (row: Record<string, unknown>) => {
      eq: (c: string, v: string) => Promise<{ error: { message: string } | null }>
    }
  }
}

export type PromotionResult = {
  dryRun: boolean
  rowsConsidered: number
  promoted: number
  retired: number
  /** by-reason counts for the log. */
  byReason: Record<PromotionDecision["reason"], number>
}

function toRow(r: Record<string, unknown>): PromotableRow {
  const to = r.effective_to
  return {
    id: String(r.id ?? ""),
    skillId: String(r.skill_id ?? ""),
    learningKind: String(r.learning_kind ?? "") as PromotableRow["learningKind"],
    status: String(r.status ?? "") as PromotableRow["status"],
    confidence: typeof r.confidence === "number" ? r.confidence : 0,
    supportN: typeof r.support_n === "number" ? r.support_n : 0,
    effectiveToMs: to ? Date.parse(String(to)) : null,
  }
}

export async function runPromotion(opts: {
  store: PromotionStore
  dryRun?: boolean
  nowMs?: number
}): Promise<PromotionResult> {
  const now = opts.nowMs ?? Date.now()
  const result: PromotionResult = {
    dryRun: !!opts.dryRun,
    rowsConsidered: 0,
    promoted: 0,
    retired: 0,
    byReason: { trend_corroborated: 0, feedback_supported: 0, window_expired: 0 },
  }

  // 1) Read every row that could change state: candidate, shadow (promote source) + active (retire source).
  let rows: PromotableRow[] = []
  try {
    const { data, error } = await opts.store
      .from("skill_knowledge")
      .select("id, skill_id, learning_kind, status, confidence, support_n, effective_to")
      .in("status", ["candidate", "shadow", "active"])
    if (error) return result // fail-soft: table absent/unreadable → no-op (floor = today)
    rows = (data ?? []).map(toRow).filter((r) => r.id && r.skillId)
  } catch {
    return result
  }
  result.rowsConsidered = rows.length
  if (rows.length === 0) return result

  // 2) Decide the flips (PURE). question_demand + editorial are never in the decision set — proven by
  //    the pure policy's AUTO_PROMOTABLE_KINDS gate.
  const decisions = decidePromotions(rows, now)
  for (const d of decisions) {
    result.byReason[d.reason]++
    if (d.to === "active") result.promoted++
    else result.retired++
  }

  if (opts.dryRun || decisions.length === 0) return result

  // 3) Apply each flip as a status update by id (one bad update never aborts the run).
  for (const d of decisions) {
    try {
      const { error } = await opts.store
        .from("skill_knowledge")
        .update({ status: d.to, updated_at: new Date(now).toISOString() })
        .eq("id", d.id)
      if (error) {
        console.warn(`[promotion] update ${d.id} → ${d.to} failed:`, error.message)
        // back out the count so the result reflects what actually landed.
        if (d.to === "active") result.promoted--
        else result.retired--
        result.byReason[d.reason]--
      }
    } catch (e) {
      console.warn(`[promotion] update ${d.id} threw:`, e instanceof Error ? e.message : e)
    }
  }

  return result
}
