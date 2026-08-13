// ALT-591: the non-Stripe lifecycle mirror. Card-less "skip for now" trials
// never produce a Stripe event, so this helper is the only thing that gets
// them into marketing.contacts at status 'trial' for Chris's n8n drip.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: vi.fn() }))
vi.mock("@/lib/marketing/contacts", () => ({
  isMarketingContactsEnabled: vi.fn(),
  getOrganizationBillingEmail: vi.fn(),
  upsertMarketingContact: vi.fn(),
}))

import {
  marketingSourceForIndustry,
  mirrorLifecycleToMarketing,
} from "@/lib/marketing/trial-lifecycle"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import {
  getOrganizationBillingEmail,
  isMarketingContactsEnabled,
  upsertMarketingContact,
} from "@/lib/marketing/contacts"

function armOrg(org: { industry_type?: string | null; org_kind?: string } | null) {
  vi.mocked(createAdminSupabaseClient).mockReturnValue({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: org, error: null }) }),
      }),
    }),
  } as unknown as ReturnType<typeof createAdminSupabaseClient>)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isMarketingContactsEnabled).mockReturnValue(true)
  vi.mocked(getOrganizationBillingEmail).mockResolvedValue("billing@rest.com")
  vi.mocked(upsertMarketingContact).mockResolvedValue({ ok: true })
  armOrg({ industry_type: "restaurant", org_kind: "real" })
})

describe("marketingSourceForIndustry", () => {
  it("maps verticals to the sources Chris's CHECK constraint allows", () => {
    expect(marketingSourceForIndustry("restaurant")).toBe("getticket.ai")
    expect(marketingSourceForIndustry("liquor_store")).toBe("goneat.ai")
    expect(marketingSourceForIndustry(null)).toBe("getticket.ai")
    expect(marketingSourceForIndustry(undefined)).toBe("getticket.ai")
  })
})

describe("mirrorLifecycleToMarketing", () => {
  it("no-ops with ZERO queries when MARKETING_CONTACTS_ENABLED is off", async () => {
    vi.mocked(isMarketingContactsEnabled).mockReturnValue(false)
    await mirrorLifecycleToMarketing({ organizationId: "org_1", status: "trial" })
    expect(createAdminSupabaseClient).not.toHaveBeenCalled()
    expect(getOrganizationBillingEmail).not.toHaveBeenCalled()
    expect(upsertMarketingContact).not.toHaveBeenCalled()
  })

  it("upserts status 'trial' with the billing email and vertical-correct source (card-less trial start)", async () => {
    await mirrorLifecycleToMarketing({
      organizationId: "org_1",
      status: "trial",
      fallbackEmail: "member@rest.com",
    })
    expect(upsertMarketingContact).toHaveBeenCalledExactlyOnceWith({
      email: "billing@rest.com",
      industryType: "restaurant",
      status: "trial",
      source: "getticket.ai",
    })
  })

  it("uses goneat.ai + liquor_store for a Neat org", async () => {
    armOrg({ industry_type: "liquor_store", org_kind: "real" })
    await mirrorLifecycleToMarketing({ organizationId: "org_1", status: "trial" })
    expect(upsertMarketingContact).toHaveBeenCalledWith(
      expect.objectContaining({ industryType: "liquor_store", source: "goneat.ai" })
    )
  })

  it("falls back to the caller-supplied email when billing_email is empty", async () => {
    vi.mocked(getOrganizationBillingEmail).mockResolvedValue(null)
    await mirrorLifecycleToMarketing({
      organizationId: "org_1",
      status: "trial",
      fallbackEmail: " Owner@Rest.com ",
    })
    expect(upsertMarketingContact).toHaveBeenCalledWith(
      expect.objectContaining({ email: "owner@rest.com" })
    )
  })

  it("skips when no email can be resolved at all", async () => {
    vi.mocked(getOrganizationBillingEmail).mockResolvedValue(null)
    await mirrorLifecycleToMarketing({ organizationId: "org_1", status: "trial" })
    expect(upsertMarketingContact).not.toHaveBeenCalled()
  })

  it("never mirrors demo/test showcase orgs into Chris's list", async () => {
    for (const orgKind of ["demo", "test"]) {
      armOrg({ industry_type: "restaurant", org_kind: orgKind })
      await mirrorLifecycleToMarketing({ organizationId: "org_1", status: "trial" })
    }
    expect(upsertMarketingContact).not.toHaveBeenCalled()
  })

  it("passes name fields through for the access_granted mirror", async () => {
    await mirrorLifecycleToMarketing({
      organizationId: "org_1",
      status: "access_granted",
      firstName: "Sam",
      lastName: "Jones",
    })
    expect(upsertMarketingContact).toHaveBeenCalledWith(
      expect.objectContaining({ status: "access_granted", firstName: "Sam", lastName: "Jones" })
    )
  })

  it("never throws — an upsert rejection is swallowed and logged", async () => {
    vi.mocked(upsertMarketingContact).mockRejectedValue(new Error("db down"))
    await expect(
      mirrorLifecycleToMarketing({ organizationId: "org_1", status: "trial" })
    ).resolves.toBeUndefined()
  })

  it("never throws — an org-lookup miss is swallowed and logged", async () => {
    armOrg(null)
    await expect(
      mirrorLifecycleToMarketing({ organizationId: "org_1", status: "trial" })
    ).resolves.toBeUndefined()
    expect(upsertMarketingContact).not.toHaveBeenCalled()
  })
})
