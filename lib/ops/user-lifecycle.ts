// ---------------------------------------------------------------------------
// Where each user actually is in the lifecycle, as one shared definition.
//
// ── THE BUG THIS REPLACES (found 2026-08-21 by Bryan) ──────────────────────────────────────
// Both admin surfaces computed a single "Never onboarded" tile as:
//
//     hasOnboarded = !!profile?.current_organization_id      // app/admin/users/page.tsx
//     neverOnboarded = authUsers.filter(u => !profileIdsWithCurrentOrg.has(u.id))   // app/admin/page.tsx
//
// That is not "never onboarded", it is "not attached to an org", and the two come apart in
// BOTH directions:
//
//   MISSED (false negative): an INVITED user has a membership row and a
//   current_organization_id set for them, but has never signed in. They are the clearest
//   possible case of never onboarding, and the org check classified them as onboarded.
//   Two real users (megan@, larry.glass@) sat in this state and never appeared in the count.
//
//   WRONGLY INCLUDED (false positive): a user who onboarded, used the product for weeks, and
//   later had their org deleted has no current_organization_id, so they were reported as never
//   onboarded. That is how the number came to read 1 when the true answer was 2, and the 1 was
//   not even one of the 2.
//
// So the tile was reporting a number where every single row was wrong. This is the standing
// "a metric must not share the predicate with the thing it measures" rule: the count was derived
// from org attachment while claiming to measure activation.
//
// ── THE FIX: two states, each with a predicate that matches its label ──────────────────────
// `never_signed_in` is checked FIRST, and the order is load-bearing. Invited users have BOTH a
// current_organization_id and a null last_sign_in_at, so checking org membership first
// reclassifies them as onboarded, which is exactly the original bug.
//
// ── WHY last_sign_in_at AND NOT last_seen_at ───────────────────────────────────────────────
// These answer different questions and must not be collapsed. `last_seen_at` is a product-touch
// timestamp used for "active recently"; on a magic-link product `last_sign_in_at` only moves when
// a session lapses, so it badly under-counts ACTIVE users. But for "did they EVER get in",
// last_sign_in_at is the right and safe field: it is null if and only if the user has never
// authenticated once. Never-signed-in users have both fields null, so they are unaffected by the
// last_seen_at fallback the admin pages apply for display.
// ---------------------------------------------------------------------------

export type UserLifecycleRow = {
  /** `auth.users.last_sign_in_at`, RAW. Null means they have never authenticated, ever. */
  lastSignInAt: string | null
  /**
   * The resolved "last in the product" timestamp the admin pages already display
   * (`profiles.last_seen_at`, falling back to the auth timestamp until the touch path has seen
   * them once). Used ONLY for the active-recently count, never for activation.
   */
  lastSeenAtResolved: string | null
  /** `profiles.current_organization_id`. */
  currentOrganizationId: string | null
  /** Whether the user is currently banned/deactivated. */
  isBanned: boolean
}

export type UserLifecycleStage =
  /** Never authenticated once. Invited-and-never-activated lives here, org row or not. */
  | "never_signed_in"
  /** Got in at least once, but is attached to no organization. Either abandoned setup before
   *  finishing, or their org was later deleted. Both are "cannot use the product right now". */
  | "signed_in_no_org"
  /** Signed in and attached to an org. */
  | "onboarded"

/**
 * PURE. Order matters: never-signed-in is decided before any org check, because an invited user
 * carries a current_organization_id while having never signed in, and testing the org first is
 * what hid them.
 */
export function classifyUserLifecycle(u: UserLifecycleRow): UserLifecycleStage {
  if (u.lastSignInAt == null) return "never_signed_in"
  if (u.currentOrganizationId == null) return "signed_in_no_org"
  return "onboarded"
}

export type UserLifecycleStats = {
  total: number
  /** Invited or created, never authenticated. THIS is "never onboarded". */
  neverSignedIn: number
  /** Signed in but attached to no org. Reported separately on purpose: it is a different
   *  problem with a different fix, and merging the two is what produced a wrong number. */
  signedInNoOrg: number
  onboarded: number
  /** Seen in the product within the window. Uses lastSeenAtResolved, not the auth event. */
  activeLast7d: number
  deactivated: number
}

export const ACTIVE_WINDOW_DAYS = 7

/** PURE. `nowMs` is injectable so the window arithmetic is testable without a clock. */
export function summarizeUserLifecycle(
  rows: readonly UserLifecycleRow[],
  opts: { nowMs?: number; windowDays?: number } = {},
): UserLifecycleStats {
  const nowMs = opts.nowMs ?? Date.now()
  const windowMs = (opts.windowDays ?? ACTIVE_WINDOW_DAYS) * 24 * 60 * 60 * 1000
  const cutoff = nowMs - windowMs

  const stats: UserLifecycleStats = {
    total: rows.length,
    neverSignedIn: 0,
    signedInNoOrg: 0,
    onboarded: 0,
    activeLast7d: 0,
    deactivated: 0,
  }

  for (const r of rows) {
    switch (classifyUserLifecycle(r)) {
      case "never_signed_in":
        stats.neverSignedIn += 1
        break
      case "signed_in_no_org":
        stats.signedInNoOrg += 1
        break
      default:
        stats.onboarded += 1
    }
    if (r.isBanned) stats.deactivated += 1
    const seen = r.lastSeenAtResolved ? Date.parse(r.lastSeenAtResolved) : NaN
    if (Number.isFinite(seen) && seen > cutoff) stats.activeLast7d += 1
  }

  return stats
}
