import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database.types"

type AdminClient = SupabaseClient<Database>

export interface CascadeDeleteResult {
  orgId: string
  orgName: string | null
  /** true = data wiped but the org row + members + billing identity were kept (Clear all data). */
  keptShell: boolean
  locationsDeleted: number
  competitorsDeleted: number
  /** Polymorphic social_profiles removed explicitly (DB cascade does NOT reach them). */
  socialProfilesDeleted: number
  profilePointersNulled: number
}

/**
 * Run a delete/update and THROW on error. Destructive cleanup must never silently
 * under-delete — a swallowed error here re-orphans the polymorphic social rows (the
 * 2026-06-22 incident) or leaves a "cleared" org full of stale data. Every mutation
 * in this module is checked; callers wrap these in try/catch to surface ok:false.
 */
async function checked(
  label: string,
  query: PromiseLike<{ error: { message: string } | null; count?: number | null }>
): Promise<number> {
  const { error, count } = await query
  if (error) throw new Error(`cascade-cleanup: ${label} failed: ${error.message}`)
  return count ?? 0
}

/**
 * Resolve the org's locations + their competitors — the ids that key the polymorphic
 * social rows. NOTE: these selects are unpaginated; correctness of the social cleanup
 * depends on per-org location/competitor counts staying well under PostgREST's
 * default max-rows (~1000). They are tier-capped far below that (maxLocations/
 * maxCompetitors in lib/insights/dossier/types.ts), so this is safe; if tier caps
 * ever grow toward 1000, paginate here.
 */
async function resolveScope(
  admin: AdminClient,
  orgId: string
): Promise<{ locationIds: string[]; competitorIds: string[] }> {
  const { data: locations } = await admin
    .from("locations")
    .select("id")
    .eq("organization_id", orgId)
  const locationIds = (locations ?? []).map((l) => l.id)

  let competitorIds: string[] = []
  if (locationIds.length > 0) {
    const { data: competitors } = await admin
      .from("competitors")
      .select("id")
      .in("location_id", locationIds)
    competitorIds = (competitors ?? []).map((c) => c.id)
  }
  return { locationIds, competitorIds }
}

/**
 * Delete the POLYMORPHIC social rows for a set of locations/competitors. These are
 * keyed by (entity_type, entity_id) with NO FK to organizations, so DB cascade never
 * reaches them — this is the exact gap that orphaned 58 social_profiles + 334
 * social_snapshots on 2026-06-22. social_snapshots cascade via their FK to
 * social_profiles. Throws on error so a partial failure aborts BEFORE the parent
 * locations/competitors are dropped (which would make the orphans unrecoverable).
 */
async function deletePolymorphicSocial(
  admin: AdminClient,
  locationIds: string[],
  competitorIds: string[]
): Promise<number> {
  let deleted = 0
  if (locationIds.length > 0) {
    deleted += await checked(
      "social_profiles(location)",
      admin
        .from("social_profiles")
        .delete({ count: "exact" })
        .eq("entity_type", "location")
        .in("entity_id", locationIds)
    )
  }
  if (competitorIds.length > 0) {
    deleted += await checked(
      "social_profiles(competitor)",
      admin
        .from("social_profiles")
        .delete({ count: "exact" })
        .eq("entity_type", "competitor")
        .in("entity_id", competitorIds)
    )
  }
  return deleted
}

/**
 * Canonical org teardown — the single source of truth for deleting (or clearing) an
 * organization and everything under it. deleteOrg, clearOrgData, deleteUser's
 * sole-owner cascade, and the clear-test tooling all route through here.
 *
 * `keepShell: false` (default) — FULL DELETE:
 *   1. resolve locations + competitors, 2. delete polymorphic social_profiles
 *   (snapshots cascade), 3. null profiles.current_organization_id (RESTRICT FK),
 *   4. DELETE the organizations row → cascades the whole subtree.
 *
 * `keepShell: true` — CLEAR ALL DATA (keep the org row + members + billing identity):
 *   delete the locations (DB-cascades the location subtree) + the direct-org tables
 *   that don't hang off a location; leave members, billing, org_kind, the org row,
 *   and current_organization_id untouched.
 *
 * Every mutation is error-checked and throws on failure; the caller converts that to
 * an ok:false ActionResult. (Atomicity across statements is a P1 SECURITY DEFINER fn;
 * until then re-running is safe — each step is keyed by id and idempotent.)
 */
