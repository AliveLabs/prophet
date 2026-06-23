import { redirect } from "next/navigation"
import { getUser, requireUser } from "./server"
import { getImpersonation } from "./impersonation"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import type { User } from "@supabase/supabase-js"
import {
  type AdminRole,
  type Capability,
  CapabilityError,
  normalizeRole,
  roleHasCapability,
} from "./capabilities"

export interface AdminActionContext {
  user: User
  role: AdminRole
  /** auth user id — convenience alias for user.id (audit logging). */
  adminId: string
  /** auth email or "" — convenience alias for user.email (audit logging). */
  adminEmail: string
}

// Look up the platform-admin row for a user id, including role. GRACEFUL about the `role`
// column not existing yet (pre-migration): selects "*" (never names a possibly-absent
// column) and normalizes, so a missing/unknown role resolves to super_admin — the role read
// can never lock out an existing admin. See normalizeRole.
async function fetchAdminRow(userId: string): Promise<{ role: AdminRole } | null> {
  const admin = createAdminSupabaseClient()
  const { data } = await admin
    .from("platform_admins")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle()
  if (!data) return null
  return { role: normalizeRole((data as { role?: string | null }).role) }
}

/**
 * Current request's admin context (user + role), or null if not signed in / not an admin.
 * Non-redirecting — callers decide how to handle a miss (actions throw, pages redirect).
 */
export async function getAdminContext(): Promise<AdminActionContext | null> {
  // An active impersonation session is NEVER an admin context — even if the impersonated user
  // happens to be an admin, the session must not exercise admin capabilities (Phase 6d).
  if (await getImpersonation()) return null
  const user = await getUser()
  if (!user) return null
  const row = await fetchAdminRow(user.id)
  if (!row) return null
  return { user, role: row.role, adminId: user.id, adminEmail: user.email ?? "" }
}

/**
 * Page-level gate. Redirects to /login if not signed in, /home if signed in but not an
 * admin. Returns the auth user (back-compat for callers that only need .id / .email).
 */
export async function requirePlatformAdmin(): Promise<User> {
  return (await requirePlatformAdminContext()).user
}

/** Page-level gate that also returns the role (for role-aware UI such as the layout badge). */
export async function requirePlatformAdminContext(): Promise<AdminActionContext> {
  const user = await requireUser() // redirect -> /login if not signed in
  const row = await fetchAdminRow(user.id)
  if (!row) redirect("/home") // signed in but not a platform admin
  return { user, role: row.role, adminId: user.id, adminEmail: user.email ?? "" }
}

/**
 * Capability gate for server actions / API routes. Returns the admin context, or throws
 * CapabilityError if the caller is not an admin or their role lacks the capability. Throws
 * (rather than redirects) so callers/wrappers can surface a clean failure. Fails CLOSED.
 */
export async function requireCapability(capability: Capability): Promise<AdminActionContext> {
  const ctx = await getAdminContext()
  if (!ctx) {
    throw new CapabilityError(
      "You must be a platform admin to perform this action.",
      capability,
      null
    )
  }
  if (!roleHasCapability(ctx.role, capability)) {
    throw new CapabilityError(
      `Your role (${ctx.role}) is not permitted to perform this action.`,
      capability,
      ctx.role
    )
  }
  return ctx
}

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const admin = createAdminSupabaseClient()
  const { data } = await admin
    .from("platform_admins")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle()

  return !!data
}
