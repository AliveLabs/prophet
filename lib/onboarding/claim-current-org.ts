import { isTrialActive } from "@/lib/billing/trial"

export interface ClaimOrg {
  org_kind: string | null
  trial_ends_at: string | null
  subscription_tier: string
  payment_state?: string | null
}

// Whether completing onboarding for `org` should point the user's
// current_organization_id at it.
//
//   - No current org yet -> always claim (the user's first org).
//   - Real, trial-active org (a customer's own trial) -> claim.
//   - Showcase (demo/test) org -> NEVER hijack an existing current org. Demos
//     are admin-built and opened explicitly via the org detail page's
//     "Open demo dashboard". Setting up a second demo while the first's brief
//     is still building must not silently repoint the admin's /home (ALT-300).
//   - Additional not-yet-paid real org (multi-location path 2b) -> keep the
//     user on their existing org until checkout completes; abandoning setup
//     must not strand a paying customer on an unpaid org.
export function shouldClaimCurrentOrg(
  existingCurrentOrgId: string | null | undefined,
  org: ClaimOrg | null
): boolean {
  if (!existingCurrentOrgId) return true
  if (!org) return false
  const isShowcase = org.org_kind === "demo" || org.org_kind === "test"
  return isTrialActive(org) && !isShowcase
}
