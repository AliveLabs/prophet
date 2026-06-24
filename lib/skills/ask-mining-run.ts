// ---------------------------------------------------------------------------
// Learning Spine L2 (P17a) — PIPELINE 3 RUNNER (thin DB wrapper around the pure ask-mining policy).
//
// NIGHTLY (routing): read recent GROUNDED ask_history, route each to the skill(s) it touches, and
//   report the per-skill routed counts (cheap, deterministic, NO LLM, NO write). The routing is
//   re-derived from ask_history each run, so it needs NO persistence table — ask_history IS the store
//   (rides the existing table, exactly as the spec requires: "no new table").
// WEEKLY (distill): over the trailing window, route + cluster recurring grounded asks into
//   skill_knowledge `question_demand` (coverage gap) / `editorial` (framing) rows. Written ALWAYS as
//   `candidate` — NEVER active/shadow — so the human gate (TicketAdmin) is the only path to active.
//   Rides the EXACT P14 skill_knowledge schema (question_demand is already a learning_kind), so NO new
//   migration is needed and retire/rollback is a status flip.
//
// FAIL-SOFT: a missing/unreadable ask_history → no-op run (floor = today; nothing learned, brief
// unaffected). dryRun computes but never writes.
// ---------------------------------------------------------------------------

import { clusterQuestionDemand, routeAsk, type AskForMining, type RoutedAsk } from "@/lib/skills/ask-mining"
import { PRODUCER_SKILLS } from "@/lib/skills/registry"

/** Loose surface: reads ask_history (recent) + existing question_demand rows (to avoid clobbering a
 *  human decision), upserts skill_knowledge (service-role; loose-typed). */
export type AskMiningStore = {
  from: (t: string) => {
    select: (cols: string) => {
      gte: (c: string, v: string) => Promise<{ data: Record<string, unknown>[] | null; error: unknown }>
      in: (c: string, vals: string[]) => Promise<{ data: Record<string, unknown>[] | null; error: unknown }>
    }
    upsert: (rows: Record<string, unknown>[], opts: { onConflict: string }) => Promise<{ error: { message: string } | null }>
  }
}

export type AskMiningResult = {
  mode: "nightly" | "weekly"
  dryRun: boolean
  asksRead: number
  groundedAsks: number
  /** routed (skill,ask) pairs across all skills (nightly) — a signal of routing coverage. */
  routedPairs: number
  /** question_demand/editorial candidates distilled (weekly only). */
  candidates: number
  /** rows actually written (0 on dryRun / nightly / on a write error). */
  rowsWritten: number
  bySkill: Record<string, number>
  /** Persistence (upsert) failures, SURFACED — never swallowed. A non-empty array means distilled
   *  question_demand/editorial candidates did NOT reach skill_knowledge (e.g. an ON CONFLICT mismatch).
   *  The run stays fail-soft (no throw), but it can NEVER be invisible — this is what hid the bug. */
  writeErrors: Array<{ scope: string; error: string }>
}

function toAsk(r: Record<string, unknown>): AskForMining {
  return {
    id: String(r.id ?? ""),
    locationId: String(r.location_id ?? ""),
    question: String(r.question ?? ""),
    grounded: Boolean(r.grounded),
    confidence: (["high", "medium", "low"].includes(String(r.confidence)) ? r.confidence : "low") as AskForMining["confidence"],
    sources: Array.isArray(r.sources) ? (r.sources as unknown[]).map(String) : [],
    createdAt: String(r.created_at ?? ""),
  }
}

/**
 * Run PIPELINE 3. NIGHTLY routes only (no write); WEEKLY routes + clusters + writes candidate rows.
 * The routing is shared (pure routeAsk); the WEEKLY pass additionally clusters per skill.
 */
