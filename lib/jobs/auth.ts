// ---------------------------------------------------------------------------
// Shared auth helper for job API routes
// ---------------------------------------------------------------------------

import { createServerSupabaseClient } from "@/lib/supabase/server"
import { resolveOrgActorWith, isOrgAdmin } from "@/lib/auth/actor"
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
  // getUser (not requireUser): these are API routes, so a signed-out caller must land on the
  // route's 401 branch, never a redirect.
  if (!user) return null

  // ALT-577: session → org actor via the ONE resolver. Carries the membership check AND the
  // soft-delete gate (route handlers never pass through the (dashboard) layout's deleted_at
  // gate, so this is theirs). Null lands on each route's existing unauthorized branch.
  const actor = await resolveOrgActorWith(supabase, user.id)
  if (!actor || !isOrgAdmin(actor)) return null

  return {
    userId: actor.userId,
    organizationId: actor.organizationId,
    supabase,
  }
}
