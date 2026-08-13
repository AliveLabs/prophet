// Weekly-digest scheduling (beta rescue D6). Two contracts pinned here:
//   1. The SEND GATE is off unless WEEKLY_DIGEST_EMAILS_ENABLED === "true".
//      The digest must remain unsendable until Bryan's content review, and the
//      OFF state must not be reachable by flipping CLIENT_EMAILS_ENABLED.
//   2. The per-user day + local-morning filter (Monday default), including the
//      catch-up window and the invalid-timezone fallback.

import { describe, it, expect } from "vitest"
import {
  DEFAULT_DIGEST_DAY,
  DEFAULT_DIGEST_LOCAL_HOUR,
  digestDateKey,
  isWeeklyDigestSendEnabled,
  localDayOfWeekInZone,
  resolveDigestCatchupHours,
  resolveDigestDay,
  resolveDigestHour,
  shouldSendDigestNow,
} from "@/lib/email/digest-schedule"

// 2026-08-17 is a Monday. 13:00Z = 09:00 America/New_York (EDT, UTC-4).
const MON_9AM_ET = new Date("2026-08-17T13:00:00Z")
const MON_7AM_ET = new Date("2026-08-17T11:00:00Z")
const MON_1PM_ET = new Date("2026-08-17T17:00:00Z")
const TUE_9AM_ET = new Date("2026-08-18T13:00:00Z")
const ET = "America/New_York"

describe("isWeeklyDigestSendEnabled — the D6 gate", () => {
  it("is OFF for unset, empty, 'false', '1', and wrong-case 'TRUE'", () => {
    for (const v of [undefined, "", "false", "0", "1", "TRUE", "yes", "true "]) {
      expect(isWeeklyDigestSendEnabled(v)).toBe(false)
    }
  })

  it("is ON only for the exact string 'true'", () => {
    expect(isWeeklyDigestSendEnabled("true")).toBe(true)
  })
})

describe("resolveDigestDay", () => {
  it("defaults to Monday for null/undefined/non-integer/out-of-range values", () => {
    for (const v of [null, undefined, "1", 1.5, -1, 7, NaN, {}]) {
      expect(resolveDigestDay(v)).toBe(DEFAULT_DIGEST_DAY)
    }
    expect(DEFAULT_DIGEST_DAY).toBe(1)
  })

  it("passes through every valid weekday index, including Sunday (0)", () => {
    for (let d = 0; d <= 6; d++) expect(resolveDigestDay(d)).toBe(d)
  })
})

describe("resolveDigestHour / resolveDigestCatchupHours", () => {
  it("falls back to the 8 AM default on missing or invalid env", () => {
    for (const v of [undefined, "", "abc", "-1", "24", "8.5"]) {
      expect(resolveDigestHour(v)).toBe(DEFAULT_DIGEST_LOCAL_HOUR)
    }
    expect(resolveDigestHour("6")).toBe(6)
    expect(resolveDigestHour("0")).toBe(0)
  })

  it("clamps the catch-up window to 1-24 hours", () => {
    expect(resolveDigestCatchupHours("0")).toBe(4)
    expect(resolveDigestCatchupHours("25")).toBe(4)
    expect(resolveDigestCatchupHours("6")).toBe(6)
  })
})

describe("localDayOfWeekInZone", () => {
  it("returns the LOCAL weekday, not the UTC one", () => {
    // 2026-08-18T01:00Z is Tuesday UTC but still Monday 21:00 in New York.
    expect(localDayOfWeekInZone(ET, new Date("2026-08-18T01:00:00Z"))).toBe(1)
    expect(localDayOfWeekInZone("UTC", new Date("2026-08-18T01:00:00Z"))).toBe(2)
  })

  it("returns null for an invalid timezone", () => {
    expect(localDayOfWeekInZone("Not/AZone", MON_9AM_ET)).toBeNull()
  })
})

