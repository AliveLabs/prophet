// Platform-admin roles + capability matrix (admin-rebuild Phase 6a).
//
// PURE module — no I/O, no Supabase, no Next. The single source of truth for "what can
// each role do". The DB column `platform_admins.role` carries a role; this maps roles to
// capabilities, and the gate (lib/auth/platform-admin.ts + withAdminAction) enforces it.
//
// Design: capabilities map to a MINIMUM role, and roles are ranked. A role has a capability
// iff its rank >= the capability's required rank. This makes the matrix impossible to
// misconfigure into an unreachable/contradictory state (vs. hand-maintained per-role sets),
// and the exhaustiveness test guarantees every capability has a min role.

export const ADMIN_ROLES = ["super_admin", "admin", "read_only"] as const
export type AdminRole = (typeof ADMIN_ROLES)[number]

// Higher rank = more privilege. Capability checks are `rank(role) >= rank(minRole)`.
export const ROLE_RANK: Record<AdminRole, number> = {
  read_only: 0,
  admin: 1,
  super_admin: 2,
}

// Every gated capability in the admin panel. Adding a capability here forces (via the
// exhaustiveness test) a deliberate min-role choice — you can't ship an ungated one.
export type Capability =
  | "view" // read any admin data
  | "export" // download CSV exports
  | "waitlist.manage" // approve / decline / resend waitlist
  | "user.manage" // invite / edit / (de)activate / magic-link / membership / tombstone
  | "user.impersonate" // sign in as a user
  | "org.manage" // edit info / tier / trial / (de)activate / transfer / clear-refresh
  | "org.delete" // hard-delete an org (real orgs additionally require super_admin in-body)
  | "demo.manage" // create + clear demo/test orgs
  | "email.send" // custom / broadcast email
  | "billing.convert" // generate a paid Stripe checkout for a Customer org
  | "user.delete" // hard-delete a user (auth + cascade)
  | "admin.manage" // add / remove / re-role platform admins
  | "knowledge.manage" // promote/retire learned skill_knowledge rows (the §2.3.3 human gate)
  | "source_quality.manage" // mark-resolved/reopen a source-quality triage flag (ALT-246)

// Minimum role required for each capability. Read-only = view + export; admin = the
// day-to-day surface; super_admin = the destructive / billing / governance surface.
// Org-kind-conditional rules (e.g. an admin may delete a demo org but a Customer org needs
// super_admin) are enforced in-body via requireSuperAdmin(), not here.
export const CAPABILITY_MIN_ROLE: Record<Capability, AdminRole> = {
  view: "read_only",
  export: "read_only",
  "waitlist.manage": "admin",
  "user.manage": "admin",
  "user.impersonate": "admin",
  "org.manage": "admin",
  "org.delete": "admin",
  "demo.manage": "admin",
  "email.send": "admin",
  "billing.convert": "super_admin",
  "user.delete": "super_admin",
  "admin.manage": "super_admin",
  // The learning-system human gate (P17a): promoting a learned row (esp. a global-scope change or a
  // human-only question_demand) to ACTIVE — or retiring one — alters what every brief is built from.
  // That is governance-grade, so it's super_admin only (bryan + chris), like admin.manage.
  "knowledge.manage": "super_admin",
  // Triage is data-quality bookkeeping (not governance-grade like knowledge.manage) — day-to-day
  // admin work, so it sits at the same bar as org.manage/user.manage.
  "source_quality.manage": "admin",
}

/** True iff `role` ranks at or above `minRole`. */
export function hasRole(role: AdminRole, minRole: AdminRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole]
}

/** True iff `role` is permitted to perform `capability`. */
export function roleHasCapability(role: AdminRole, capability: Capability): boolean {
  return hasRole(role, CAPABILITY_MIN_ROLE[capability])
}

/**
 * Coerce an arbitrary stored value into a valid AdminRole.
 *
 * SAFETY (SEC-M4): an unknown / null / missing value resolves to `admin`, NOT `super_admin`. The
 * row already proves the user is a platform admin, so this never LOCKS OUT an existing admin — they
 * keep the full day-to-day admin surface. But it no longer silently grants the super_admin-ONLY
 * governance/destructive caps (billing.convert, user.delete, admin.manage, knowledge.manage) to a
 * malformed / legacy / partially-migrated row: unknown data must not mean god mode. Valid invites
 * are always written with an explicit role, so this fallback only fires for anomalous rows — and
 * the I/O caller (fetchAdminRow) alerts when a non-null value fails to resolve so the row gets fixed.
 */
export function normalizeRole(value: string | null | undefined): AdminRole {
  return (ADMIN_ROLES as readonly string[]).includes(value ?? "")
    ? (value as AdminRole)
    : "admin"
}

/** True iff `value` is one of the three valid roles (strict — for input validation). */
export function isValidRole(value: string | null | undefined): value is AdminRole {
  return (ADMIN_ROLES as readonly string[]).includes(value ?? "")
}

/** Thrown when an authenticated admin lacks the capability for an action. */
export class CapabilityError extends Error {
  readonly capability: Capability | null
  readonly role: AdminRole | null
  constructor(message: string, capability: Capability | null = null, role: AdminRole | null = null) {
    super(message)
    this.name = "CapabilityError"
    this.capability = capability
    this.role = role
  }
}
