"use server"

// Ad-hoc refresh entry points (Spine rewrite · Phase 7) — the SAME durable queue the
// daily cron and onboarding first-run use. Two scopes:
//   • refreshLocationAction      — "refresh this business" (all data signals)
//   • refreshSocialNetworkAction — "refresh just <network(s)>" (social, platform-filtered)
// Both are auth-guarded (caller must be a member of the location's org) and forced
// (a human asked), so they bypass the billing cadence intentionally.

import { requireUser } from "@/lib/auth/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { enqueueAdhocLocation, enqueueAdhocPlatform } from "@/lib/jobs/queue"

type Authorized = { ok: true; organizationId: string }
type AuthFail = { ok: false; error: string }

async function authorizeLocation(locationId: string): Promise<Authorized | AuthFail> {
  const user = await requireUser()
  const admin = createAdminSupabaseClient()
  const { data: loc } = await admin
    .from("locations")
    .select("organization_id")
    .eq("id", locationId)
    .maybeSingle()
  if (!loc) return { ok: false, error: "Location not found" }
  const { data: member } = await admin
    .from("organization_members")
    .select("id")
    .eq("organization_id", loc.organization_id as string)
    .eq("user_id", user.id)
    .maybeSingle()
  if (!member) return { ok: false, error: "Not authorized for this location" }
  return { ok: true, organizationId: loc.organization_id as string }
}

export async function refreshLocationAction(
  locationId: string
): Promise<{ ok: true; queued: number } | { ok: false; error: string }> {
  const auth = await authorizeLocation(locationId)
  if (!auth.ok) return auth
  const queued = await enqueueAdhocLocation(createAdminSupabaseClient(), {
    organizationId: auth.organizationId,
    locationId,
  })
  return { ok: true, queued }
}

export async function refreshSocialNetworkAction(
  locationId: string,
  platforms: string[]
): Promise<{ ok: true; queued: number } | { ok: false; error: string }> {
  const valid = (platforms ?? []).filter((p) => ["instagram", "facebook", "tiktok"].includes(p))
  if (valid.length === 0) return { ok: false, error: "No valid platforms specified" }
  const auth = await authorizeLocation(locationId)
  if (!auth.ok) return auth
  const queued = await enqueueAdhocPlatform(createAdminSupabaseClient(), {
    organizationId: auth.organizationId,
    locationId,
    platforms: valid,
  })
  return { ok: true, queued }
}
