// ---------------------------------------------------------------------------
// Timezone-staggered brief scheduling.
//
// Vercel crons are UTC-ONLY (no per-cron timezone). A single "0 8 * * *" fired the WHOLE fleet at
// 08:00 UTC — which isn't "morning" anywhere in the US (it's ~4 AM ET / ~1 AM PT) and, more importantly,
// is one all-at-once burst that self-contends at scale (the 2026-07 concurrency finding).
//
// Instead the build-brief cron runs HOURLY, and each location is enqueued only during its OWN local
// build hour (default 3 AM). This (a) staggers the fleet across time zones — each hourly tick enqueues
// just the zone whose clock reads 3 AM — and (b) keeps briefs "built overnight, local time" as the fleet
// spreads across zones. 3 AM is deliberately outside the 1-2 AM DST "fall-back" fold, so it's unambiguous
// every day; IANA zones (locations.timezone) handle offsets + DST automatically.
//
// Pure + injectable-clock so it's fully unit-testable (no live cron needed).
// ---------------------------------------------------------------------------

/** Default local hour (0-23) to build a location's daily brief. 3 AM: overnight, finished before daytime
 *  admin work (most operators), and outside the 1-2 AM DST fold. Override via BRIEF_BUILD_LOCAL_HOUR.
 *  Breakfast / 24-hour venues that need a different hour are a future per-location override, not this. */
export const DEFAULT_BUILD_LOCAL_HOUR = 3

/** When a location's timezone is missing/invalid, fall back to this zone so it still builds daily
 *  (never silently skipped forever). */
export const FALLBACK_ZONE = "America/New_York"

/** The current local hour (0-23) in an IANA timezone, or null if the timezone string is invalid. */
export function localHourInZone(timezone: string, now: Date): number | null {
  try {
    // hourCycle "h23" → 00..23 (midnight = 0), avoiding the "24" some ICU builds emit for h24.
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now)
    const hour = Number(formatted)
    return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null
  } catch {
    return null // RangeError: invalid time zone
  }
}

/** True when `now` falls in the location's local build hour. A missing/invalid tz falls back to
 *  FALLBACK_ZONE so the location still builds (once) each day rather than being skipped forever. */
export function isLocalBuildHour(
  timezone: string | null | undefined,
  now: Date,
  targetHour: number = DEFAULT_BUILD_LOCAL_HOUR,
): boolean {
  const tz = timezone && timezone.trim() ? timezone : FALLBACK_ZONE
  const hour = localHourInZone(tz, now) ?? localHourInZone(FALLBACK_ZONE, now)
  return hour === targetHour
}

/** Resolve the configured target build hour (env override, else the 3 AM default). Clamped to 0-23. */
export function resolveBuildHour(env: string | undefined = process.env.BRIEF_BUILD_LOCAL_HOUR): number {
  const n = Number(env)
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : DEFAULT_BUILD_LOCAL_HOUR
}

/** Seconds between same-zone build starts (env BRIEF_JITTER_SPACING_SECONDS, default 7 min). A build
 *  runs ~6-15 min, so 7-min spacing keeps ~1-2 in flight instead of the whole zone at once. */
export const DEFAULT_JITTER_SPACING_SECONDS = 420

/** Enqueue delay for the Nth eligible location in a build tick. The timezone gate stops the CROSS-zone
 *  herd, but every location in one zone still hits its build hour together — 2026-07-07: all 7 (one
 *  zone) enqueued within 1s, workers overlapped for ~80 min of sustained max-concurrency building, and
 *  the marginal skills timed out into fallbacks (31% floor). Spacing the zone's jobs a few minutes
 *  apart keeps builds ~sequential. Capped at 50 min so every job still starts inside the build hour
 *  (the NEXT hourly tick skips these locations anyway — their job is queued/active). */
export function briefJitterSeconds(index: number, spacingEnv: string | undefined = process.env.BRIEF_JITTER_SPACING_SECONDS): number {
  const parsed = Number(spacingEnv)
  const spacing = Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_JITTER_SPACING_SECONDS
  return Math.min(Math.max(0, index) * spacing, 3000)
}
