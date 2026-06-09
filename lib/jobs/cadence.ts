// ---------------------------------------------------------------------------
// Pull cadence / skip decisions (Spine rewrite · Phase 7)
//
// Data365 (and other paid providers) have no batch endpoint — every profile pull
// costs credits. The billing lever is therefore NOT pulling when we don't need to:
//   • skip a profile whose last pull is still within the mode's cadence window;
//   • re-check DORMANT/empty accounts on a long cadence (don't burn credits daily on
//     a dead account);
//   • always pull on first_run or an explicit forced ad-hoc refresh.
// Pure decision logic, unit-tested; the social pipeline consults it before each pull.
// ---------------------------------------------------------------------------

import { classifyNow } from "@/lib/freshness/contract"

export type PullMode = "first_run" | "daily" | "weekly" | "adhoc"

// Minimum hours between paid pulls of the same profile, by mode.
const MIN_HOURS: Record<PullMode, number> = {
  first_run: 0,
  daily: 20, // a "daily" cadence shouldn't re-pull something fetched a few hours ago
  weekly: 6.5 * 24,
  adhoc: 20, // ad-hoc without force still respects a short floor unless forced
}
// Dormant/empty accounts: re-check at most this often regardless of mode (credit saver).
const DORMANT_MIN_HOURS = 14 * 24

export type PullDecision = { pull: boolean; reason: string }

export function shouldPull(args: {
  /** When we last pulled this profile (captured_at of its latest snapshot). */
  lastCapturedAt: string | null
  /** Recency of the content in that last pull (content_as_of). */
  lastContentAsOf: string | null
  isEmpty?: boolean
  mode: PullMode
  force?: boolean
  now?: string
}): PullDecision {
  if (args.force) return { pull: true, reason: "forced refresh" }
  if (args.mode === "first_run") return { pull: true, reason: "first run" }
  if (!args.lastCapturedAt) return { pull: true, reason: "never pulled" }

  const now = args.now ?? new Date().toISOString()
  const sinceH = (Date.parse(now) - Date.parse(args.lastCapturedAt)) / 3_600_000
  if (Number.isNaN(sinceH)) return { pull: true, reason: "unparseable last pull" }

  const status = classifyNow({
    contentAsOf: args.lastContentAsOf,
    capturedAt: args.lastCapturedAt,
    isEmpty: args.isEmpty,
    kind: "social",
    now,
  })
  const dormant = status === "dormant" || status === "empty" || status === "undated"
  const minHours = dormant ? DORMANT_MIN_HOURS : MIN_HOURS[args.mode]

  if (sinceH >= minHours) {
    return { pull: true, reason: `${Math.round(sinceH)}h since last pull ≥ ${Math.round(minHours)}h cadence` }
  }
  return {
    pull: false,
    reason: `skip — pulled ${Math.round(sinceH)}h ago (<${Math.round(minHours)}h${dormant ? ", dormant long-cadence" : ""})`,
  }
}