describe("shouldSendDigestNow — per-user day + local-morning filter", () => {
  it("sends on the preferred day inside the send window", () => {
    expect(shouldSendDigestNow(1, ET, MON_9AM_ET)).toBe(true)
  })

  it("does NOT send on a day the user did not pick", () => {
    expect(shouldSendDigestNow(1, ET, TUE_9AM_ET)).toBe(false)
    expect(shouldSendDigestNow(2, ET, MON_9AM_ET)).toBe(false)
  })

  it("sends on Tuesday for a user who picked Tuesday", () => {
    expect(shouldSendDigestNow(2, ET, TUE_9AM_ET)).toBe(true)
  })

  it("does not send before the local send hour", () => {
    expect(shouldSendDigestNow(1, ET, MON_7AM_ET)).toBe(false)
  })

  it("stays eligible through the catch-up window, then stops (missed-tick self-heal, bounded)", () => {
    // 8 AM default + 4h window -> 8,9,10,11 eligible; 12 and 13 are not.
    expect(shouldSendDigestNow(1, ET, new Date("2026-08-17T15:00:00Z"))).toBe(true) // 11 AM
    expect(shouldSendDigestNow(1, ET, new Date("2026-08-17T16:00:00Z"))).toBe(false) // 12 PM
    expect(shouldSendDigestNow(1, ET, MON_1PM_ET)).toBe(false)
  })

  it("honors an explicit sendHour / catchupHours override", () => {
    expect(shouldSendDigestNow(1, ET, MON_7AM_ET, { sendHour: 7 })).toBe(true)
    expect(shouldSendDigestNow(1, ET, MON_1PM_ET, { sendHour: 8, catchupHours: 6 })).toBe(true)
  })

  it("is timezone-local: the same instant is due in one zone and not another", () => {
    // 13:00Z = 9 AM in New York (due) but 6 AM in Los Angeles (too early).
    expect(shouldSendDigestNow(1, ET, MON_9AM_ET)).toBe(true)
    expect(shouldSendDigestNow(1, "America/Los_Angeles", MON_9AM_ET)).toBe(false)
  })

  it("falls back to the default zone (never silently skips) on a missing or invalid timezone", () => {
    expect(shouldSendDigestNow(1, null, MON_9AM_ET)).toBe(true)
    expect(shouldSendDigestNow(1, "   ", MON_9AM_ET)).toBe(true)
    expect(shouldSendDigestNow(1, "Not/AZone", MON_9AM_ET)).toBe(true)
  })

  it("treats a corrupt stored preference as Monday rather than muting the digest", () => {
    expect(shouldSendDigestNow(NaN, ET, MON_9AM_ET)).toBe(true)
    expect(shouldSendDigestNow(99, ET, MON_9AM_ET)).toBe(true)
  })

  it("never spills past local midnight even with a wide catch-up window", () => {
    // 22:00 send hour + 6h catch-up must not make Tuesday 02:00 eligible.
    const tue2am = new Date("2026-08-18T06:00:00Z")
    expect(shouldSendDigestNow(1, ET, tue2am, { sendHour: 22, catchupHours: 6 })).toBe(false)
  })
})

describe("digestDateKey — dedupe key", () => {
  it("is the recipient's LOCAL calendar date", () => {
    expect(digestDateKey(ET, new Date("2026-08-18T01:00:00Z"))).toBe("2026-08-17")
    expect(digestDateKey("UTC", new Date("2026-08-18T01:00:00Z"))).toBe("2026-08-18")
  })

  it("is stable across the whole catch-up window, so a retried tick dedupes", () => {
    expect(digestDateKey(ET, MON_9AM_ET)).toBe(digestDateKey(ET, new Date("2026-08-17T15:00:00Z")))
  })

  it("falls back rather than returning null on an invalid timezone", () => {
    expect(digestDateKey("Not/AZone", MON_9AM_ET)).toBe("2026-08-17")
  })
})
