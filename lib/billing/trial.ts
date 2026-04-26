export const TRIAL_DURATION_DAYS = 14

interface TrialOrg {
  trial_ends_at: string | null
  subscription_tier: string
  payment_state?: string | null
}

// Returns true when the org has active product access, false when blocked.
//
// Semantics under the Stripe-native trial model (Apr 2026):
//   - subscription_tier = 'suspended'            -> NEVER active (admin override)
//   - subscription_tier in ('entry','mid','top') -> active iff payment_state is
//       active | trialing | past_due | incomplete (i.e. Stripe hasn't given up
//       yet). `canceled` / `incomplete_expired` -> blocked.
//   - subscription_tier = 'free' -> only active when trial_ends_at is in the
//       future. This covers pre-rollout orgs that still have an internal trial
//       clock; post-rollout new orgs are `free` with trial_ends_at = null and
//       are blocked immediately (they must subscribe).
export function isTrialActive(org: TrialOrg): boolean {
  if (org.subscription_tier === "suspended") return false

  if (org.subscription_tier !== "free") {
    // Paid tier: gate on payment_state.
    const blocked =
      org.payment_state === "canceled" ||
      org.payment_state === "incomplete_expired" ||
      org.payment_state === "unpaid"
    return !blocked
  }

  if (!org.trial_ends_at) return false
  return new Date(org.trial_ends_at) > new Date()
}

export function getTrialDaysRemaining(org: {
  trial_ends_at: string | null
}): number {
  if (!org.trial_ends_at) return 0
  const diff = new Date(org.trial_ends_at).getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

export function isTrialExpiringSoon(
  org: { trial_ends_at: string | null },
  thresholdDays: number = 3
): boolean {
  const remaining = getTrialDaysRemaining(org)
  return remaining > 0 && remaining <= thresholdDays
}
