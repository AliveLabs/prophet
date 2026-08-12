// Pure merge-orchestration logic for admin org-merge (beta rescue 1.2, pairs with ALT-576).
//
// The concrete problem: one real restaurant (Fog Harbor Fish House) was independently
// onboarded 3 times by 3 coworkers. Any of them might be the one who actually evaluates the
// product, so the merge must move every member into the canonical org WITHOUT pausing or
// deleting anything until they're safely relocated.
//
// This module is the pure core — role math + step ordering — kept free of Supabase so it's
// testable without a DB, the same reason lib/ai/provider.ts injects a Transport instead of
// calling fetch() directly. app/actions/org-management.ts#mergeOrganizations supplies the
// real Supabase-backed MergeSourcePorts; tests supply fakes.

/** Membership role rank — higher wins when the same user is a member on both sides. */
const MEMBER_ROLE_RANK: Record<string, number> = {
  member: 0,
  admin: 1,
  owner: 2,
}

function rankOf(role: string): number {
  return MEMBER_ROLE_RANK[role] ?? MEMBER_ROLE_RANK.member
}

/**
 * An incoming member's role as it should be WRITTEN to the target org. A source owner is
 * demoted to admin on arrival — the target's own owner (whoever it already is) must stay the
 * only owner. Every other role passes through unchanged.
 */
export function demoteIncomingOwner(sourceRole: string): string {
  return sourceRole === "owner" ? "admin" : sourceRole
}

/**
 * Resolve the role a user should hold in the target org once a source membership is folded
 * in. `existingTargetRole` is null when the user isn't yet a target member (a plain insert).
 * Higher role wins on either side:
 *   - the target's real owner is never displaced by a demoted incoming owner (owner > admin)
 *   - a user who already holds a stronger role in the target (e.g. admin) keeps it even if
 *     their source role was merely member
 *   - a demoted incoming owner still outranks a source-side member/target member, so they
 *     land as admin, not member
 */
export function resolveMergedRole(
  existingTargetRole: string | null,
  incomingSourceRole: string
): string {
  const incoming = demoteIncomingOwner(incomingSourceRole)
  if (existingTargetRole == null) return incoming
  return rankOf(existingTargetRole) >= rankOf(incoming) ? existingTargetRole : incoming
}

export interface MergeSourceSnapshot {
  id: string
  name: string
  orgKind: string
  deletedAt: string | null
}

/**
 * The I/O a single source org's merge needs, injected so the ordering logic below is
 * testable with fakes. Each method is scoped to one source org (the target is fixed for
 * the whole run, so implementations close over it).
 */
export interface MergeSourcePorts {
  /** null = source not found (already merged/purged — treat as a no-op, not an error). */
  loadSource(sourceOrgId: string): Promise<MergeSourceSnapshot | null>
  moveMembers(sourceOrgId: string): Promise<{ membersMoved: number }>
  repointProfiles(sourceOrgId: string): Promise<{ profilesRepointed: number }>
  /** true iff no profile row still points current_organization_id at sourceOrgId. */
  verifyNoDanglingProfiles(sourceOrgId: string): Promise<boolean>
  /** Full cascade delete of the source org. Only ever called after verify* passes. */
  deleteSource(sourceOrgId: string): Promise<void>
}

export type MergeSourceStatus =
  | "merged"
  | "skipped_missing"
  | "skipped_already_deleted"
  | "failed"

export interface MergeSourceOutcome {
  sourceOrgId: string
  sourceName: string | null
  sourceKind: string | null
  status: MergeSourceStatus
  membersMoved: number
  profilesRepointed: number
  error?: string
}

/**
 * Fold every source org into the target, ONE SOURCE AT A TIME, in the only order that keeps
 * every user pointing at a live org if this dies partway through:
 *
 *   1. move memberships   2. repoint profiles   3. verify no dangling pointer   4. delete
 *
 * Step 4 never runs unless step 3 confirms zero profiles still point at the source, so a
 * crash after step 1, 2, or 3 leaves that source org still EXISTING (its members/pointers
 * may already be duplicated into the target, which is harmless) — never a deleted org with a
 * live pointer at it. That also makes this safe to re-run with the same sourceOrgIds after a
 * partial failure: a source that's missing or already soft/hard-deleted is treated as already
 * merged (skipped, not an error), and re-moving an already-moved membership is a no-op via
 * resolveMergedRole's higher-role-wins dedupe.
 *
 * One source's failure does not abort the others — they're independent duplicates of the
 * same restaurant, and a caller (mergeOrganizations) surfaces which ones failed so the admin
 * can retry just those.
 */
export async function mergeSourcesIntoTarget(
  sourceOrgIds: string[],
  ports: MergeSourcePorts
): Promise<MergeSourceOutcome[]> {
  const outcomes: MergeSourceOutcome[] = []

  for (const sourceOrgId of sourceOrgIds) {
    const source = await ports.loadSource(sourceOrgId)
    if (!source) {
      outcomes.push({
        sourceOrgId,
        sourceName: null,
        sourceKind: null,
        status: "skipped_missing",
        membersMoved: 0,
        profilesRepointed: 0,
      })
      continue
    }
    if (source.deletedAt) {
      outcomes.push({
        sourceOrgId,
        sourceName: source.name,
        sourceKind: source.orgKind,
        status: "skipped_already_deleted",
        membersMoved: 0,
        profilesRepointed: 0,
      })
      continue
    }

    let membersMoved = 0
    let profilesRepointed = 0
    try {
      ;({ membersMoved } = await ports.moveMembers(sourceOrgId))
      ;({ profilesRepointed } = await ports.repointProfiles(sourceOrgId))

      const clean = await ports.verifyNoDanglingProfiles(sourceOrgId)
      if (!clean) {
        outcomes.push({
          sourceOrgId,
          sourceName: source.name,
          sourceKind: source.orgKind,
          status: "failed",
          membersMoved,
          profilesRepointed,
          error: "A profile still points at this source after repointing; refusing to delete it.",
        })
        continue
      }

      await ports.deleteSource(sourceOrgId)
      outcomes.push({
        sourceOrgId,
        sourceName: source.name,
        sourceKind: source.orgKind,
        status: "merged",
        membersMoved,
        profilesRepointed,
      })
    } catch (e) {
      outcomes.push({
        sourceOrgId,
        sourceName: source.name,
        sourceKind: source.orgKind,
        status: "failed",
        membersMoved,
        profilesRepointed,
        error: e instanceof Error ? e.message : "Unknown error while merging this source.",
      })
    }
  }

  return outcomes
}
