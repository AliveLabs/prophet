// ALT-577: resolveOrgActorWith is the ONE session→org-actor resolution used by server actions
// (via resolveOrgActor) and the job API routes (getJobAuthContext). Before it existed, ~6
// actions each hand-rolled the same reads and none checked organizations.deleted_at, so a
// soft-deleted org's members kept invoking them. These tests pin the full denial matrix so
// the resolver can never quietly lose one of its three gates.

import { describe, it, expect } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { resolveOrgActorWith, isOrgAdmin } from "@/lib/auth/actor"

/** Client stub serving the resolver's three reads, disambiguated by table name:
 *    profiles             → .select().eq("id").maybeSingle()
 *    organization_members → .select().eq("organization_id").eq("user_id").maybeSingle()
 *    organizations        → .select("deleted_at").eq("id").maybeSingle()   (via isOrgActive)
 */
function client(opts: {
  profile?: unknown
  member?: unknown
  org?: unknown
  orgError?: unknown
}): SupabaseClient {
  const {
    profile = { current_organization_id: "org1" },
    member = { role: "owner" },
    org = { deleted_at: null },
    orgError = null,
  } = opts
  const single = (table: string) =>
    Promise.resolve(
      table === "profiles"
        ? { data: profile, error: null }
        : table === "organizations"
          ? { data: org, error: orgError }
          : { data: member, error: null },
    )
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => single(table),
          eq: () => ({ maybeSingle: () => single(table) }),
        }),
      }),
    }),
  } as unknown as SupabaseClient
}

describe("resolveOrgActorWith", () => {
  it("resolves a member of a live org to an actor with their role", async () => {
    const actor = await resolveOrgActorWith(client({ member: { role: "member" } }), "u1")
    expect(actor).toEqual({ userId: "u1", organizationId: "org1", role: "member" })
  })

  it("null when the user has no profile / no current org", async () => {
    expect(await resolveOrgActorWith(client({ profile: null }), "u1")).toBeNull()
    expect(
      await resolveOrgActorWith(client({ profile: { current_organization_id: null } }), "u1"),
    ).toBeNull()
  })

  it("null for a non-member of their pointed-at org", async () => {
    expect(await resolveOrgActorWith(client({ member: null }), "u1")).toBeNull()
  })

  // The reason this resolver exists: membership alone used to be the whole check, and a
  // soft-deleted org's members kept full access to every action that resolved inline.
  it("null for a REAL member of a soft-deleted org", async () => {
    expect(
      await resolveOrgActorWith(client({ org: { deleted_at: "2026-08-10T00:00:00Z" } }), "u1"),
    ).toBeNull()
  })

  it("null when the org row is gone, or the org read errors (fails closed)", async () => {
    expect(await resolveOrgActorWith(client({ org: null }), "u1")).toBeNull()
    expect(
      await resolveOrgActorWith(client({ org: null, orgError: { message: "boom" } }), "u1"),
    ).toBeNull()
  })
})

describe("isOrgAdmin", () => {
  it("owner and admin qualify; member and unknown roles do not", () => {
    expect(isOrgAdmin({ role: "owner" })).toBe(true)
    expect(isOrgAdmin({ role: "admin" })).toBe(true)
    expect(isOrgAdmin({ role: "member" })).toBe(false)
    expect(isOrgAdmin({ role: "viewer" })).toBe(false)
  })
})