export async function cascadeDeleteOrganization(
  admin: AdminClient,
  orgId: string,
  opts: { keepShell?: boolean } = {}
): Promise<CascadeDeleteResult> {
  const { keepShell = false } = opts

  // Phase 6e: the whole teardown runs ATOMICALLY in one transaction via the SECURITY DEFINER
  // cascade_delete_organization() fn (migration 20260623030000). Same behavior as the prior
  // inline sequence (explicit polymorphic-social cleanup + DB FK cascades), but all-or-nothing
  // — a mid-sequence failure can no longer half-delete. The fn isn't in the generated types, so
  // the rpc call goes through an untyped client (same pattern as ask_history/play_actions below).
  const untyped = admin as unknown as SupabaseClient
  const { data, error } = await untyped.rpc("cascade_delete_organization", {
    p_org_id: orgId,
    p_keep_shell: keepShell,
  })
  if (error) {
    throw new Error(`cascade-cleanup: atomic delete failed: ${error.message}`)
  }

  const r = (data ?? {}) as Record<string, unknown>
  return {
    orgId,
    orgName: (r.orgName as string | null) ?? null,
    keptShell: keepShell,
    locationsDeleted: Number(r.locationsDeleted ?? 0),
    competitorsDeleted: Number(r.competitorsDeleted ?? 0),
    socialProfilesDeleted: Number(r.socialProfilesDeleted ?? 0),
    profilePointersNulled: Number(r.profilePointersNulled ?? 0),
  }
}

export interface RefreshDataResult {
  orgId: string
  locationsKept: number
  competitorsKept: number
  socialProfilesDeleted: number
}

/**
 * Refresh data — wipe only the DERIVED intelligence while keeping locations,
 * competitors, members, billing, and the org row. Keeps insight_preferences (learned
 * weights). Every delete is error-checked and throws on failure.
 */
export async function refreshOrgData(
  admin: AdminClient,
  orgId: string
): Promise<RefreshDataResult> {
  const { locationIds, competitorIds } = await resolveScope(admin, orgId)

  if (competitorIds.length > 0) {
    await checked("snapshots", admin.from("snapshots").delete().in("competitor_id", competitorIds))
    await checked("competitor_photos", admin.from("competitor_photos").delete().in("competitor_id", competitorIds))
    await checked("busy_times", admin.from("busy_times").delete().in("competitor_id", competitorIds))
  }

  const socialProfilesDeleted = await deletePolymorphicSocial(admin, locationIds, competitorIds)

  if (locationIds.length > 0) {
    await checked("location_snapshots", admin.from("location_snapshots").delete().in("location_id", locationIds))
    await checked("location_weather", admin.from("location_weather").delete().in("location_id", locationIds))
    await checked("event_matches", admin.from("event_matches").delete().in("location_id", locationIds))
    await checked("insights", admin.from("insights").delete().in("location_id", locationIds))
    await checked("tracked_keywords", admin.from("tracked_keywords").delete().in("location_id", locationIds))
    await checked("daily_briefs", admin.from("daily_briefs").delete().in("location_id", locationIds))
    await checked("brief_feedback", admin.from("brief_feedback").delete().in("location_id", locationIds))
    // ask_history + play_actions are real tables not yet in the generated types;
    // query them via an untyped client, exactly as lib/ask/history.ts and
    // lib/insights/momentum.ts do.
    const untyped = admin as unknown as SupabaseClient
    await checked("ask_history", untyped.from("ask_history").delete().in("location_id", locationIds))
    await checked("play_actions", untyped.from("play_actions").delete().in("location_id", locationIds))
    await checked("pipeline_runs", admin.from("pipeline_runs").delete().in("location_id", locationIds))
  }

  await checked("signal_jobs", admin.from("signal_jobs").delete().eq("organization_id", orgId))
  await checked("refresh_jobs", admin.from("refresh_jobs").delete().eq("organization_id", orgId))
  await checked("job_runs", admin.from("job_runs").delete().eq("organization_id", orgId))

  return {
    orgId,
    locationsKept: locationIds.length,
    competitorsKept: competitorIds.length,
    socialProfilesDeleted,
  }
}

/**
 * Split a user's org memberships into orgs where deleting the user would strand the
 * org with NO owner (soleOwner — must transfer or explicitly cascade) vs orgs that
 * survive a plain membership detach (multiMember).
 *
 * Keys on OWNERSHIP, not raw membership count: an org is "soleOwner" iff the user is
 * an owner AND no other member holds role='owner'. (An earlier version counted total
 * members, which let a single-owner-plus-members org be silently detached into an
 * ownerless state — the bug the review caught.)
 */
export async function findSoleOwnerOrgIds(
  admin: AdminClient,
  userId: string
): Promise<{ soleOwner: string[]; multiMember: string[] }> {
  const { data: memberships } = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", userId)

  const soleOwner: string[] = []
  const multiMember: string[] = []
  for (const m of memberships ?? []) {
    if (m.role !== "owner") {
      multiMember.push(m.organization_id)
      continue
    }
    const { count: otherOwners } = await admin
      .from("organization_members")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", m.organization_id)
      .eq("role", "owner")
      .neq("user_id", userId)
    if ((otherOwners ?? 0) === 0) soleOwner.push(m.organization_id)
    else multiMember.push(m.organization_id)
  }
  return { soleOwner, multiMember }
}
