// ---------------------------------------------------------------------------
// Weekly-digest scheduling (D6 plumbing -- sends stay OFF until Bryan's
// content review; see WEEKLY_DIGEST_EMAILS_ENABLED below).
//
// Rulings (beta rescue D6):
//   - Per-USER preferred day (profiles.weekly_digest_day, 0=Sun..6=Sat),
//     default Monday -- operators are often closed Mondays, so the digest
//     lands on their admin day.
//   - Generated + sent in the recipient's LOCAL morning, using the same
//     hourly-cron + local-hour filter pattern the daily brief already uses
//     (lib/jobs/build-schedule.ts): the cron runs hourly, and a recipient is
//     eligible only when their location's local clock is inside the send
//     window on their chosen day. Catch-up window + a dedupe table
//     (weekly_digest_sends) make a missed tick self-heal without double-sends,
//     mirroring shouldEnqueueBriefNow + trial_reminder_sends.
//
// Enablement is a PER-EMAIL override, like the billing emails: the digest
// route hard-stops unless WEEKLY_DIGEST_EMAILS_ENABLED === "true", and when
// enabled it sends with overrideClientEmailPause so the global
// CLIENT_EMAILS_ENABLED flip (which would also unpause welcome +
// waitlist-confirm) is never the lever. Default: OFF.
//
// Pure + injectable-clock so it's unit-testable with no cron.
// ---------------------------------------------------------------------------

import { localHourInZone, localDateInZone, FALLBACK_ZONE } from "@/lib/jobs/build-schedule"

/** Default preferred day: Monday. 0=Sunday .. 6=Saturday (JS Date convention). */
export const DEFAULT_DIGEST_DAY = 1

/** Default local hour to send: 8 AM -- morning, and hours after the 3 AM brief
 *  build, so the digest always points at a fresh brief. Override via
 *  WEEKLY_DIGEST_LOCAL_HOUR. */
export const DEFAULT_DIGEST_LOCAL_HOUR = 8

/** Hourly ticks after the send hour a recipient stays eligible (missed-tick
 *  self-heal, same rationale as DEFAULT_CATCHUP_WINDOW_HOURS for briefs). The
 *  window never crosses local midnight -- the day match is part of eligibility. */
export const DEFAULT_DIGEST_CATCHUP_HOURS = 4

/** THE send gate (D6). Sends are enabled ONLY by the exact string "true" on
 *  WEEKLY_DIGEST_EMAILS_ENABLED -- a per-email override in the spirit of
 *  overrideClientEmailPause, never the global CLIENT_EMAILS_ENABLED flip.
 *  Unset, empty, "false", "1", "TRUE" (wrong case) all mean OFF. */
export function isWeeklyDigestSendEnabled(
  env: string | undefined = process.env.WEEKLY_DIGEST_EMAILS_ENABLED
): boolean {
  return env === "true"
}

/** Human-readable OFF-state explanation, logged and returned by the cron so a
 *  no-send run is never mistaken for a broken one. */
export const DIGEST_SENDS_DISABLED_REASON =
  "WEEKLY_DIGEST_EMAILS_ENABLED is not 'true' -- weekly digest sends are OFF " +
  "(D6 gate: plumbing shipped, content pending Bryan's review). No digests " +
  "were generated or sent."

/** Sanitize a stored preference into a weekday index. Anything that isn't an
 *  integer 0-6 (missing column, null, corrupt value) falls back to Monday so a
 *  bad row degrades to the default rather than silencing the digest. */
export function resolveDigestDay(pref: unknown): number {
  return typeof pref === "number" && Number.isInteger(pref) && pref >= 0 && pref <= 6
    ? pref
    : DEFAULT_DIGEST_DAY
}

/** Number(), but an empty/whitespace env var reads as UNSET rather than 0.
 *  Number("") === 0, so a blank WEEKLY_DIGEST_LOCAL_HOUR would otherwise mean
 *  midnight -- a silent 8 AM -> 12 AM move from a var someone cleared. */
function numericEnv(env: string | undefined): number {
  return env === undefined || env.trim() === "" ? NaN : Number(env)
}

/** Resolve the send hour (env override, else 8 AM). Clamped to 0-23. */
export function resolveDigestHour(
  env: string | undefined = process.env.WEEKLY_DIGEST_LOCAL_HOUR
): number {
  const n = numericEnv(env)
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : DEFAULT_DIGEST_LOCAL_HOUR
}

/** Resolve the catch-up window. Env WEEKLY_DIGEST_CATCHUP_HOURS, clamped 1-24. */
export function resolveDigestCatchupHours(
  env: string | undefined = process.env.WEEKLY_DIGEST_CATCHUP_HOURS
): number {
  const n = numericEnv(env)
  return Number.isInteger(n) && n >= 1 && n <= 24 ? n : DEFAULT_DIGEST_CATCHUP_HOURS
}

/** Current local day-of-week (0=Sun..6=Sat) in an IANA zone, or null if the
 *  zone string is invalid (callers fall back to FALLBACK_ZONE, matching
 *  localHourInZone's contract in build-schedule). */
export function localDayOfWeekInZone(timezone: string, now: Date): number | null {
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  try {
    const name = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
    }).format(now)
    const idx = DAYS.indexOf(name)
    return idx >= 0 ? idx : null
  } catch {
    return null
  }
}

/** Should THIS recipient get the digest on THIS hourly tick?
 *  True when, in the location's local time: today is their preferred day AND
 *  the clock is inside [sendHour, sendHour + catchup), truncated at local
 *  midnight by the day match itself. Deduping against a double-positive within
 *  the window is the weekly_digest_sends table's job, not this function's.
 *  Missing/invalid timezone falls back to FALLBACK_ZONE so a recipient is
 *  never silently skipped forever. */
export function shouldSendDigestNow(
  preferredDay: number,
  timezone: string | null | undefined,
  now: Date,
  opts: { sendHour?: number; catchupHours?: number } = {}
): boolean {
  const sendHour = opts.sendHour ?? DEFAULT_DIGEST_LOCAL_HOUR
  const catchupHours = opts.catchupHours ?? DEFAULT_DIGEST_CATCHUP_HOURS
  const tz = timezone && timezone.trim() ? timezone : FALLBACK_ZONE
  const day = localDayOfWeekInZone(tz, now) ?? localDayOfWeekInZone(FALLBACK_ZONE, now)
  const hour = localHourInZone(tz, now) ?? localHourInZone(FALLBACK_ZONE, now)
  if (day === null || hour === null) return false
  if (day !== resolveDigestDay(preferredDay)) return false
  // Same-day window only: [sendHour, min(sendHour + catchup, 24)).
  return hour >= sendHour && hour < Math.min(sendHour + catchupHours, 24)
}

/** The dedupe key for a send: the recipient's local calendar date. One row per
 *  (user, location, local date) in weekly_digest_sends means the catch-up
 *  window can never double-send. */
export function digestDateKey(timezone: string | null | undefined, now: Date): string {
  const tz = timezone && timezone.trim() ? timezone : FALLBACK_ZONE
  return (
    localDateInZone(tz, now) ?? localDateInZone(FALLBACK_ZONE, now) ?? now.toISOString().slice(0, 10)
  )
}
