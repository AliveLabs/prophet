// ---------------------------------------------------------------------------
// Non-blocking eval recorder (ALT-543 step 3).
//
// lib/eval/checks.ts holds fifteen deterministic anti-fabrication gates and had ZERO runtime
// callers: it ran in CI against fixtures only. So "did last Tuesday's prompt change start leaking
// ungrounded numbers?" was answerable only by reading briefs by hand.
//
// This runs those same checks over the FINAL brief (post-presenter, post-voice — what the operator
// actually reads) and records the result on the brief. `daily_briefs.brief` is jsonb and
// pipeline-health already queries `brief->skillHealth`, so this needs no migration and becomes
// queryable as `brief->evalCheck`.
//
// NON-BLOCKING, THREE WAYS, and all three are deliberate:
//   1. It never throws. A recorder that can break a build is worse than no recorder.
//   2. It never mutates plays. Violations are observed, not enforced. Runtime enforcement already
//      exists upstream (run.ts ground-filters plays whose refs don't resolve); this is the
//      fleet-wide REGRESSION signal, a different job.
//   3. It costs no model call. Pure functions over data already in memory.
//
// Enforcement is a later, separate decision: get a baseline first. Turning these into a hard gate
// before knowing the normal violation rate would either block real briefs or, worse, teach us to
// ignore the signal.
// ---------------------------------------------------------------------------

import { evaluateBrief, collectStoredQuotes, type Violation } from "@/lib/eval/checks"
import { buildRefIndex, type Dossier } from "@/lib/insights/dossier/types"
import type { Brief } from "@/lib/skills/types"

/** Cap on violations persisted per brief. A pathological build must not bloat the jsonb column;
 *  the total count is kept separately so a truncated list is still honest about the real number. */
export const MAX_RECORDED_VIOLATIONS = 25

export type EvalRecord = {
  ok: boolean
  /** Total violations found, even when `violations` below is truncated. */
  violationCount: number
  /** Per-code tallies — the shape worth querying for a trend ("did ungrounded_number spike?"). */
  byCode: Record<string, number>
  /** Up to MAX_RECORDED_VIOLATIONS individual violations, for debugging a specific brief. */
  violations: Violation[]
  /** True when `violations` was truncated relative to violationCount. */
  truncated?: boolean
}

/**
 * Run the deterministic checks over a finished brief and return a recordable summary.
 *
 * Returns `undefined` when the checks could not run at all, so the caller simply omits the field
 * rather than persisting a misleading `ok: true`. **Absence means "not evaluated", never "clean".**
 */
export function recordBriefEval(brief: Brief, dossier: Dossier): EvalRecord | undefined {
  try {
    const index = buildRefIndex(dossier)
    const storedQuotes = collectStoredQuotes(dossier.ruleOutputs)
    // Geo sanity needs the local/metro split. `demandCalendar.events` is LOCAL-only by contract
    // (role local_foot/local_traffic); metroHooks are the far-away tie-in material.
    const geo = {
      localEventCount: dossier.demandCalendar?.events?.length ?? 0,
      metroHookCount: dossier.demandCalendar?.metroHooks?.length ?? 0,
    }
    const result = evaluateBrief(
      { plays: brief.plays, headline: brief.headline, deck: brief.deck },
      index,
      geo,
      storedQuotes,
    )

    const byCode: Record<string, number> = {}
    for (const v of result.violations) byCode[v.code] = (byCode[v.code] ?? 0) + 1

    const truncated = result.violations.length > MAX_RECORDED_VIOLATIONS
    return {
      ok: result.ok,
      violationCount: result.violations.length,
      byCode,
      violations: result.violations.slice(0, MAX_RECORDED_VIOLATIONS),
      ...(truncated ? { truncated: true } : {}),
    }
  } catch (err) {
    // Fail SILENT-BUT-LOUD: no field on the brief (so nothing reads as clean), one warn line so a
    // permanently broken recorder is visible instead of quietly absent.
    console.warn(`[eval-record] checks failed to run for ${dossier.locationId} (brief unaffected):`, err)
    return undefined
  }
}

/** One log line per build so a regression is visible in logs before anyone queries the column. */
export function logEvalRecord(locationId: string, rec: EvalRecord | undefined): void {
  if (!rec || rec.ok) return
  const summary = Object.entries(rec.byCode)
    .sort((a, b) => b[1] - a[1])
    .map(([code, n]) => `${code}×${n}`)
    .join(", ")
  console.warn(`[eval-record] ${locationId}: ${rec.violationCount} eval violation(s) on the served brief — ${summary}`)
}
