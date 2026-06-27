// SEC-M2 / SEC-H2-H3 follow-up: the shared rate limiter must (a) extract the client IP from the
// standard proxy headers, (b) FAIL OPEN when Upstash isn't configured (so it never takes the app
// down or blocks local dev), and (c) compute a sane Retry-After. The live limiting path needs
// Redis and is covered by the integration env; this pins the wrapper logic.

import { describe, it, expect, beforeAll } from "vitest"
import { clientIp, retryAfterSeconds, rateLimit } from "@/lib/http/rate-limit"

beforeAll(() => {
  // Ensure the limiter resolves to "unconfigured" so we test the fail-open path deterministically.
  delete process.env.UPSTASH_REDIS_REST_URL
  delete process.env.UPSTASH_REDIS_REST_TOKEN
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
})

const reqWith = (headers: Record<string, string>) =>
  new Request("https://x/api", { headers })

describe("clientIp", () => {
  it("takes the first hop of x-forwarded-for", () => {
    expect(clientIp(reqWith({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4")
  })
  it("falls back to x-real-ip", () => {
    expect(clientIp(reqWith({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9")
  })
  it("returns 'unknown' when no IP header is present", () => {
    expect(clientIp(reqWith({}))).toBe("unknown")
  })
})

describe("rateLimit — fail-open when unconfigured", () => {
  it("allows the request and reports the full budget when Upstash is absent", async () => {
    const r = await rateLimit("any-id", { prefix: "test", limit: 5, windowSeconds: 60 })
    expect(r.ok).toBe(true)
    expect(r.remaining).toBe(5)
    expect(r.reset).toBe(0)
  })
})

describe("retryAfterSeconds", () => {
  it("defaults to 60 when there is no reset timestamp", () => {
    expect(retryAfterSeconds({ ok: false, limit: 1, remaining: 0, reset: 0 })).toBe(60)
  })
  it("rounds up the seconds until the window resets", () => {
    const r = retryAfterSeconds({ ok: false, limit: 1, remaining: 0, reset: Date.now() + 4_200 })
    expect(r).toBeGreaterThanOrEqual(1)
    expect(r).toBeLessThanOrEqual(5)
  })
})
