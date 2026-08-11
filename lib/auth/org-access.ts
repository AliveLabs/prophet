import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Returns all location IDs belonging to an organization.
 * Uses admin client to bypass RLS (intended for cache layers).
 */
export async function getOrgLocationIds(
  organizationId: string
): Promise<string[]> {
  const supabase = createAdminSupabaseClient()
  const { data } = await supabase
    .from("locations")
    .select("id")
    .eq("organization_id", organizationId)

  return (data ?? []).map((l) => l.id)
}

/**
 * Validates that a requested location ID belongs to the org's location set.
 * Returns the ID if valid, or the first org location as fallback, or null.
 */
export function validateLocationForOrg(
  requestedId: string | null | undefined,
  orgLocationIds: string[]
): string | null {
  if (requestedId && orgLocationIds.includes(requestedId)) {
    return requestedId
  }
  return orgLocationIds[0] ?? null
}

/**
 * True when the org row exists and has NOT been soft-deleted.
 *
 * organizations.deleted_at (Phase 6c) is the kill switch for an org: all four cron
 * entrypoints filter `.is("deleted_at", null)`, so a deleted org stops PRODUCING. This is the
 * read side of the same switch, so its members stop CONSUMING.
 *
 * Fails CLOSED: the opposite polarity to `locationStillActive()` in lib/jobs/worker.ts, and
 * deliberately so. There, the question is "should a worker finish a job it already claimed",
 * and a read blip must not drop legitimate work, so it proceeds. Here the question is "may
 * this user reach this org's data", where the costs are asymmetric: denying wrongly costs an
 * error message, granting wrongly serves a tenant that has been switched off. A missing row
 * (hard-deleted org) is inactive for the same reason.
 *
 * Safe with a user-scoped client as well as the admin one: the "org members can read org"
 * RLS policy lets any member SELECT their own org row, so this can't deny a real member
 * for RLS reasons.
 */
export async function isOrgActive(
  supabase: SupabaseClient,
  orgId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("organizations")
    .select("deleted_at")
    .eq("id", orgId)
    .maybeSingle()

  if (error || !data) return false
  return !(data as { deleted_at?: string | null }).deleted_at
}

/**
 * Verifies a user is a member of the given organization AND that the organization is live.
 * Works with any Supabase client (admin or user-scoped).
 * Throws if the user is not a member, or if the org has been soft-deleted.
 *
 * Membership is checked FIRST so a non-member never learns whether the org exists.
 *
 * Both halves are load-bearing. Until 2026-08-10 this checked only for an organization_members
 * row, which left soft-delete NON-authoritative for access: setting deleted_at stopped the crons
 * but members kept full product access. The test-data cleanup that day had to additionally
 * backdate trial_ends_at, set payment_state='canceled' and revoke auth sessions to actually lock
 * C Rolls Sushi's member out. Setting deleted_at is now sufficient on its own; don't re-split it.
 */
export async function requireOrgMembership(
  supabase: SupabaseClient,
  userId: string,
  orgId: string
): Promise<void> {
  const { data } = await supabase
    .from("organization_members")
    .select("id")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .maybeSingle()

  if (!data) {
    throw new Error("You are not a member of this organization.")
  }

  if (!(await isOrgActive(supabase, orgId))) {
    throw new Error("This organization is no longer active.")
  }
}
