// ---------------------------------------------------------------------------
// Per-brief spend ceiling (ALT-543 step 2).
//
// The engine had no dollar guard of any kind. The budget-aware worker protects WALL CLOCK against
// the 800s route cap; nothing protected spend. A prompt that grows, or an effort dial nudged up,
// moves the whole fleet with no tripwire, and the first signal is an invoice.
//
// This module holds a BUILD-SCOPED budget. It deliberately does not import the provider: the
// provider imports this, computes its own spend-so-far from the counters it already keeps, and asks
// `degradeFor` whether the next call should run cheaper. Keeping this module free of provider
// imports is what avoids an import cycle.
//
// WHY AsyncLocalStorage rather than a module-level global: Fluid Compute co-locates builds on one
// instance (that is the whole reason the concurrency governor exists). A global counter would let
// one expensive location's spend degrade an unrelated location's brief in the same process. ALS
// scopes the budget to the build that opened it, so concurrent builds cannot contaminate each other.
//
// DEGRADE, NEVER ABORT. A half-built brief is worth less than a cheaper complete one, and aborting
// would land in the deterministic-fallback path, which is the failure mode this codebase has twice
// been bitten by. Over-ceiling calls step effort down one notch; the brief still completes.
// ---------------------------------------------------------------------------

import { AsyncLocalStorage } from "node:async_hooks"
import type { ModelTokenTotals } from "@/lib/ai/pricing"
import type { Effort } from "@/lib/ai/provider"
import { resolveBudgetEnv } from "@/lib/ai/budget-env"

/** Per-brief ceiling in USD. UNSET = disabled, and that is the deliberate default.
 *
 *  We do not have an observed-spend baseline yet, and a ceiling guessed too low silently degrades
 *  good briefs — precisely the class of quiet quality regression that cost two weeks in 2026-06.
 *  `/admin/health` already reports $/brief; once there is a week of real figures, set this to a
 *  multiple of observed p95 rather than to a number someone invented. Same discipline the fleet
 *  daily cap (step 7) is waiting on. */
export const PER_BRIEF_CEILING_USD = resolveBudgetEnv(
  "spend-budget",
  "ANTHROPIC_PER_BRIEF_CEILING_USD",
  process.env.ANTHROPIC_PER_BRIEF_CEILING_USD,
)

export type SpendBudgetState = {
  /** USD ceiling for this build. */
  ceilingUsd: number
  /** Provider token snapshot taken when the build opened, so spend-so-far is a delta not a total. */
  startTokens: Record<string, ModelTokenTotals>
  /** How many calls ran degraded because the ceiling was already crossed. */
  degradedCalls: number
  /** Highest spend-so-far observed during the build (USD). Recorded even when never degraded. */
  peakSpendUsd: number
}

const store = new AsyncLocalStorage<SpendBudgetState>()

/** Open a build-scoped budget around `fn`. A null ceiling runs `fn` with no budget context at all,
 *  so the provider's fast path stays a single undefined check. */
export function runWithSpendBudget<T>(
  ceilingUsd: number | null,
  startTokens: Record<string, ModelTokenTotals>,
  fn: () => Promise<T>,
): Promise<T> {
  if (ceilingUsd === null) return fn()
  return store.run({ ceilingUsd, startTokens, degradedCalls: 0, peakSpendUsd: 0 }, fn)
}

/** The active build's budget, or undefined outside a budgeted build (tests, one-off calls, Ask). */
export function currentSpendBudget(): SpendBudgetState | undefined {
  return store.getStore()
}

/** One notch cheaper. `low` is the floor — we degrade cost, never disable thinking, because the
 *  no-thinking path sends `temperature`, which the Claude 5 family rejects outright. */
export function oneNotchCheaper(effort: Effort): Effort {
  return effort === "high" ? "medium" : "low"
}

/**
 * Decide whether the next model call should run degraded, and record the observation.
 *
 * `spendSoFarUsd` is supplied by the caller (the provider) because only it holds the counters and
 * the pricing table. Returns the effort to actually use.
 */
export function effortForNextCall(effort: Effort, spendSoFarUsd: number, label?: string): Effort {
  const budget = store.getStore()
  if (!budget) return effort
  if (spendSoFarUsd > budget.peakSpendUsd) budget.peakSpendUsd = spendSoFarUsd
  if (spendSoFarUsd < budget.ceilingUsd) return effort

  const degraded = oneNotchCheaper(effort)
  budget.degradedCalls += 1
  // Log every crossing rather than throttling: this should be RARE, and a silent cost guard is
  // indistinguishable from no cost guard. If this becomes chatty, the ceiling is set wrong.
  console.warn(
    `[spend-budget] per-brief ceiling crossed: spend≈$${spendSoFarUsd.toFixed(4)} ≥ $${budget.ceilingUsd.toFixed(4)} — ` +
      `${label ? `${label}: ` : ""}effort ${effort}→${degraded} (call ${budget.degradedCalls} degraded this build)`,
  )
  return degraded
}
