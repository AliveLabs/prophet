// Pure rules for customer-facing team management (ALT-457 phase 1).
//
// Kept free of I/O so the rules that protect an org can be tested directly. The server
// actions in app/(dashboard)/settings/team/actions.ts apply these BEFORE touching the DB;
// the UI applies the same ones to decide what to render, so a disabled control and a
// direct action call fail for the same reason.
//
// Phase 1 grants org-wide access. Per-location scoping (a member holding 2 of 4 locations)
// is the next phase and will extend these rules rather than replace them.

/** Roles that may manage the roster. `member` cannot invite or remove anyone. */
export const TEAM_MANAGER_ROLES = ["owner", "admin"] as const

/** Roles a manager may hand out. `owner` is never invitable — ownership moves by transfer. */
export const INVITABLE_ROLES = ["member", "admin"] as const
export type InvitableRole = (typeof INVITABLE_ROLES)[number]

export function canManageTeam(role: string | null | undefined): boolean {
  return !!role && (TEAM_MANAGER_ROLES as readonly string[]).includes(role)
}

export function isInvitableRole(role: string): role is InvitableRole {
  return (INVITABLE_ROLES as readonly string[]).includes(role)
}

/**
 * Validate + normalize an invited address. Returns null when unusable, so the caller can
 * report one clear error instead of writing a junk row.
 */
export function normalizeInviteEmail(raw: string | null | undefined): string | null {
  const email = (raw ?? "").trim().toLowerCase()
  if (!email) return null
  // Same shape check the admin invite uses. Deliberately permissive: real deliverability is
  // decided by the send, not by a clever regex.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  if (email.length > 254) return null
  return email
}

export interface RemovalRequest {
  /** The member being removed. */
  targetUserId: string
  targetRole: string
  /** Who is asking. */
  actorUserId: string
  actorRole: string
  /** How many owners the org has right now. */
  ownerCount: number
}

export interface RuleResult {
  ok: boolean
  error?: string
}

/**
 * May the actor remove this member?
 *
 * Protects three things: only managers act at all; an org must never be left ownerless
 * (which would strand billing and make the org unmanageable); and an admin must not be
 * able to remove the owner who granted them access.
 */
export function assessRemoval(req: RemovalRequest): RuleResult {
  if (!canManageTeam(req.actorRole)) {
    return { ok: false, error: "Only an owner or admin can remove people." }
  }
  if (req.targetUserId === req.actorUserId) {
    return {
      ok: false,
      error: "You can't remove yourself. Ask another owner or admin to do it.",
    }
  }
  if (req.targetRole === "owner") {
    if (req.actorRole !== "owner") {
      return { ok: false, error: "Only an owner can remove another owner." }
    }
    if (req.ownerCount <= 1) {
      return {
        ok: false,
        error: "This is the only owner. Transfer ownership first, then remove them.",
      }
    }
  }
  return { ok: true }
}

/**
 * May the actor invite at this role?
 *
 * An admin can bring in members but not mint more admins — otherwise admin becomes
 * self-propagating and the owner loses control of who holds elevated access.
 */
export function assessInviteRole(actorRole: string, requestedRole: string): RuleResult {
  if (!canManageTeam(actorRole)) {
    return { ok: false, error: "Only an owner or admin can invite people." }
  }
  if (!isInvitableRole(requestedRole)) {
    return { ok: false, error: "Pick a valid role." }
  }
  if (requestedRole === "admin" && actorRole !== "owner") {
    return { ok: false, error: "Only an owner can invite an admin." }
  }
  return { ok: true }
}
