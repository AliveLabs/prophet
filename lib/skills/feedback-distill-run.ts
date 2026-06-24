// ---------------------------------------------------------------------------
// Learning Spine L1 (P15) — the WEEKLY feedback-pattern distill RUNNER (thin DB wrapper around the
// pure distill policy in feedback-distill.ts). Reads skill_feedback_rollup, distills the strong/stable
// patterns, and writes them as skill_knowledge `feedback_pattern` rows (reusing P14's table + its
// candidate→active promotion). Idempotent on P14's unique key; dryRun computes but doesn't write.
//
// FAIL-SOFT: a missing/unreadable rollup table → no-op run (floor = today). The gating is in the pure
// policy; this orchestrates the reads/writes only.
// ---------------------------------------------------------------------------

import { distillPatterns, type RollupReadRow } from "@/lib/skills/feedback-distill"
import { ROLLUP_SKILL_IDS } from "@/lib/skills/feedback-rollup"

/** Loose surface for the distill runner (service-role; reads rollup, writes skill_knowledge). */
export type DistillStore = {
  from: (t: string) => {
    select: (cols: string) => {
      in: (c: string, vals: string[]) => Promise<{ data: Record<string, unknown>[] | null; error: unknown }>
    }
    upsert: (rows: Record<string, unknown>[], opts: { onConflict: string }) => Promise<{ error: { message: string } | null }>
  }
}

export type DistillResult = {
  dryRun: boolean
  rollupRows: number
  candidates: number
}

function toReadRow(r: Record<string, unknown>): RollupReadRow {
  return {
    skillId: String(r.skill_id ?? ""),
    scope: (["global", "org", "location"].includes(String(r.scope)) ? r.scope : "location") as RollupReadRow["scope"],
    scopeId: r.scope_id == null ? null : String(r.scope_id),
    playTypeKey: String(r.play_type_key ?? ""),
    bayesScore: typeof r.bayes_score === "number" ? r.bayes_score : 0.5,
    multiplier: typeof r.multiplier === "number" ? r.multiplier : 1.0,
    supportN: typeof r.support_n === "number" ? r.support_n : 0,
    orgSupportN: typeof r.org_support_n === "number" ? r.org_support_n : 0,
  }
}

export async function distillFeedbackPatterns(opts: {
  store: DistillStore
  dryRun?: boolean
  nowMs?: number
}): Promise<DistillResult> {
  const now = opts.nowMs ?? Date.now()
  const result: DistillResult = { dryRun: !!opts.dryRun, rollupRows: 0, candidates: 0 }

  let rows: RollupReadRow[] = []
  try {
    const { data, error } = await opts.store
      .from("skill_feedback_rollup")
      .select("skill_id, scope, scope_id, play_type_key, bayes_score, multiplier, support_n, org_support_n")
      .in("skill_id", ROLLUP_SKILL_IDS)
    if (error) return result // fail-soft: rollup absent/unreadable → no-op (floor = today)
    rows = (data ?? []).map(toReadRow).filter((r) => r.skillId && r.playTypeKey)
  } catch {
    return result
  }
  result.rollupRows = rows.length
  if (rows.length === 0) return result

  const candidates = distillPatterns(rows)
  result.candidates = candidates.length
  if (opts.dryRun || candidates.length === 0) return result

  // Write as skill_knowledge feedback_pattern rows — the EXACT P14 schema, so the existing loader
  // injects them once promoted and retire/rollback is a status flip (deploy-free). status is the
  // conservative default from the policy (disliked → shadow, liked → candidate).
  const payload = candidates.map((c) => ({
    skill_id: c.skillId,
    scope: c.scope,
    scope_id: c.scopeId,
    learning_kind: "feedback_pattern",
    title: c.title,
    snippet: c.snippet,
    provenance: {
      streams: ["click"],
      play_type_key: c.playTypeKey,
      direction: c.direction,
      support_n: c.supportN,
      distilled_by: "model", // policy is deterministic; a model may later refine the prose
      distilled_at: new Date(now).toISOString(),
    },
    confidence: c.confidence,
    support_n: c.supportN,
    status: c.status,
    knowledge_version: `${c.skillId}@feedback+${now.toString(36).slice(-4)}`,
    updated_at: new Date(now).toISOString(),
  }))

  // Idempotent on P14's global / scoped unique keys.
  const globalPayload = payload.filter((p) => p.scope === "global")
  const scopedPayload = payload.filter((p) => p.scope !== "global")
  try {
    if (globalPayload.length) {
      const { error } = await opts.store.from("skill_knowledge").upsert(globalPayload, { onConflict: "skill_id,learning_kind,title" })
      if (error) console.warn("[feedback-distill] global upsert failed:", error.message)
    }
    if (scopedPayload.length) {
      const { error } = await opts.store
        .from("skill_knowledge")
        .upsert(scopedPayload, { onConflict: "skill_id,scope,scope_id,learning_kind,title" })
      if (error) console.warn("[feedback-distill] scoped upsert failed:", error.message)
    }
  } catch (e) {
    console.warn("[feedback-distill] upsert threw:", e instanceof Error ? e.message : e)
  }

  return result
}
