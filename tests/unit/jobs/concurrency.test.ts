// ENG-M6: the bounded-concurrency primitive the SEO/insights pipelines rely on. Those pipelines are
// live-only (no CI coverage), so pinning the helper's contract — full coverage, the limit is
// respected, one rejection doesn't abort the batch, and a 0/negative limit can't spin forever — is
// what makes parallelizing them safe.

import { describe, it, expect } from "vitest"
import { mapWithConcurrency } from "@/lib/jobs/concurrency"

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

describe("mapWithConcurrency", () => {
  it("runs fn over every item", async () => {
    const seen: number[] = []
    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => { seen.push(n) })
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0
    let maxInFlight = 0
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await tick()
      inFlight--
    })
    expect(maxInFlight).toBeLessThanOrEqual(3)
    expect(maxInFlight).toBeGreaterThan(1) // actually ran concurrently
  })

  it("continues past a rejecting item (fail-soft via allSettled)", async () => {
    const done: number[] = []
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom")
        done.push(n)
      }),
    ).resolves.toBeUndefined()
    expect(done.sort((a, b) => a - b)).toEqual([1, 3])
  })

  it("floors limit at 1 so a 0/negative limit can't spin forever", async () => {
    const seen: number[] = []
    await mapWithConcurrency([1, 2], 0, async (n) => { seen.push(n) })
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2])
  })

  it("no-ops on empty input", async () => {
    let called = false
    await mapWithConcurrency([], 3, async () => { called = true })
    expect(called).toBe(false)
  })
})
