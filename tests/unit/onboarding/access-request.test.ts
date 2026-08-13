import { describe, it, expect } from "vitest"
import {
  planAccessRequestTransition,
  canRequesterEscalate,
  isOpenStatus,
  ageInDays,
  NUDGE_AFTER_DAYS,
  ESCALATE_AFTER_DAYS,
  EXPIRE_AFTER_DAYS,
  type AccessRequestStatus,
} from "@/lib/onboarding/access-request"

const NOW = new Date("2026-08-13T09:15:00Z")

/** A request created `days` before NOW. */
function createdDaysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString()
}

function plan(status: AccessRequestStatus, days: number) {
  return planAccessRequestTransition({ status, createdAt: createdDaysAgo(days) }, NOW)
}

describe("isOpenStatus", () => {
  it("counts pending, nudged and escalated as open; granted and expired as closed", () => {
    expect(isOpenStatus("pending")).toBe(true)
    expect(isOpenStatus("nudged")).toBe(true)
    expect(isOpenStatus("escalated")).toBe(true)
    expect(isOpenStatus("granted")).toBe(false)
    expect(isOpenStatus("expired")).toBe(false)
  })
})

describe("canRequesterEscalate", () => {
  it("allows escalation while the owner still hasn't acted", () => {
    expect(canRequesterEscalate("pending")).toBe(true)
    expect(canRequesterEscalate("nudged")).toBe(true)
  })

  it("refuses to re-escalate or to reopen a resolved request", () => {
    expect(canRequesterEscalate("escalated")).toBe(false)
    expect(canRequesterEscalate("granted")).toBe(false)
    expect(canRequesterEscalate("expired")).toBe(false)
  })
})

describe("ageInDays", () => {
  it("measures whole days from created_at", () => {
    expect(ageInDays(createdDaysAgo(0), NOW)).toBe(0)
    expect(ageInDays(createdDaysAgo(4), NOW)).toBe(4)
    // Hours short of the next day still read as the lower day.
    expect(ageInDays(new Date(NOW.getTime() - 3.9 * 86_400_000).toISOString(), NOW)).toBe(3)
  })
})

describe("planAccessRequestTransition", () => {
  it("does nothing while a fresh request is inside the nudge window", () => {
    expect(plan("pending", 0)).toBe("none")
    expect(plan("pending", NUDGE_AFTER_DAYS - 1)).toBe("none")
  })

  it("nudges a pending request on day 4", () => {
    expect(plan("pending", NUDGE_AFTER_DAYS)).toBe("nudge")
  })

  it("holds a nudged request until day 7, then escalates", () => {
    expect(plan("nudged", ESCALATE_AFTER_DAYS - 1)).toBe("none")
    expect(plan("nudged", ESCALATE_AFTER_DAYS)).toBe("escalate")
  })

  it("nudges before escalating even when both thresholds passed (cron downtime catch-up)", () => {
    // A pending request that is 9 days old has blown past both windows. The owner still
    // gets their reminder first; escalation comes on a later run.
    expect(plan("pending", ESCALATE_AFTER_DAYS + 2)).toBe("nudge")
  })

  it("expires pending and nudged requests at 30 days", () => {
    expect(plan("pending", EXPIRE_AFTER_DAYS)).toBe("expire")
    expect(plan("nudged", EXPIRE_AFTER_DAYS)).toBe("expire")
    expect(plan("nudged", EXPIRE_AFTER_DAYS + 40)).toBe("expire")
  })

  it("never auto-expires or re-touches an escalated request: a human asked us for help", () => {
    expect(plan("escalated", ESCALATE_AFTER_DAYS)).toBe("none")
    expect(plan("escalated", EXPIRE_AFTER_DAYS)).toBe("none")
    expect(plan("escalated", EXPIRE_AFTER_DAYS + 100)).toBe("none")
  })

  it("leaves terminal states alone", () => {
    expect(plan("granted", EXPIRE_AFTER_DAYS + 5)).toBe("none")
    expect(plan("expired", EXPIRE_AFTER_DAYS + 5)).toBe("none")
  })

  it("is idempotent per run: applying a nudge moves the row out of the nudge branch", () => {
    // The status write IS the dedupe: day 4 nudges, and the same day re-run as 'nudged'
    // does nothing because escalation is still three days out.
    expect(plan("pending", NUDGE_AFTER_DAYS)).toBe("nudge")
    expect(plan("nudged", NUDGE_AFTER_DAYS)).toBe("none")
  })
})
