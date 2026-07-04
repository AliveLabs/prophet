// Anthropic concurrency governor. A brief fires ~9 producer thinking-calls at once; the semaphore caps
// concurrent in-flight calls so the burst can't self-contend into rate-limit-driven timeouts.

import { describe, it, expect } from "vitest"
import { Semaphore } from "@/lib/ai/concurrency"

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("Semaphore", () => {
  it("never exceeds the max concurrency, even under a big burst", async () => {
    const sem = new Semaphore(3)
    let active = 0
    let peak = 0
    const task = () =>
      sem.run(async () => {
        active++
        peak = Math.max(peak, active)
        await tick(5)
        active--
      })
    await Promise.all(Array.from({ length: 12 }, task))
    expect(peak).toBeLessThanOrEqual(3)
    expect(active).toBe(0) // all released
  })

  it("runs all tasks to completion and returns their values in order", async () => {
    const sem = new Semaphore(2)
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => sem.run(async () => { await tick(2); return n * 10 })))
    expect(results).toEqual([10, 20, 30, 40, 50])
  })

  it("releases the slot even when a task throws (a failure can't leak a slot)", async () => {
    const sem = new Semaphore(1)
    await expect(sem.run(async () => { throw new Error("boom") })).rejects.toThrow("boom")
    // If the slot had leaked, this would hang; it resolves → slot was released.
    await expect(sem.run(async () => "recovered")).resolves.toBe("recovered")
  })

  it("actually serializes when cap is 1 (mutual exclusion)", async () => {
    const sem = new Semaphore(1)
    const order: string[] = []
    const p1 = sem.run(async () => { order.push("a-start"); await tick(10); order.push("a-end") })
    const p2 = sem.run(async () => { order.push("b-start"); await tick(1); order.push("b-end") })
    await Promise.all([p1, p2])
    expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]) // b waits for a to fully finish
  })

  it("reports live stats (active + waiting)", async () => {
    const sem = new Semaphore(2)
    const running = [sem.run(() => tick(20)), sem.run(() => tick(20)), sem.run(() => tick(20))]
    await tick(2)
    const s = sem.stats()
    expect(s.active).toBe(2)
    expect(s.waiting).toBe(1)
    await Promise.all(running)
    expect(sem.stats()).toEqual({ active: 0, waiting: 0 })
  })

  it("treats a cap below 1 as 1 (never zero-slots deadlock)", async () => {
    const sem = new Semaphore(0)
    await expect(sem.run(async () => "ok")).resolves.toBe("ok")
  })
})
