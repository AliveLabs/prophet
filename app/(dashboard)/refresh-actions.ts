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

// Full "refresh all data" is expensive (re-pools every signal + rebuilds insights),
// so it's rate-limited to once per 12h PER LOCATION. The cooldown is derived from the
// last full-refresh job's timestamp — no new column. A full refresh enqueues the
// `content` pipeline with cursor.mode='adhoc'; a single-network refresh only enqueues
// `social`, so filtering on pipeline='content' isolates full refreshes cleanly.
// Targeted reruns (one network, social-after-adding-a-channel) are NOT gated.
const FULL_REFRESH_COOLDOWN_MS = 12 * 60 * 60 * 1000

export type FullRefreshStatus = {
  /** false while the 12h window since the last full refresh is still open. */
  canRun: boolean
  /** ISO timestamp the button becomes available again (null = available now). */
  availableAt: string | null
}

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

/** When did this location last run a FULL adhoc refresh? Reads the newest `content`
 *  signal_jobs row (only the full-location refresh enqueues `content`) — `created_at`
 *  is the event stamp. Returns null when there's no prior full refresh on record. */
async function lastFullRefreshAt(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  locationId: string
): Promise<Date | null> {
  const { data } = await admin
    .from("signal_jobs")
    .select("created_at, cursor")
    .eq("location_id", locationId)
    .eq("pipeline", "content")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data?.created_at) return null
  const scope = (data.cursor as { mode?: string } | null) ?? null
  if (scope?.mode !== "adhoc") return null
  return new Date(data.created_at)
}

/** Read-only cooldown probe for the UI — lets the page render the button disabled with
 *  an "available again at …" hint without attempting the action. */
export async function getFullRefreshStatus(
  locationId: string
): Promise<FullRefreshStatus> {
  const auth = await authorizeLocation(locationId)
  if (!auth.ok) return { canRun: false, availableAt: null }
  const last = await lastFullRefreshAt(createAdminSupabaseClient(), locationId)
  if (!last) return { canRun: true, availableAt: null }
  const readyAt = last.getTime() + FULL_REFRESH_COOLDOWN_MS
  if (readyAt <= Date.now()) return { canRun: true, availableAt: null }
  return { canRun: false, availableAt: new Date(readyAt).toISOString() }
}

export async function refreshLocationAction(
  locationId: string
): Promise<{ ok: true; queued: number } | { ok: false; error: string; availableAt?: string }> {
  const auth = await authorizeLocation(locationId)
  if (!auth.ok) return auth
  const admin = createAdminSupabaseClient()

  // Server-side cooldown guard — the source of truth, so it can't be bypassed by
  // calling the action directly while the button is disabled client-side.
  const last = await lastFullRefreshAt(admin, locationId)
  if (last) {
    const readyAt = last.getTime() + FULL_REFRESH_COOLDOWN_MS
    if (readyAt > Date.now()) {
      return {
        ok: false,
        error: "A full refresh already ran in the last 12 hours. We'll have this ready again soon.",
        availableAt: new Date(readyAt).toISOString(),
      }
    }
  }

  const queued = await enqueueAdhocLocation(admin, {
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
