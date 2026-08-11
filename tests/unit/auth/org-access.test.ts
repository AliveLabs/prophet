// TEST-2 (code-health audit): lib/auth/org-access is the code that resolves a request to an org's
// location set — the actual gate between tenants for the service-role job/ambient builders (RLS is
// bypassed there, so these checks ARE the isolation). The capability matrix is well-tested; this
// resolution code was not. validateLocationForOrg's fallback is the SEC-M1 safety property: an
// out-of-org locationId can never resolve to a foreign location.

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

const eqFinal = vi.fn()
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({
    from: () => ({ select: () => ({ eq: (...a: unknown[]) => eqFinal(...a) }) }),
  }),
}))

import { getOrgLocationIds, validateLocationForOrg, requireOrgMembership, isOrgActive } from "@/lib/auth/org-access"

/** Client stub covering BOTH reads requireOrgMembership now makes on the same client. The two
 *  chains differ only in .eq() depth, so one node serving both terminals disambiguates them:
 *    organizations        → .select("deleted_at").eq("id").maybeSingle()
 *    organization_members → .select("id").eq("organization_id").eq("user_id").maybeSingle()
 *  `member: null` ⇒ non-member; `org: null` ⇒ no org row; `orgError` ⇒ failed org read. */
function client(opts: { member?: unknown; org?: unknown; orgError?: unknown }): SupabaseClient {
  const { member = { id: "m1" }, org = { deleted_at: null }, orgError = null } = opts
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: org, error: orgError }),
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: member, error: null }) }),
        }),
      }),
    }),
  } as unknown as SupabaseClient
}

beforeEach(() => eqFinal.mockReset())

describe("getOrgLocationIds", () => {
  it("maps location rows to a flat id array", async () => {
    eqFinal.mockResolvedValue({ data: [{ id: "l1" }, { id: "l2" }] })
    expect(await getOrgLocationIds("org_1")).toEqual(["l1", "l2"])
  })
  it("returns [] when the org has no locations (null data)", async () => {
    eqFinal.mockResolvedValue({ data: null })
    expect(await getOrgLocationIds("org_empty")).toEqual([])
  })
})

describe("validateLocationForOrg — SEC-M1 cross-tenant safety", () => {
  const orgLocs = ["l1", "l2", "l3"]
  it("returns the requested id when it belongs to the org", () => {
    expect(validateLocationForOrg("l2", orgLocs)).toBe("l2")
  })
  it("falls back to the org's FIRST location for a foreign/unknown id — never the foreign id", () => {
    expect(validateLocationForOrg("l_other_org", orgLocs)).toBe("l1")
    expect(validateLocationForOrg(null, orgLocs)).toBe("l1")
    expect(validateLocationForOrg(undefined, orgLocs)).toBe("l1")
  })
  it("returns null when the org has no locations at all", () => {
    expect(validateLocationForOrg("l_anything", [])).toBeNull()
  })
})

describe("isOrgActive: soft-delete is the read-side kill switch", () => {
  it("true for a live org", async () => {
    expect(await isOrgActive(client({ org: { deleted_at: null } }), "org1")).toBe(true)
  })
  it("false when deleted_at is set", async () => {
    expect(await isOrgActive(client({ org: { deleted_at: "2026-08-10T00:00:00Z" } }), "org1")).toBe(false)
  })
  // Fails CLOSED: opposite polarity to locationStillActive() in lib/jobs/worker.ts, which fails
  // open so a read blip can't drop an already-claimed job. This one answers "may this user reach
  // this org", where granting on an unproven answer is the worse outcome.
  it("false when the org row is missing (hard-deleted)", async () => {
    expect(await isOrgActive(client({ org: null }), "org1")).toBe(false)
  })
  it("false on a query error, rather than assuming active", async () => {
    expect(await isOrgActive(client({ org: null, orgError: { message: "boom" } }), "org1")).toBe(false)
  })
})

describe("requireOrgMembership", () => {
  it("resolves silently for a member of a live org", async () => {
    await expect(requireOrgMembership(client({}), "u1", "org1")).resolves.toBeUndefined()
  })

  it("throws for a non-member", async () => {
    await expect(requireOrgMembership(client({ member: null }), "u1", "org1")).rejects.toThrow(/not a member/i)
  })

  // THE REGRESSION THIS GUARDS (2026-08-10): membership alone used to be the whole check, so
  // soft-deleting an org stopped all four crons (they filter deleted_at) but left its members with
  // full product access. C Rolls Sushi was deleted_at with payment_state still 'active' and its
  // member kept the app; the cleanup had to also backdate trial_ends_at, set payment_state
  // 'canceled' and revoke auth sessions. Setting deleted_at must be sufficient on its own.
  it("DENIES a real member of a soft-deleted org", async () => {
    await expect(
      requireOrgMembership(
        client({ member: { id: "m1" }, org: { deleted_at: "2026-08-10T00:00:00Z" } }),
        "u1",
        "org1",
      ),
    ).rejects.toThrow(/no longer active/i)
  })

  it("denies a member when the org row is gone entirely", async () => {
    await expect(requireOrgMembership(client({ org: null }), "u1", "org1")).rejects.toThrow(/no longer active/i)
  })

  // Membership is checked FIRST so a non-member can't distinguish "org deleted" from
  // "org never existed"; the error must not become an org-existence oracle.
  it("reports non-membership (not deletion) when both are true", async () => {
    await expect(
      requireOrgMembership(client({ member: null, org: { deleted_at: "2026-08-10T00:00:00Z" } }), "u1", "org1"),
    ).rejects.toThrow(/not a member/i)
  })
})
