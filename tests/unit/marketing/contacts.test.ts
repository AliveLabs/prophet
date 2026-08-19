// ALT-591: upsertMarketingContact contract — flag gating, the read-then-write
// policy, and the trigger-safety two-step (Chris's trg_contacts_log_status_change
// is BEFORE UPDATE OF status, so a row INSERTed directly at 'trial' would never
// get trial_start_date stamped or its lifecycle event logged).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: vi.fn() }))

import { upsertMarketingContact } from "@/lib/marketing/contacts"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

type Existing = { id: string; status?: string | null } | null

function makeMarketingClient(opts: {
  existing?: Existing
  readError?: unknown
  insertError?: unknown
  updateError?: unknown
}) {
  const inserts: Record<string, unknown>[] = []
  const updates: Array<{ values: Record<string, unknown>; col: string; val: string }> = []
  const client = {
    schema: (name: string) => {
      expect(name).toBe("marketing")
      return {
        from: (table: string) => {
          expect(table).toBe("contacts")
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: opts.existing ?? null,
                  error: opts.readError ?? null,
                }),
              }),
            }),
            insert: async (values: Record<string, unknown>) => {
              inserts.push(values)
              return { error: opts.insertError ?? null }
            },
            update: (values: Record<string, unknown>) => ({
              eq: async (col: string, val: string) => {
                updates.push({ values, col, val })
                return { error: opts.updateError ?? null }
              },
            }),
          }
        },
      }
    },
  }
  return { client, inserts, updates }
}

