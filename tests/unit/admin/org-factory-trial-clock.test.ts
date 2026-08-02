import { describe, it, expect } from "vitest"
import { createOrgWithOwner } from "@/lib/admin/org-factory"

type Insert = Record<string, unknown>

/**
 * Minimal stub of the two chains createOrgWithOwner uses:
 *   from("organizations").insert(row).select("id").single()
 *   from("organization_members").insert(row)
 * Captures the organizations row so we can assert on the trial columns.
 */
function stubAdmin() {
  const inserts: { organizations: Insert[]; organization_members: Insert[] } = {
    organizations: [],
    organization_members: [],
  }

  const admin = {
    from(table: string) {
      return {
        insert(row: Insert) {
          if (table === "organizations") {
            inserts.organizations.push(row)
            return {
              select: () => ({
                single: async () => ({ data: { id: "org-1" }, error: null }),
              }),
            }
          }
          inserts.organization_members.push(row)
          return Promise.resolve({ error: null })
        },
      }
    },
  }

  // The real signature is a typed SupabaseClient; the factory only touches the
  // two chains stubbed above.
  return { admin: admin as never, inserts }
}

describe("createOrgWithOwner trial clock", () => {
  it("omits the clock entirely when trialDays is null", async () => {
    // Waitlist approval passes null so the 14 days don't burn down while the
    // invitation sits unread, and so the operator still lands on the card step.
    const { admin, inserts } = stubAdmin()

    await createOrgWithOwner(admin, {
      ownerUserId: "user-1",
      orgName: "Bert's Diner",
      orgKind: "real",
      trialDays: null,
    })

    const row = inserts.organizations[0]
    expect(row).not.toHaveProperty("trial_started_at")
    expect(row).not.toHaveProperty("trial_ends_at")
  })

  it("still sets a clock when given a day count (demo/test orgs)", async () => {
    const { admin, inserts } = stubAdmin()

    await createOrgWithOwner(admin, {
      ownerUserId: "user-1",
      orgName: "Demo Co",
      orgKind: "demo",
      trialDays: 365,
    })

    const row = inserts.organizations[0]
    const endsAt = new Date(String(row.trial_ends_at)).getTime()
    const startedAt = new Date(String(row.trial_started_at)).getTime()
    expect(Math.round((endsAt - startedAt) / 86_400_000)).toBe(365)
  })

  it("defaults to the 14-day clock when trialDays is not passed", async () => {
    const { admin, inserts } = stubAdmin()

    await createOrgWithOwner(admin, { ownerUserId: "user-1", orgName: "Legacy Co" })

    const row = inserts.organizations[0]
    const endsAt = new Date(String(row.trial_ends_at)).getTime()
    const startedAt = new Date(String(row.trial_started_at)).getTime()
    expect(Math.round((endsAt - startedAt) / 86_400_000)).toBe(14)
  })

  it("always records the owner membership", async () => {
    const { admin, inserts } = stubAdmin()

    await createOrgWithOwner(admin, {
      ownerUserId: "user-1",
      orgName: "Bert's Diner",
      trialDays: null,
    })

    expect(inserts.organization_members[0]).toMatchObject({
      organization_id: "org-1",
      user_id: "user-1",
      role: "owner",
    })
  })
})
