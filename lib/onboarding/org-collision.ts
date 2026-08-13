// Duplicate-org PREVENTION at signup (beta rescue phase 3.5, pairs with ALT-576 whose
// admin merge tool is the CLEANUP half). The Fog Harbor Fish House incident: one real
// restaurant, independently onboarded three times by three coworkers, each signup minting
// a fresh org with a fresh owner. The merge tool untangles that after the fact; this
// module keeps it from happening again, which matters because a marketing push is about
// to drive signups at restaurants that may already be on Ticket.
//
// Identity: a place is `locations.primary_place_id` (the Google place id). That is the
// same key the whole location model hangs off (dossier build, discovery exclusion,
// re-linking on address change), so "this restaurant already has an org" means "a live
// org owns a location with this primary_place_id". Name/address matching is deliberately
// NOT used: places ids are stable and exact, fuzzy matching creates false positives.
//
// Pure classification only, no Supabase: app/onboarding/actions.ts loads the rows and
// supplies membership; tests exercise every branch with fakes (same pattern as
// lib/admin/org-merge.ts).

/** One live-or-dead org that owns a location with the selected place id. */
export interface CollisionOrgRow {
  orgId: string
  orgKind: string | null
  deletedAt: string | null
  /** Whether the signing-up user is already a member of this org. */
  isMember: boolean
}

export type PlaceCollision =
  /** No live org owns this place: signup proceeds and creates the org. */
  | { kind: "none" }
  /**
   * The user already belongs to the org that owns this place (the most common duplicate:
   * the same person signing up twice). No request needed, just point them home.
   */
  | { kind: "already_member"; orgId: string }
  /**
   * A live customer org owns this place. The signup must not create a second org or grant
   * ownership: show the request-access screen instead.
   */
  | { kind: "real"; orgId: string }
  /**
   * A demo or test org owns this place. Request-access would dead-end at one of OUR
   * admins, so this branch is a sales signal instead: alert us internally and collect the
   * requester's contact ("we'll set you up"). Test orgs take this branch too: like demos
   * they are internal showcases, and a real operator colliding with one is still a human
   * we need to hand the location to, never someone who should self-serve a duplicate org.
   */
  | { kind: "demo"; orgId: string }

/**
 * Classify what a signup should do when the selected place already has org(s) attached.
 *
 * Precedence, after dropping soft-deleted orgs (a deleted org holds nothing):
 *   1. an org the user is already a member of  -> already_member
 *   2. any real (customer) org                 -> real (request access from its owner)
 *   3. any demo/test org                       -> demo (internal alert + contact capture)
 *   4. nothing live                            -> none
 *
 * Membership outranks kind on purpose: a member colliding with their own org has access
 * already, and showing them a request-access screen for their own team would be absurd.
 * Real outranks demo because when BOTH exist (pre-cleanup duplicates), the customer org is
 * the one the requester's team actually operates.
 */
export function classifyPlaceCollision(rows: CollisionOrgRow[]): PlaceCollision {
  const seen = new Set<string>()
  const live = rows.filter((r) => {
    if (r.deletedAt) return false
    if (seen.has(r.orgId)) return false
    seen.add(r.orgId)
    return true
  })

  if (live.length === 0) return { kind: "none" }

  const member = live.find((r) => r.isMember)
  if (member) return { kind: "already_member", orgId: member.orgId }

  const real = live.find((r) => (r.orgKind ?? "real") === "real")
  if (real) return { kind: "real", orgId: real.orgId }

  return { kind: "demo", orgId: live[0].orgId }
}
