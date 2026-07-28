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

/**
 * Whether an ADMIN OWNERSHIP TRANSFER should point the new owner's
 * current_organization_id at the org they just received.
 *
 * Transfer used to only write organization_members, which stranded the new owner: both
 * /auth/callback and resolveOperator() read ONLY profiles.current_organization_id and
 * redirect to /onboarding when it's null — with no membership fallback. So a freshly
 * invited owner was asked to onboard a restaurant from scratch while already owning one
 * with full history, and couldn't reach it even by typing /home.
 *
 * Rule is narrower than shouldClaimCurrentOrg on purpose: point them at it only when they
 * have nowhere else to be. Someone who already operates another restaurant must not have
 * their dashboard silently repointed by an admin action; they can switch accounts in-app.
 */
export function shouldPointNewOwnerAtOrg(
  existingCurrentOrgId: string | null | undefined
): boolean {
  return !existingCurrentOrgId
}
