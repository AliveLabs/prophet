// ---------------------------------------------------------------------------
// The ONE resolver from "a signed-in session" to "an org actor" (ALT-577).
//
// Before this existed, ~6 server actions each hand-rolled the same three reads
// (profiles.current_organization_id → organization_members role → org), and none
// of them checked organizations.deleted_at — so soft-deleting an org stopped the
// crons and the page shell but left every action invokable by its members. The
// (dashboard) layout's deleted_at gate covers PAGE renders only; server actions
// and route handlers never pass through a layout, so this resolver is their gate.
//
// Add new authed actions on top of THIS, not on a fresh inline resolution:
// the 2026-08-10 gap existed in six places at once precisely because the
// resolution was duplicated six times.
// ---------------------------------------------------------------------------

import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { isOrgActive } from "@/lib/auth/org-access"
import type { SupabaseClient } from "@supabase/supabase-js"

export type OrgActor = {
  userId: string
  organizationId: string
  /** Membership role in the current org: "owner" | "admin" | "member" (open set in the DB). */
  role: string
}

/** True for the roles allowed to trigger refreshes, invites, and other org-level mutations. */
export function isOrgAdmin(actor: Pick<OrgActor, "role">): boolean {
  return actor.role === "owner" || actor.role === "admin"
}

/**
 * Core resolution, client + userId injected so unit tests need no next/headers.
 * Returns null when the user has no current org, is not a member of it, or the
 * org is soft-deleted / gone (isOrgActive fails CLOSED; see lib/auth/org-access.ts).
 */
export async function resolveOrgActorWith(
  supabase: SupabaseClient,
  userId: string
): Promise<OrgActor | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", userId)
    .maybeSingle()
  const organizationId = profile?.current_organization_id as string | undefined
  if (!organizationId) return null

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle()
  if (!membership) return null

  if (!(await isOrgActive(supabase, organizationId))) return null

  return { userId, organizationId, role: membership.role as string }
}

/**
 * Server-action entry point: session user → org actor, or null.
 * requireUser() redirects a signed-out caller to /login, so a null here always
 * means "signed in but no live org access" — callers map it to their own
 * error/redirect shape.
 */
export async function resolveOrgActor(): Promise<OrgActor | null> {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()
  return resolveOrgActorWith(supabase, user.id)
}
