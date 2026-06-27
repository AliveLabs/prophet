import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"

// Shared sliding-window rate limiter backed by Upstash Redis (SEC-M2 + SEC-H2/H3 follow-up).
//
// FAIL-OPEN by design: rate limiting is PROTECTIVE, not load-bearing. If Upstash isn't configured
// (no env vars — e.g. local dev, or before the Marketplace integration is provisioned) or a Redis
// call throws, we ALLOW the request rather than take the app down over the limiter. The endpoints
// this guards are already auth-gated (quick-tip, places) or input-validated (waitlist), so the
// fail-open degrades to "today's behavior", never to an outage.
//
// To activate in an environment: add the Upstash Redis Marketplace integration in Vercel (Storage
// tab) and redeploy. It injects UPSTASH_REDIS_REST_URL/TOKEN (older KV-style integrations inject
// KV_REST_API_URL/TOKEN — both are read here).

function readRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN
  if (!url || !token) return null
  try {
    return new Redis({ url, token })
  } catch {
    return null
  }
}

// `undefined` = not yet resolved; `null` = resolved-but-unconfigured (don't retry construction).
let cachedRedis: Redis | null | undefined
function getRedis(): Redis | null {
  if (cachedRedis === undefined) cachedRedis = readRedis()
  return cachedRedis
}

// One Ratelimit instance per (prefix, limit, window) tuple — cheap to reuse, wrong to recreate.
const limiters = new Map<string, Ratelimit>()
function getLimiter(prefix: string, limit: number, windowSeconds: number): Ratelimit | null {
  const redis = getRedis()
  if (!redis) return null
  const cacheKey = `${prefix}:${limit}:${windowSeconds}`
  let limiter = limiters.get(cacheKey)
  if (!limiter) {
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
      prefix: `rl:${prefix}`,
      analytics: false,
    })
    limiters.set(cacheKey, limiter)
  }
  return limiter
}

export interface RateLimitResult {
  ok: boolean
  limit: number
  remaining: number
  /** epoch ms when the window resets (0 when limiting is inactive). */
  reset: number
}

export interface RateLimitOptions {
  /** Namespace for the limit (keeps independent buckets from colliding). */
  prefix: string
  /** Max requests allowed per window. */
  limit: number
  /** Window length in seconds. */
  windowSeconds: number
}

/**
 * Check (and consume) one unit of the rate limit for `identifier` (a user id, IP, email, ...).
 * Returns `{ ok: true }` and allows the request whenever limiting is inactive or errors.
 */
export async function rateLimit(
  identifier: string,
  opts: RateLimitOptions
): Promise<RateLimitResult> {
  const limiter = getLimiter(opts.prefix, opts.limit, opts.windowSeconds)
  if (!limiter) {
    return { ok: true, limit: opts.limit, remaining: opts.limit, reset: 0 }
  }
  try {
    const r = await limiter.limit(identifier)
    return { ok: r.success, limit: r.limit, remaining: r.remaining, reset: r.reset }
  } catch (err) {
    console.warn(`[rate-limit] ${opts.prefix} check failed; allowing request:`, err)
    return { ok: true, limit: opts.limit, remaining: opts.limit, reset: 0 }
  }
}

/** Best-effort client IP from the standard proxy headers Vercel sets. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for")
  if (xff) return xff.split(",")[0]!.trim()
  return req.headers.get("x-real-ip")?.trim() || "unknown"
}

/** Seconds until the window resets, for a Retry-After header. */
export function retryAfterSeconds(result: RateLimitResult): number {
  if (!result.reset) return 60
  return Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))
}
