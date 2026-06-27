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

import { getOrgLocationIds, validateLocationForOrg, requireOrgMembership } from "@/lib/auth/org-access"

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

describe("requireOrgMembership", () => {
  // .from().select("id").eq("organization_id").eq("user_id").maybeSingle()
  const client = (row: unknown) =>
    ({
      from: () => ({
        select: () => ({
          eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: row }) }) }),
        }),
      }),
    }) as unknown as SupabaseClient

  it("resolves silently for a real member", async () => {
    await expect(requireOrgMembership(client({ id: "m1" }), "u1", "org1")).resolves.toBeUndefined()
  })
  it("throws for a non-member", async () => {
    await expect(requireOrgMembership(client(null), "u1", "org1")).rejects.toThrow(/not a member/i)
  })
})
