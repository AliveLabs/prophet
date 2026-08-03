import { describe, it, expect, beforeEach } from "vitest"
import {
  shouldTouchLastSeen,
  touchLastSeen,
  PRESENCE_THROTTLE_MS,
  __resetPresenceCacheForTests,
} from "@/lib/auth/presence"

describe("shouldTouchLastSeen", () => {
  const now = Date.parse("2026-08-03T12:00:00Z")

  it("writes when this instance has never seen the user", () => {
    expect(shouldTouchLastSeen({ lastTouchedMs: null, nowMs: now })).toBe(true)
  })

  it("skips inside the throttle window", () => {
    expect(shouldTouchLastSeen({ lastTouchedMs: now - 60_000, nowMs: now })).toBe(false)
  })

  it("writes once the window has elapsed", () => {
    expect(
      shouldTouchLastSeen({ lastTouchedMs: now - PRESENCE_THROTTLE_MS, nowMs: now }),
    ).toBe(true)
  })

  it("writes when the stored stamp is in the future (clock skew must not lock writes out)", () => {
    expect(shouldTouchLastSeen({ lastTouchedMs: now + 60_000, nowMs: now })).toBe(true)
  })
})

/** Records the PostgREST chain so we can assert on the filters, not just that it was called. */
function stubStore() {
  const calls: Array<{ table: string; payload: unknown; eq: [string, unknown]; or: string }> = []
  let failWith: Error | null = null

  const store = {
    from(table: string) {
      return {
        update(payload: unknown) {
          const rec = { table, payload, eq: ["", null] as [string, unknown], or: "" }
          const chain = {
            eq(col: string, val: unknown) {
              rec.eq = [col, val]
              return chain
            },
            or(expr: string) {
              rec.or = expr
              calls.push(rec)
              if (failWith) return Promise.reject(failWith)
              return Promise.resolve({ error: null })
            },
          }
          return chain
        },
      }
    },
  }

  return {
    store: store as never,
    calls,
    fail(e: Error) {
      failWith = e
    },
  }
}

describe("touchLastSeen", () => {
  const now = Date.parse("2026-08-03T12:00:00Z")

  beforeEach(() => {
    __resetPresenceCacheForTests()
  })

  it("stamps profiles.last_seen_at with a staleness filter, not a blind write", () => {
    const { store, calls } = stubStore()
    return touchLastSeen(store, "user-1", now).then(() => {
      expect(calls).toHaveLength(1)
      expect(calls[0].table).toBe("profiles")
      expect(calls[0].payload).toEqual({ last_seen_at: new Date(now).toISOString() })
      expect(calls[0].eq).toEqual(["id", "user-1"])
      // The window must be in the WHERE clause too, so a cold instance can't stampede the row.
      expect(calls[0].or).toContain("last_seen_at.is.null")
      expect(calls[0].or).toContain(
        `last_seen_at.lt.${new Date(now - PRESENCE_THROTTLE_MS).toISOString()}`,
      )
    })
  })

  it("collapses a burst on the same instance into ONE write", async () => {
    const { store, calls } = stubStore()
    await Promise.all([
      touchLastSeen(store, "user-1", now),
      touchLastSeen(store, "user-1", now + 10),
      touchLastSeen(store, "user-1", now + 20),
    ])
    expect(calls).toHaveLength(1)
  })

  it("writes again after the window, and tracks users independently", async () => {
    const { store, calls } = stubStore()
    await touchLastSeen(store, "user-1", now)
    await touchLastSeen(store, "user-1", now + PRESENCE_THROTTLE_MS)
    await touchLastSeen(store, "user-2", now)
    expect(calls).toHaveLength(3)
  })

  it("never throws when the write fails — presence must not break a render", async () => {
    const { store, fail } = stubStore()
    fail(new Error("db down"))
    await expect(touchLastSeen(store, "user-1", now)).resolves.toBeUndefined()
  })

  it("ignores an empty user id", async () => {
    const { store, calls } = stubStore()
    await touchLastSeen(store, "", now)
    expect(calls).toHaveLength(0)
  })
})
