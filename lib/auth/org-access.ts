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
 * Verifies a user is a member of the given organization.
 * Works with any Supabase client (admin or user-scoped).
 * Throws an error if the user is not a member.
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
}
