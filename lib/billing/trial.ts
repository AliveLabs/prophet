export const TRIAL_DURATION_DAYS = 14

/**
 * How many days before trial_ends_at the in-app trial banner starts showing.
 * Deliberately NOT the whole trial: the banner is a conversion nudge for real
 * trials in their final stretch, not ambient chrome. Beta/demo orgs (org_kind
 * 'demo'/'test') are excluded by the caller regardless of this window.
 */
export const TRIAL_BANNER_WINDOW_DAYS = 10

interface TrialOrg {
  trial_ends_at: string | null
  subscription_tier: string
  payment_state?: string | null
}

// The one access rule (trial-tier-model-plan.md v2, "trial is OF Tier 2"):
//
//   - subscription_tier = 'suspended' -> NEVER active (admin override)
//   - payment_state present (org has been through Stripe checkout) -> blocked when Stripe has
//       given up OR stopped billing: canceled | incomplete_expired | unpaid | paused.
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
    // ALT-749: `paused` was missing, so a paused subscription got FULL access. It is a value
    // `normalizePaymentState` explicitly accepts, so the system has a slot for it, and a paused
    // subscription is by definition one Stripe is not billing.
    //
    // Latent today: `paused` only arises from trial_settings.end_behavior.missing_payment_method =
    // 'pause', and our checkout sets that to 'cancel'. `pause_collection` does NOT set this status
    // (Stripe's docs are explicit). So nothing reaches it now, and one changed setting or one
    // portal action would have made it reachable and silent.
    const blocked =
      org.payment_state === "canceled" ||
      org.payment_state === "incomplete_expired" ||
      org.payment_state === "unpaid" ||
      org.payment_state === "paused"
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
