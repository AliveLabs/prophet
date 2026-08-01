// ---------------------------------------------------------------------------
// Fleet daily spend cap (ALT-543 step 7).
//
// The per-brief ceiling (lib/ai/spend-budget.ts) bounds ONE build. It cannot see a runaway that is
// spread thin: a prompt that grows 20% across every location on every build stays under any sane
// per-brief ceiling and still moves the monthly invoice. This is the tripwire for that, so a runaway
// costs one day instead of one month.
//
// HARD STOP, not degrade — the opposite choice from the per-brief ceiling, on purpose. Per-brief,
// degrading is right because a cheaper complete brief beats a half-built one. Fleet-wide, the
// question is different: something is already wrong, and the useful behaviour is to stop digging and
// tell a human. A degraded fleet would quietly serve worse briefs everywhere and still spend all day.
//
// CROSS-INSTANCE by construction. Fluid runs many instances, so an in-process counter cannot see
// fleet spend. Today's total is summed from what each build already records on its own row
// (providerStats.estimatedUsd, added in step 2), which makes the DB the shared ledger with no new
// table and no coordination protocol.
//
// FAILS OPEN, ALWAYS. If the spend query errors, briefs still build. A cost guard that can halt the
// product because a SELECT failed is a worse outage than the overspend it prevents.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database.types"
import type { Brief } from "@/lib/skills/types"

export type FleetBudgetStore = SupabaseClient<Database>

/** Fleet-wide USD cap for one UTC day. UNSET = DISABLED, the deliberate default.
 *
 *  Same discipline as the per-brief ceiling: there is no observed baseline yet, and a cap guessed
 *  too low is a self-inflicted outage that stops every brief. `providerStats.estimatedUsd` now lands
 *  on every brief, so set this from a week of real daily totals, as a MULTIPLE of observed — this is
 *  a runaway tripwire, not a budget target. */
export const FLEET_DAILY_CAP_USD = (() => {
  const raw = process.env.ANTHROPIC_FLEET_DAILY_CAP_USD
  if (raw === undefined || raw.trim() === "") return null
  const n = Number(raw)
  if (Number.isFinite(n) && n > 0) return n
  console.warn(
    `[fleet-budget] ANTHROPIC_FLEET_DAILY_CAP_USD="${raw}" is not a positive number — cap DISABLED.`,
  )
  return null
})()

export type FleetSpendCheck = {
  /** Summed estimatedUsd across today's briefs. Null when it could not be determined. */
  spentUsd: number | null
  capUsd: number | null
  /** True only when a cap is configured AND today's spend has reached it. */
  exceeded: boolean
  /** How many brief rows contributed, for sanity-checking the figure in logs. */
  briefs: number
}

/** UTC day key, matching how `date_key` is written on the brief row. */
export function utcDateKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/**
 * Today's fleet spend versus the cap.
 *
 * Never throws. On any failure it reports `spentUsd: null` and `exceeded: false`, so callers keep
 * building — see the fails-open note above.
 */
export async function checkFleetSpend(
  store: FleetBudgetStore,
  opts: { dateKey?: string; capUsd?: number | null } = {},
): Promise<FleetSpendCheck> {
  const capUsd = opts.capUsd === undefined ? FLEET_DAILY_CAP_USD : opts.capUsd
  const dateKey = opts.dateKey ?? utcDateKey()
  if (capUsd === null) return { spentUsd: null, capUsd: null, exceeded: false, briefs: 0 }

  try {
    const { data, error } = await store.from("daily_briefs").select("brief").eq("date_key", dateKey)
    if (error) {
      console.warn(`[fleet-budget] spend query failed, FAILING OPEN (builds continue): ${error.message}`)
      return { spentUsd: null, capUsd, exceeded: false, briefs: 0 }
    }
    let spentUsd = 0
    let briefs = 0
    for (const row of data ?? []) {
      const usd = (row.brief as Brief | null)?.providerStats?.estimatedUsd
      if (typeof usd === "number" && Number.isFinite(usd)) {
        spentUsd += usd
        briefs += 1
      }
    }
    return { spentUsd, capUsd, exceeded: spentUsd >= capUsd, briefs }
  } catch (err) {
    console.warn("[fleet-budget] spend check threw, FAILING OPEN (builds continue):", err)
    return { spentUsd: null, capUsd, exceeded: false, briefs: 0 }
  }
}

/** Log line for a check, whichever way it went. */
export function describeFleetSpend(c: FleetSpendCheck): string {
  if (c.capUsd === null) return "fleet cap disabled"
  if (c.spentUsd === null) return `fleet spend unknown (cap $${c.capUsd.toFixed(2)}) — failing open`
  return `fleet spend ≈$${c.spentUsd.toFixed(2)} of $${c.capUsd.toFixed(2)} across ${c.briefs} brief(s)`
}
