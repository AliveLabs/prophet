import { describe, it, expect } from "vitest"
import {
  shouldClaimCurrentOrg,
  shouldPointNewOwnerAtOrg,
  type ClaimOrg,
} from "@/lib/onboarding/claim-current-org"

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

  // current_organization_id is what every authed surface resolves from, so claiming a
  // soft-deleted org points the user at a dead end. Beats the first-org shortcut, which
  // would otherwise claim unconditionally.
  it("NEVER claims a soft-deleted org, including as the user's first org", () => {
    const deleted = { deleted_at: "2026-08-10T00:00:00Z" }
    expect(shouldClaimCurrentOrg(null, org({ trial_ends_at: future, ...deleted }))).toBe(false)
    expect(shouldClaimCurrentOrg(undefined, org({ trial_ends_at: future, ...deleted }))).toBe(false)
    expect(shouldClaimCurrentOrg("existing-org", org({ trial_ends_at: future, ...deleted }))).toBe(false)
  })

  it("still claims when deleted_at is null or absent", () => {
    expect(shouldClaimCurrentOrg(null, org({ trial_ends_at: future, deleted_at: null }))).toBe(true)
    expect(shouldClaimCurrentOrg("existing-org", org({ trial_ends_at: future }))).toBe(true)
  })
})

// Admin ownership transfer used to only write organization_members, which stranded the new
// owner: /auth/callback and resolveOperator() read ONLY profiles.current_organization_id and
// send a null to /onboarding, with no membership fallback. So a transferred owner was asked
// to set up a restaurant from scratch while already owning one with full history.
describe("shouldPointNewOwnerAtOrg", () => {
  it("points a brand-new owner at the org (no current org, or no profiles row at all)", () => {
    expect(shouldPointNewOwnerAtOrg(null)).toBe(true)
    expect(shouldPointNewOwnerAtOrg(undefined)).toBe(true)
    expect(shouldPointNewOwnerAtOrg("")).toBe(true)
  })

  it("never repoints someone who already operates a restaurant", () => {
    // An admin transferring a second org must not silently move an existing operator's
    // dashboard out from under them; they switch accounts in-app instead.
    expect(shouldPointNewOwnerAtOrg("another-org-id")).toBe(false)
  })
})