export async function runAskMining(opts: {
  store: AskMiningStore
  mode: "nightly" | "weekly"
  dryRun?: boolean
  nowMs?: number
  /** trailing window of asks to consider. Nightly looks back a few days; weekly a few weeks. */
  windowDays?: number
}): Promise<AskMiningResult> {
  const now = opts.nowMs ?? Date.now()
  const windowDays = opts.windowDays ?? (opts.mode === "weekly" ? 28 : 2)
  const sinceIso = new Date(now - windowDays * 86_400_000).toISOString()
  const result: AskMiningResult = {
    mode: opts.mode,
    dryRun: !!opts.dryRun,
    asksRead: 0,
    groundedAsks: 0,
    routedPairs: 0,
    candidates: 0,
    rowsWritten: 0,
    bySkill: {},
    writeErrors: [],
  }

  // 1) Read recent asks. FAIL-SOFT: any error → no-op (floor = today).
  let asks: AskForMining[] = []
  try {
    const { data, error } = await opts.store
      .from("ask_history")
      .select("id, location_id, question, grounded, confidence, sources, created_at")
      .gte("created_at", sinceIso)
    if (error) return result
    asks = (data ?? []).map(toAsk).filter((a) => a.id && a.question)
  } catch {
    return result
  }
  result.asksRead = asks.length
  result.groundedAsks = asks.filter((a) => a.grounded).length
  if (asks.length === 0) return result

  // 2) Route every ask to the skill(s) it touches (guardrails: ungrounded → routed nowhere;
  //    below ROUTE_MIN_RELEVANCE → dropped for that skill). Collect routed asks per skill.
  const routedBySkill = new Map<string, RoutedAsk[]>()
  for (const ask of asks) {
    for (const hit of routeAsk(ask)) {
      result.routedPairs++
      const arr = routedBySkill.get(hit.skillId) ?? []
      arr.push({ ...ask, skillId: hit.skillId, relevance: hit.relevance })
      routedBySkill.set(hit.skillId, arr)
    }
  }
  for (const [skillId, routed] of routedBySkill) result.bySkill[skillId] = routed.length

  // NIGHTLY: routing only — no clustering, no write. (The signal is the routedPairs/bySkill report.)
  if (opts.mode === "nightly") return result

  // 3) WEEKLY: cluster recurring grounded asks per skill → candidate rows.
  const acceptedSkills = new Set(PRODUCER_SKILLS.map((s) => s.id))
  const allCandidates = [...routedBySkill]
    .filter(([skillId]) => acceptedSkills.has(skillId))
    .flatMap(([skillId, routed]) => clusterQuestionDemand(skillId, routed))
  result.candidates = allCandidates.length

  // PROTECT A HUMAN DECISION: never re-write a (skill, learning_kind, title) row whose status is no
  // longer 'candidate' — a human already promoted (active/shadow) or retired it. We read back the
  // existing ask-stream rows for the candidate skills and DROP any candidate that collides with a
  // non-candidate row, so the weekly upsert can never revert a human's promote/retire (the §2.3.3
  // human gate is durable). New themes + still-candidate themes are upserted (refreshing support_n).
  const lockedTitles = new Set<string>()
  try {
    const skillsInPlay = [...new Set(allCandidates.map((c) => c.skillId))]
    if (skillsInPlay.length) {
      const { data } = await opts.store
        .from("skill_knowledge")
        .select("skill_id, learning_kind, title, status")
        .in("skill_id", skillsInPlay)
      for (const r of data ?? []) {
        const kind = String(r.learning_kind ?? "")
        const status = String(r.status ?? "")
        if ((kind === "question_demand" || kind === "editorial") && status !== "candidate") {
          lockedTitles.add(`${String(r.skill_id)}::${kind}::${String(r.title)}`)
        }
      }
    }
  } catch {
    // a read failure → conservatively skip the lock check (the upsert still only writes 'candidate',
    // and the worst case is re-presenting a theme for re-confirmation; never a silent override of data).
  }

  const payload = allCandidates
    .filter((c) => !lockedTitles.has(`${c.skillId}::${c.learningKind}::${c.title}`)) // skip human-decided rows.
    .map((c) => ({
      skill_id: c.skillId,
      scope: "global", // question_demand reflects fleet-wide operator demand; human review scopes if needed.
      scope_id: null,
      learning_kind: c.learningKind, // question_demand | editorial
      title: c.title,
      snippet: c.snippet,
      provenance: {
        streams: ["ask"],
        demand_type: c.demandType, // coverage_gap | framing
        sample_ask_ids: c.sampleAskIds, // PROVENANCE ONLY — never a citable evidenceRef.
        support_n: c.supportN,
        distilled_by: "model", // policy deterministic; a model may later refine the prose.
        distilled_at: new Date(now).toISOString(),
      },
      confidence: c.confidence,
      support_n: c.supportN,
      status: "candidate", // ★ ALWAYS candidate — question_demand is human-only (never auto-promoted).
      knowledge_version: `${c.skillId}@ask+${now.toString(36).slice(-4)}`,
      updated_at: new Date(now).toISOString(),
    }))

  if (opts.dryRun || payload.length === 0) return result

  // Idempotent on P14's dedupe index (skill_id, scope, scope_id, learning_kind, title) — NULLS NOT
  // DISTINCT, so global rows (scope_id NULL) dedupe too. Re-running refreshes a still-candidate theme's
  // snippet/support in place instead of duplicating. Rows a human already moved out of 'candidate' were
  // dropped above (lockedTitles), so this upsert can NEVER revert a promote/retire — the human gate is
  // durable. onConflict MUST match uq_skill_knowledge_dedupe (the old "skill_id,learning_kind,title"
  // targeted a PARTIAL index → 42P10 → the error was swallowed → 0 rows; every candidate row here is
  // global, scope_id=null, set above).
  try {
    const { error } = await opts.store
      .from("skill_knowledge")
      .upsert(payload, { onConflict: "skill_id,scope,scope_id,learning_kind,title" })
    if (error) {
      // SURFACE it (never swallow): fail-soft (no throw), but visible in the result + the logs.
      console.warn("[ask-mining] candidate upsert failed:", error.message)
      result.writeErrors.push({ scope: "global", error: error.message })
    } else {
      result.rowsWritten = payload.length
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn("[ask-mining] upsert threw:", msg)
    result.writeErrors.push({ scope: "global", error: msg })
  }

  return result
}
