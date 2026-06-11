export const TRIAL_DURATION_DAYS = 14

interface TrialOrg {
  trial_ends_at: string | null
  subscription_tier: string
  payment_state?: string | null
}

// The one access rule (trial-tier-model-plan.md v2, "trial is OF Tier 2"):
//
//   - subscription_tier = 'suspended' -> NEVER active (admin override)
//   - payment_state present (org has been through Stripe checkout) -> blocked
//       only when Stripe has given up: canceled | incomplete_expired | unpaid.
//       trialing / active / past_due / incomplete -> active.
//   - payment_state null (never completed checkout) -> active iff trial_ends_at
//       is in the future. Covers pre-Stripe internal-clock trials and the
//       trial_ends=2099 internal orgs. New orgs are created with NO clock, so
//       they stay blocked until checkout completes — that IS the card gate.
//
// Note: there is no 'free' branch. Legacy 'free' rows have null payment_state,
// so they gate on the clock exactly as before.
export function isTrialActive(org: TrialOrg): boolean {
  if (org.subscription_tier === "suspended") return false

  if (org.payment_state != null) {
    const blocked =
      org.payment_state === "canceled" ||
      org.payment_state === "incomplete_expired" ||
      org.payment_state === "unpaid"
    return !blocked
  }

  if (!org.trial_ends_at) return false
  return new Date(org.trial_ends_at) > new Date()
}

// Is the org currently in a trial (as opposed to paying)? Drives the trial
// banner, the daily-cadence-during-trial cron rule, admin trial filters, and
// the add-location gate. Card-backed Stripe trials report payment_state
// 'trialing'; legacy clock-only trials have null payment_state + a live clock.
export function isTrialing(org: TrialOrg): boolean {
  if (org.subscription_tier === "suspended") return false
  if (org.payment_state === "trialing") return true
  if (org.payment_state != null) return false
  if (!org.trial_ends_at) return false
  return new Date(org.trial_ends_at) > new Date()
}

// Actually paying (converted): Stripe considers the subscription current and
// it is past the trial phase. past_due/incomplete count as paying-but-dunning.
export function isPaidActive(org: TrialOrg): boolean {
  if (org.subscription_tier === "suspended") return false
  return (
    org.payment_state === "active" ||
    org.payment_state === "past_due" ||
    org.payment_state === "incomplete"
  )
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
