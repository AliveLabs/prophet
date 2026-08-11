// ---------------------------------------------------------------------------
// Shared auth helper for job API routes
// ---------------------------------------------------------------------------

import { createServerSupabaseClient } from "@/lib/supabase/server"
import { isOrgActive } from "@/lib/auth/org-access"
import type { SupabaseClient } from "@supabase/supabase-js"

export type JobAuthContext = {
  userId: string
  organizationId: string
  supabase: SupabaseClient
}

export async function getJobAuthContext(): Promise<JobAuthContext | null> {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  if (!profile?.current_organization_id) return null

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", profile.current_organization_id)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!membership || !["owner", "admin"].includes(membership.role)) return null

  // Soft-deleted org ⇒ no job context. The (dashboard) layout's deleted_at gate covers PAGE
  // renders only; route handlers never pass through a layout, so without this an owner of a
  // deleted org could still enqueue refresh jobs and stream their results. Returning null lands
  // on each route's existing unauthorized branch, so no new failure shape for callers to handle.
  if (!(await isOrgActive(supabase, profile.current_organization_id))) return null

  return {
    userId: user.id,
    organizationId: profile.current_organization_id,
    supabase,
  }
}
