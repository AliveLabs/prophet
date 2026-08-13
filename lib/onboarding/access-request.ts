// State machine for org access requests (beta rescue phase 3.5; storage:
// public.org_access_requests, migration 20260813120000).
//
// A request is created when a signup collides with a live customer org (see
// lib/onboarding/org-collision.ts) and the requester asks the org's owner to let them in.
// Owners ignore email, and the requester often already knows the owner is gone, so the
// lifecycle has two pressure valves:
//
//   pending --(4 days, no grant)--> nudged --(7 days total, still no grant)--> escalated
//      \_______________ requester clicks "contact the Ticket team" ________________/
//
//   any open state --(requester becomes a member)--> granted     (terminal)
//   pending/nudged --(30 days, nobody moved)-------> expired     (terminal)
//
// "escalated" means the request is on OUR desk (internal alert fired, requester contact
// captured); it never auto-expires, because expiring it would silently drop a human who
// explicitly asked us for help. It still auto-resolves to granted when membership appears.
//
// Pure: the daily cron (app/api/cron/access-requests) and the requester-facing actions
// call these to decide, then do the I/O themselves. Times compare in whole days measured
// from created_at, so a late-running cron catches up deterministically (a request that is
// 9 days old but never nudged gets the nudge first; escalation follows a later run).

export type AccessRequestStatus =
  | "pending"
  | "nudged"
  | "escalated"
  | "granted"
  | "expired"

export type AccessRequestTransition = "nudge" | "escalate" | "expire" | "none"

export const NUDGE_AFTER_DAYS = 4
export const ESCALATE_AFTER_DAYS = 7
export const EXPIRE_AFTER_DAYS = 30

const DAY_MS = 86_400_000

export interface AccessRequestForPlanning {
  status: AccessRequestStatus
  /** ISO timestamp the request was created. */
  createdAt: string
}

/** Statuses in which a request is still waiting on someone (owner, us, or the clock). */
export function isOpenStatus(status: AccessRequestStatus): boolean {
  return status === "pending" || status === "nudged" || status === "escalated"
}

/** The requester may push "contact the Ticket team" while the owner still hasn't acted. */
export function canRequesterEscalate(status: AccessRequestStatus): boolean {
  return status === "pending" || status === "nudged"
}

export function ageInDays(createdAt: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(createdAt).getTime()) / DAY_MS)
}

/**
 * What the daily cron should do with one request right now. Exactly one step per run:
 * nudge before escalate even when both thresholds have passed (cron downtime), so the
 * owner always gets the reminder before we are pulled in.
 */
export function planAccessRequestTransition(
  request: AccessRequestForPlanning,
  now: Date
): AccessRequestTransition {
  if (!isOpenStatus(request.status)) return "none"
  if (request.status === "escalated") return "none"

  const age = ageInDays(request.createdAt, now)

  if (age >= EXPIRE_AFTER_DAYS) return "expire"
  if (request.status === "pending" && age >= NUDGE_AFTER_DAYS) return "nudge"
  if (request.status === "nudged" && age >= ESCALATE_AFTER_DAYS) return "escalate"
  return "none"
}
