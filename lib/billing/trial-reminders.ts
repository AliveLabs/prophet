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

  const diffDays = utcCalendarDaysUntil(new Date(org.trial_ends_at), now)
  if (diffDays === 4) return 10
  if (diffDays === 1) return 13
  return null
}

/** ALT-710: whole CALENDAR days (UTC) between two instants, not the wall-clock delta.
 *
 *  This was `Math.ceil((end - now) / 86400000)`, which mixes an instant difference with a day
 *  count, and the cron runs at a fixed 09:00 UTC while `trial_ends_at` lands at whatever hour the
 *  customer signed up. So the schedule shifted by a day for everyone who signed up after 09:00:
 *
 *    signup 10:00 -> trial_ends_at day14 10:00
 *      day13 09:00 cron: 25h remaining -> ceil 2 -> NO day-13 email
 *      day14 09:00 cron:  1h remaining -> ceil 1 -> day-13 email, ONE HOUR before the charge
 *
 *  So the "your trial ends tomorrow" email arrived on the day the card was charged, and the
 *  day-10 email arrived on day 11. Checkout promises reminders on day 10 and day 13, and for
 *  every afternoon signup we broke that promise on both.
 *
 *  Every existing test used exact 24-hour multiples of `NOW`, which is the one case where `ceil`
 *  is right. That is why this survived: the tests and the bug agreed.
 *
 *  Compared in UTC because `trial_ends_at` is a UTC instant and the cron is a UTC schedule.
 *  Deliberately NOT the org's timezone: `locations.timezone` is `America/New_York` on every row
 *  in prod today and not one of them is actually Eastern (ALT-739), so reading it here would
 *  trade a known-correct clock for a known-wrong one. */
function utcCalendarDaysUntil(end: Date, now: Date): number {
  const dayStart = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  return Math.round((dayStart(end) - dayStart(now)) / 86_400_000)
}
