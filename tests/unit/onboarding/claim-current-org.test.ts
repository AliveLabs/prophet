import { describe, it, expect } from "vitest"
import { shouldClaimCurrentOrg, type ClaimOrg } from "@/lib/onboarding/claim-current-org"

const future = new Date(Date.now() + 7 * 86_400_000).toISOString()

function org(over: Partial<ClaimOrg>): ClaimOrg {
  return {
    org_kind: "real",
    trial_ends_at: null,
    subscription_tier: "mid",
    payment_state: null,
    ...over,
  }
}

describe("shouldClaimCurrentOrg", () => {
  it("claims when the user has no current org yet (first org), whatever the kind", () => {
    expect(shouldClaimCurrentOrg(null, org({ org_kind: "real", trial_ends_at: future }))).toBe(true)
    expect(shouldClaimCurrentOrg(undefined, org({ org_kind: "demo", trial_ends_at: future }))).toBe(true)
    expect(shouldClaimCurrentOrg(null, null)).toBe(true)
  })

  it("claims a real, trial-active org even when a current org exists (customer's own trial)", () => {
    expect(
      shouldClaimCurrentOrg("existing-org", org({ org_kind: "real", trial_ends_at: future }))
    ).toBe(true)
    // card-backed trial (payment_state trialing) with no clock
    expect(
      shouldClaimCurrentOrg("existing-org", org({ org_kind: "real", payment_state: "trialing" }))
    ).toBe(true)
  })

  it("ALT-300: a showcase org never hijacks an existing current org, even though demos are trial-active", () => {
    // Demo orgs are created with a 365-day trial, so isTrialActive is true — the
    // old rule claimed them and repointed the admin's /home. It must not now.
    expect(
      shouldClaimCurrentOrg("miller-ale-house", org({ org_kind: "demo", trial_ends_at: future }))
    ).toBe(false)
    expect(
      shouldClaimCurrentOrg("miller-ale-house", org({ org_kind: "test", trial_ends_at: future }))
    ).toBe(false)
  })

  it("does not claim an additional not-yet-paid real org (multi-location path 2b)", () => {
    // New real org: null payment_state + no trial clock -> not trial-active.
    expect(
      shouldClaimCurrentOrg("existing-org", org({ org_kind: "real", trial_ends_at: null, payment_state: null }))
    ).toBe(false)
  })

  it("does not claim when the org row could not be loaded and a current org exists", () => {
    expect(shouldClaimCurrentOrg("existing-org", null)).toBe(false)
  })
})