function arm(opts: Parameters<typeof makeMarketingClient>[0] = {}) {
  const fake = makeMarketingClient(opts)
  vi.mocked(createAdminSupabaseClient).mockReturnValue(
    fake.client as unknown as ReturnType<typeof createAdminSupabaseClient>
  )
  return fake
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("MARKETING_CONTACTS_ENABLED", "true")
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe("upsertMarketingContact — flag gating", () => {
  it("no-ops (no client, no queries) when MARKETING_CONTACTS_ENABLED is not 'true'", async () => {
    for (const value of ["false", "", "TRUE", "1"]) {
      vi.stubEnv("MARKETING_CONTACTS_ENABLED", value)
      const res = await upsertMarketingContact({ email: "a@b.com", status: "trial" })
      expect(res).toEqual({ ok: true, skipped: true, reason: "flag_off" })
    }
    expect(createAdminSupabaseClient).not.toHaveBeenCalled()
  })
})

describe("upsertMarketingContact — insert path (no existing row)", () => {
  it("inserts a brand-new 'trial' row via the two-step (insert 'access_granted', then UPDATE to 'trial') so Chris's BEFORE UPDATE OF status trigger fires", async () => {
    const { inserts, updates } = arm({ existing: null })
    const res = await upsertMarketingContact({
      email: "Op@Restaurant.com ",
      industryType: "restaurant",
      status: "trial",
      source: "getticket.ai",
    })
    expect(res.ok).toBe(true)
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({
      email: "op@restaurant.com",
      industry_type: "restaurant",
      status: "access_granted",
      source: "getticket.ai",
    })
    expect(updates).toHaveLength(1)
    expect(updates[0]).toEqual({
      values: { status: "trial" },
      col: "email",
      val: "op@restaurant.com",
    })
  })

  it("inserts pre-lifecycle statuses ('waitlist') directly with NO second step", async () => {
    const { inserts, updates } = arm({ existing: null })
    const res = await upsertMarketingContact({
      email: "a@b.com",
      industryType: "restaurant",
      status: "waitlist",
    })
    expect(res.ok).toBe(true)
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({ status: "waitlist" })
    expect(updates).toHaveLength(0)
  })

  it("surfaces a failed status step (row remains at 'access_granted'; retry takes the trigger-safe existing-row path)", async () => {
    const { inserts } = arm({ existing: null, updateError: { message: "boom" } })
    const res = await upsertMarketingContact({
      email: "a@b.com",
      industryType: "restaurant",
      status: "trial",
    })
    expect(res.ok).toBe(false)
    expect(inserts[0]).toMatchObject({ status: "access_granted" })
  })

  it("skips when the row does not exist and no industry is known (NOT NULL constraint)", async () => {
    const { inserts } = arm({ existing: null })
    const res = await upsertMarketingContact({ email: "a@b.com", status: "trial" })
    expect(res).toEqual({ ok: true, skipped: true, reason: "no_existing_row_and_no_industry" })
    expect(inserts).toHaveLength(0)
  })
})

describe("upsertMarketingContact — existing-row path", () => {
  it("updates status in place (single UPDATE — inherently trigger-safe)", async () => {
    const { inserts, updates } = arm({ existing: { id: "c1", status: "access_granted" } })
    const res = await upsertMarketingContact({ email: "a@b.com", status: "trial" })
    expect(res.ok).toBe(true)
    expect(inserts).toHaveLength(0)
    expect(updates).toHaveLength(1)
    expect(updates[0].values).toEqual({ status: "trial" })
    expect(updates[0].val).toBe("c1")
  })

  it("never regresses a lifecycle status: incoming 'access_granted' onto an existing 'trial' row drops status but keeps the rest of the update", async () => {
    const { updates } = arm({ existing: { id: "c1", status: "trial" } })
    const res = await upsertMarketingContact({
      email: "a@b.com",
      status: "access_granted",
      firstName: "Sam",
    })
    expect(res.ok).toBe(true)
    expect(updates).toHaveLength(1)
    expect(updates[0].values).toEqual({ first_name: "Sam" })
  })

  it("skips the write entirely when the downgrade guard leaves nothing to update", async () => {
    const { updates } = arm({ existing: { id: "c1", status: "paid" } })
    const res = await upsertMarketingContact({ email: "a@b.com", status: "waitlist" })
    expect(res.ok).toBe(true)
    expect(res.skipped).toBe(true)
    expect(updates).toHaveLength(0)
  })

  it("returns the error when the read fails (never writes blind)", async () => {
    const { inserts, updates } = arm({ readError: { message: "read down" } })
    const res = await upsertMarketingContact({ email: "a@b.com", status: "trial" })
    expect(res.ok).toBe(false)
    expect(inserts).toHaveLength(0)
    expect(updates).toHaveLength(0)
  })
})

// ── ALT-679: business_name ────────────────────────────────────────────────────
// The bug was not a wrong value, it was an ABSENT FIELD: marketing.contacts has had a
// business_name column all along and v_trial_onboarding_due hands it to the drip templates,
// but UpsertMarketingContactInput had no way to express it, so every contact in prod carries
// NULL. A missing field writes nothing and reports no error, which is why nobody noticed until
// a drip email rendered blank. These pin the mapping on both write paths.
describe("upsertMarketingContact — business_name (ALT-679)", () => {
  it("writes business_name on the insert path", async () => {
    const { inserts } = arm({ existing: null })
    const res = await upsertMarketingContact({
      email: "op@restaurant.com",
      industryType: "restaurant",
      status: "access_granted",
      businessName: "407 BBQ",
      firstName: "Bryan",
      lastName: "Castles",
    })
    expect(res.ok).toBe(true)
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({
      business_name: "407 BBQ",
      first_name: "Bryan",
      last_name: "Castles",
    })
  })

  it("writes business_name on the update path", async () => {
    const { updates } = arm({ existing: { id: "c1", status: "trial" } })
    const res = await upsertMarketingContact({
      email: "op@restaurant.com",
      businessName: "407 BBQ",
    })
    expect(res.ok).toBe(true)
    expect(updates).toHaveLength(1)
    expect(updates[0].values).toMatchObject({ business_name: "407 BBQ" })
  })

  it("omits business_name entirely when not supplied, rather than nulling an existing value", async () => {
    // A caller that does not know the business must not erase one another path already wrote.
    const { updates } = arm({ existing: { id: "c1", status: "trial" } })
    await upsertMarketingContact({ email: "op@restaurant.com", firstName: "Bryan" })
    expect(updates).toHaveLength(1)
    expect(Object.keys(updates[0].values)).not.toContain("business_name")
  })

  it("can clear business_name deliberately with an explicit null", async () => {
    const { updates } = arm({ existing: { id: "c1", status: "trial" } })
    await upsertMarketingContact({ email: "op@restaurant.com", businessName: null })
    expect(updates[0].values).toMatchObject({ business_name: null })
  })
})
