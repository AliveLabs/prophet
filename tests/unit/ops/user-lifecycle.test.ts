import { describe, it, expect } from "vitest"
import {
  classifyUserLifecycle,
  summarizeUserLifecycle,
  type UserLifecycleRow,
} from "@/lib/ops/user-lifecycle"

// Found 2026-08-21: the admin "Never onboarded" tile read 1 when the true answer was 2, and the 1
// was not even one of the 2. The old predicate was `!profile.current_organization_id`, which is
// "not attached to an org", not "never activated".
//
// The fixture below is the REAL prod shape at the time (11 auth users), reduced to the three rows
// that decide the count. Numbers here are measured, not invented.

const NOW = Date.parse("2026-08-21T14:00:00Z")
const RECENT = "2026-08-20T23:00:00Z" // inside the 7-day window
const OLD = "2026-07-01T00:00:00Z" // outside it

function row(over: Partial<UserLifecycleRow> = {}): UserLifecycleRow {
  return {
    lastSignInAt: RECENT,
    lastSeenAtResolved: RECENT,
    currentOrganizationId: "org-1",
    isBanned: false,
    ...over,
  }
}

/** megan@bushswestex.com and larry.glass@oneesca.com: invited, membership row created and
 *  current_organization_id SET for them, but last_sign_in_at is null. Never signed in once. */
const invitedNeverSignedIn = row({
  lastSignInAt: null,
  lastSeenAtResolved: null,
  currentOrganizationId: "org-1",
})

/** chris@alivelabs.io: onboarded, used the product for weeks, then his org was deleted
 *  2026-08-20, so current_organization_id was nulled. He has NOT "never onboarded". */
const onboardedThenOrgDeleted = row({
  lastSignInAt: RECENT,
  lastSeenAtResolved: RECENT,
  currentOrganizationId: null,
})

describe("classifyUserLifecycle", () => {
  it("counts an INVITED user who never signed in as never_signed_in, despite having an org", () => {
    // THE false negative. The old predicate saw current_organization_id and called this onboarded.
    expect(classifyUserLifecycle(invitedNeverSignedIn)).toBe("never_signed_in")
  })

  it("does NOT call a real user never_signed_in just because their org was deleted", () => {
    // THE false positive. This is a distinct state, and it is not "never onboarded".
    expect(classifyUserLifecycle(onboardedThenOrgDeleted)).toBe("signed_in_no_org")
  })

  it("classifies a normal attached user as onboarded", () => {
    expect(classifyUserLifecycle(row())).toBe("onboarded")
  })

  it("checks never-signed-in BEFORE the org, which is the whole fix", () => {
    // Both fields set the way an invite leaves them. If the org test ran first this returns
    // "onboarded" and the user vanishes from the count again.
    const invited = row({ lastSignInAt: null, currentOrganizationId: "org-9" })
    expect(classifyUserLifecycle(invited)).not.toBe("onboarded")
    expect(classifyUserLifecycle(invited)).toBe("never_signed_in")
  })

  it("a user with neither a sign-in nor an org is still never_signed_in, not double counted", () => {
    expect(classifyUserLifecycle(row({ lastSignInAt: null, currentOrganizationId: null }))).toBe(
      "never_signed_in",
    )
  })
})

describe("summarizeUserLifecycle: the exact prod case that was misreported", () => {
  // 11 users: 8 fully onboarded, 2 invited-never-signed-in (Megan, Larry), 1 signed-in-no-org
  // (Chris, after his org was deleted).
  const prodShape: UserLifecycleRow[] = [
    ...Array.from({ length: 8 }, () => row()),
    invitedNeverSignedIn,
    invitedNeverSignedIn,
    onboardedThenOrgDeleted,
  ]

  it("reports 2 never signed in, which is what Bryan counted by hand", () => {
    const s = summarizeUserLifecycle(prodShape, { nowMs: NOW })
    expect(s.total).toBe(11)
    expect(s.neverSignedIn).toBe(2)
  })

  it("reports the org-less user separately instead of hiding him in the same number", () => {
    const s = summarizeUserLifecycle(prodShape, { nowMs: NOW })
    expect(s.signedInNoOrg).toBe(1)
    expect(s.onboarded).toBe(8)
    // Every user lands in exactly one bucket.
    expect(s.neverSignedIn + s.signedInNoOrg + s.onboarded).toBe(s.total)
  })

  it("the OLD predicate would have produced the wrong answer on this same data", () => {
    // Regression guard stated as arithmetic: `!currentOrganizationId` yields 1, not 2, and that
    // 1 is the wrong person. If someone reinstates the old rule, this documents what breaks.
    const oldPredicateCount = prodShape.filter((u) => !u.currentOrganizationId).length
    expect(oldPredicateCount).toBe(1)
    expect(oldPredicateCount).not.toBe(summarizeUserLifecycle(prodShape, { nowMs: NOW }).neverSignedIn)
  })

  it("never-signed-in users are never counted as active", () => {
    const s = summarizeUserLifecycle(prodShape, { nowMs: NOW })
    // 8 onboarded + Chris were seen recently; Megan and Larry have null timestamps.
    expect(s.activeLast7d).toBe(9)
  })
})

describe("summarizeUserLifecycle: window and edge handling", () => {
  it("excludes a stale last_seen_at from the active count", () => {
    const s = summarizeUserLifecycle([row({ lastSeenAtResolved: OLD })], { nowMs: NOW })
    expect(s.activeLast7d).toBe(0)
    expect(s.onboarded).toBe(1)
  })

  it("counts deactivated users independently of their stage", () => {
    const s = summarizeUserLifecycle(
      [row({ isBanned: true }), row({ isBanned: true, lastSignInAt: null }), row()],
      { nowMs: NOW },
    )
    expect(s.deactivated).toBe(2)
    expect(s.neverSignedIn).toBe(1)
    expect(s.onboarded).toBe(2)
  })

  it("treats an unparseable timestamp as not active rather than throwing", () => {
    const s = summarizeUserLifecycle([row({ lastSeenAtResolved: "not-a-date" })], { nowMs: NOW })
    expect(s.activeLast7d).toBe(0)
  })

  it("an empty roster is all zeros, not a crash", () => {
    const s = summarizeUserLifecycle([], { nowMs: NOW })
    expect(s).toEqual({
      total: 0,
      neverSignedIn: 0,
      signedInNoOrg: 0,
      onboarded: 0,
      activeLast7d: 0,
      deactivated: 0,
    })
  })
})
