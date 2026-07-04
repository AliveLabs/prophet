// ---------------------------------------------------------------------------
// Anthropic concurrency governor (in-process).
//
// One brief fans out ~9 producer thinking-calls at once (Promise.all), then ~7 write-calls. Fired
// unbounded, that burst competes with itself for the account's rate limit → rising latency → the
// per-call abort → silent fallback (the 2026-07 finding: even an ISOLATED build sometimes times out
// its heaviest skill). This semaphore caps concurrent in-flight Anthropic calls so the burst smooths
// into a steady rate instead of self-contending.
//
// SCOPE: this is a PER-INSTANCE limiter. It governs the dominant within-invocation burst (the 9-wide
// producer fan-out inside one brief, plus any concurrent builds Fluid Compute co-locates on the same
// warm instance). It does NOT cap concurrency ACROSS separate serverless instances — that needs a
// distributed limiter (Upstash/Redis token bucket) or the Vercel AI Gateway's rate management, which
// is the next scale-out step (see the scaling analysis note). Combined with the timezone build stagger
// (fewer concurrent builds per zone), the per-instance cap covers normal operation; the distributed
// cap is for the 100+-location horizon.
//
// The abort clock (per-call timeout) starts AFTER a slot is acquired (inside claudeRaw's fetch loop),
// so time spent waiting for a slot does NOT eat a call's timeout budget — only the overall brief budget.
// ---------------------------------------------------------------------------

/** A minimal promise-based counting semaphore. `available` = free slots; on release, a waiting caller
 *  is handed the slot directly (available stays put) rather than incrementing then re-decrementing. */
export class Semaphore {
  private available: number
  private waiters: Array<() => void> = []
  private active = 0

  constructor(max: number) {
    this.available = Math.max(1, Math.floor(max))
  }

  /** Run `fn` while holding a slot; the slot is always released, even if `fn` throws. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    this.active++
    try {
      return await fn()
    } finally {
      this.active--
      this.release()
    }
  }

  private async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--
      return
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve))
    // Slot was handed to us directly by release() — do NOT decrement `available` again.
  }

  private release(): void {
    const next = this.waiters.shift()
    if (next) next()
    else this.available++
  }

  /** Observability: currently-running count + how many are queued waiting for a slot. */
  stats(): { active: number; waiting: number } {
    return { active: this.active, waiting: this.waiters.length }
  }
}

/** Max concurrent Anthropic calls per instance. Default 6: shaves the 9-wide producer burst so calls
 *  don't starve each other of rate, while keeping enough parallelism that briefs stay fast. Tune via
 *  env without a code change. */
export const ANTHROPIC_MAX_CONCURRENCY = (() => {
  const n = Number(process.env.ANTHROPIC_MAX_CONCURRENCY)
  return Number.isInteger(n) && n >= 1 ? n : 6
})()

const anthropicLimiter = new Semaphore(ANTHROPIC_MAX_CONCURRENCY)

let lastSaturationLog = 0
/** Run an Anthropic call under the global per-instance cap. Logs (throttled) when the cap is saturated
 *  so we can SEE contention building before it turns into timeouts — the leading signal at scale. */
export function withAnthropicSlot<T>(fn: () => Promise<T>): Promise<T> {
  const { active, waiting } = anthropicLimiter.stats()
  if (active >= ANTHROPIC_MAX_CONCURRENCY) {
    const now = Date.now()
    if (now - lastSaturationLog > 5_000) {
      lastSaturationLog = now
      console.warn(`[anthropic-governor] saturated: active=${active} waiting=${waiting + 1} (cap=${ANTHROPIC_MAX_CONCURRENCY})`)
    }
  }
  return anthropicLimiter.run(fn)
}

/** Test/observability seam. */
export function anthropicLimiterStats(): { active: number; waiting: number } {
  return anthropicLimiter.stats()
}
