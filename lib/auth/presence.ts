// "Last seen" — when the user was actually USING the product.
//
// The admin panel used to show auth.users.last_sign_in_at as "Last login". On a passwordless
// magic-link product that is close to useless: the timestamp only moves when a session has to be
// re-established, so someone who opens their brief every morning can read as three weeks idle. It
// answered "when did they last authenticate", never "are they using this".
//
// So: stamp profiles.last_seen_at from the authenticated request path instead. Two throttles keep
// the cost near zero, because this runs on EVERY authed request:
//
//   1. A per-instance in-memory map skips the database entirely inside the window. Fluid reuses
//      instances, so in practice almost every request short-circuits here.
//   2. The write itself carries the window in its WHERE clause, so even on a cold instance (or with
//      many instances racing) the UPDATE only matches a row when the stored value is genuinely
//      stale. Correctness does not depend on the in-memory cache being warm or shared.
//
// Deliberately NOT stamped while impersonating: an admin looking at a customer's dashboard is not
// that customer using the product, and "last seen" is only worth having if it means the person
// themself showed up.

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database.types"

/** Matches the client type used across lib/ (see queue.ts `SB`). */
type PresenceStore = SupabaseClient<Database>

/** How stale the stored value must be before a request bothers to rewrite it. */
export const PRESENCE_THROTTLE_MS = 5 * 60_000

/** Cap on the in-memory throttle map. Bounded by real user count; the cap is a leak backstop for a
 *  long-lived instance, not a capacity plan. Oldest entries are dropped, which at worst costs an
 *  extra conditional UPDATE that the WHERE clause then no-ops. */
const MAX_TRACKED_USERS = 5_000

const lastTouchedMsByUser = new Map<string, number>()

/**
 * PURE: should this request attempt a write?
 *
 * `lastTouchedMs` is when THIS instance last wrote for the user (null = never / evicted).
 * Extracted so the throttle is unit-testable without a client or a clock.
 */
export function shouldTouchLastSeen(args: {
  lastTouchedMs: number | null
  nowMs: number
  throttleMs?: number
}): boolean {
  const { lastTouchedMs, nowMs, throttleMs = PRESENCE_THROTTLE_MS } = args
  if (lastTouchedMs === null) return true
  // Guard against a clock moving backwards: a future timestamp should not lock out writes forever.
  if (lastTouchedMs > nowMs) return true
  return nowMs - lastTouchedMs >= throttleMs
}

/**
 * Cheap pre-check for callers on the hot path: is a write even due for this user?
 *
 * Exists so requireUser() can skip constructing a Supabase client (and reading the impersonation
 * cookie) on the ~99% of requests that would be throttled anyway. touchLastSeen re-checks, so this
 * is purely an optimisation and callers may ignore it.
 */
export function isTouchDue(userId: string, nowMs: number = Date.now()): boolean {
  if (!userId) return false
  return shouldTouchLastSeen({ lastTouchedMs: lastTouchedMsByUser.get(userId) ?? null, nowMs })
}

/** Test seam — the module-level cache would otherwise leak state between cases. */
export function __resetPresenceCacheForTests(): void {
  lastTouchedMsByUser.clear()
}

/**
 * Record that `userId` is active, at most once per PRESENCE_THROTTLE_MS per instance.
 *
 * Never throws and never returns a failure: presence is telemetry, and a failed write must not be
 * able to break a page render. Callers fire-and-forget.
 */
export async function touchLastSeen(
  supabase: PresenceStore,
  userId: string,
  nowMs: number = Date.now(),
): Promise<void> {
  if (!userId) return

  const lastTouchedMs = lastTouchedMsByUser.get(userId) ?? null
  if (!shouldTouchLastSeen({ lastTouchedMs, nowMs })) return

  // Record the attempt BEFORE awaiting, so a burst of concurrent requests on this instance
  // collapses into one write rather than all seeing a cold cache.
  lastTouchedMsByUser.set(userId, nowMs)
  if (lastTouchedMsByUser.size > MAX_TRACKED_USERS) {
    const oldest = lastTouchedMsByUser.keys().next()
    if (!oldest.done) lastTouchedMsByUser.delete(oldest.value)
  }

  const nowIso = new Date(nowMs).toISOString()
  const staleBeforeIso = new Date(nowMs - PRESENCE_THROTTLE_MS).toISOString()

  try {
    await supabase
      .from("profiles")
      .update({ last_seen_at: nowIso })
      // The window lives in the WHERE clause too, so this is a no-op unless the stored value is
      // actually stale — that is what makes the in-memory cache an optimisation rather than the
      // source of truth.
      .eq("id", userId)
      .or(`last_seen_at.is.null,last_seen_at.lt.${staleBeforeIso}`)
  } catch (err) {
    console.warn("[presence] last_seen_at touch failed (non-fatal):", err)
  }
}
