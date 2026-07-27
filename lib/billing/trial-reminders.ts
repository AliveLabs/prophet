// Which trial-reminder email (if any) an org is due for today.
//
// Extracted from the trial-reminders cron so the eligibility rules are unit-testable.
// The cron previously selected ONLY card-backed Stripe trials (payment_state='trialing'),
// which meant an org on a card-less clock trial ("skip for now" at onboarding) reached
// day 14 with no warning and simply hit the paywall. Both kinds are eligible now; the
// caller varies the copy via hasCardOnFile().

export type ReminderDay = 10 | 13

export interface ReminderCandidate {
  trial_ends_at: string | null
  payment_state?: string | null
  subscription_tier?: string | null
  /** 'real' | 'demo' | 'test' — demo/test orgs run long internal trials. */
  org_kind?: string | null
}

/** Does this org have a card Stripe will charge at trial end? */
export function hasCardOnFile(org: Pick<ReminderCandidate, "payment_state">): boolean {
  return org.payment_state != null
}

/**
 * The reminder due for `org` as of `now`, or null.
 *
 * Day 10 = trial ends in 4 days ("T-4"); day 13 = ends tomorrow ("T-1"). Named for the
 * day of the trial so it matches the checkout promise ("we'll remind you on day 10 and 13").
 */
export function resolveReminderDay(
  org: ReminderCandidate,
  now: Date
): ReminderDay | null {
  if (!org.trial_ends_at) return null
  // Admin-suspended orgs are not in a trial at all.
  if (org.subscription_tier === "suspended") return null
  // Beta/demo/test orgs run multi-hundred-day internal trials; a "your trial is
  // ending, add a card" email is wrong for them (same rule as the trial banner).
  if (org.org_kind != null && org.org_kind !== "real") return null

  // Eligible: card-backed Stripe trial, or a card-less clock trial. Anything else with a
  // payment_state (canceled / unpaid / active / past_due…) is not a trial we remind about.
  const isCardBackedTrial = org.payment_state === "trialing"
  const isCardlessTrial = org.payment_state == null
  if (!isCardBackedTrial && !isCardlessTrial) return null

  const diffDays = Math.ceil(
    (new Date(org.trial_ends_at).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  )
  if (diffDays === 4) return 10
  if (diffDays === 1) return 13
  return null
}
