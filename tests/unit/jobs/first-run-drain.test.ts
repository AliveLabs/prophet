// The first-run fast path: a brand-new location's jobs must jump the */5 cron tick and the
// fleet-wide, created_at-ordered claim queue. What matters is WHICH jobs it touches, in what
// order, and that every gate the cron worker applies still applies here.
//
// The Supabase client is faked at the query-builder level (the same shape-mocking approach
// tests/unit/jobs/brief-data-gate.test.ts uses) and `runJob` is injected, so this exercises the
// real ordering / gating / budget logic with no database and no pipelines.

import { describe, it, expect } from "vitest"
import { drainFirstRun } from "@/lib/jobs/first-run-drain"
import type { SB, SignalJob } from "@/lib/jobs/queue"
import type { WorkerJobResult } from "@/lib/jobs/worker"

type Row = Partial<SignalJob> & { id: string; pipeline: string }

function job(id: string, pipeline: string, over: Partial<SignalJob> = {}): SignalJob {
  return {
    id,
    run_id: "run-1",
    organization_id: "org-1",
    location_id: "loc-1",
    pipeline,
    status: "queued",
    attempts: 0,
    max_attempts: 3,
    cursor: { mode: "first_run" },
    scheduled_for: new Date(Date.now() - 1000).toISOString(),
    claimed_at: null,
    last_error: null,
    created_at: new Date(Date.now() - 60_000).toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  } as SignalJob
}

/**
 * A fake signal_jobs table that supports exactly the three call shapes the drain uses:
 *   dueFirstRunJobs  from().select("*").eq().eq().lte().order().limit()
 *   claimJobById     from().update().eq().eq().select("*")   and   from().update().eq()
 *   countPending     from().select(id,{count,head}).eq().in().in()
 */
function fakeStore(rows: Row[], opts: { pendingData?: number } = {}) {
  const table = new Map(rows.map((r) => [r.id, { ...r } as SignalJob]))
  const claims: string[] = []
  const defers: string[] = []

  const sb = {
    from: () => ({
      select: (cols: string, modifiers?: { count?: string; head?: boolean }) => {
        if (modifiers?.head) {
          // countPendingPipelines
          return {
            eq: () => ({ in: () => ({ in: () => Promise.resolve({ count: opts.pendingData ?? 0, error: null }) }) }),
          }
        }
        void cols
        // dueFirstRunJobs
        const due = () =>
          Promise.resolve({
            data: [...table.values()]
              .filter((r) => r.status === "queued")
              .sort((a, b) => a.created_at.localeCompare(b.created_at)),
            error: null,
          })
        return { eq: () => ({ eq: () => ({ lte: () => ({ order: () => ({ limit: due }) }) }) }) }
      },
      update: (patch: Partial<SignalJob>) => ({
        eq: (_c: string, id: string) => {
          const applyClaim = () => {
            const row = table.get(id)
            if (!row || row.status !== "queued") return { data: [], error: null }
            row.status = "running"
            claims.push(id)
            return { data: [{ ...row }], error: null }
          }
          // claimJobById's conditional update, then its attempts bump / deferJob's requeue
          if (patch.status === "running") {
            return { eq: () => ({ select: () => Promise.resolve(applyClaim()) }) }
          }
          if (patch.status === "queued") {
            const row = table.get(id)
            if (row) row.status = "queued"
            defers.push(id)
          }
          return Promise.resolve({ data: null, error: null })
        },
      }),
    }),
  } as unknown as SB

  return { sb, table, claims, defers }
}

const okResult = (j: SignalJob): WorkerJobResult => ({
  jobId: j.id,
  pipeline: j.pipeline,
  outcome: "fresh",
  disposition: "done",
})

describe("drainFirstRun", () => {
  it("runs the starter FIRST — it is enqueued first and claimed in created_at order", async () => {
    const now = Date.now()
    const { sb } = fakeStore([
      job("s", "starter", { created_at: new Date(now - 3000).toISOString() }),
      job("c", "content", { created_at: new Date(now - 2000).toISOString() }),
      job("v", "visibility", { created_at: new Date(now - 1000).toISOString() }),
    ])
    const order: string[] = []
    const result = await drainFirstRun(sb, "loc-1", {
      concurrency: 1,
      runner: async (_sb, j) => {
        order.push(j.pipeline)
        const row = j
        // the executor marks it done, as runJob's finishJob would
        ;(row as { status: string }).status = "done"
        return okResult(j)
      },
    })
    expect(order[0]).toBe("starter")
    expect(result.ran).toHaveLength(3)
  })

  it("only ever touches first_run jobs — a nightly job for the same location is left alone", async () => {
    const { sb, claims } = fakeStore([
      job("s", "starter"),
      job("n", "content", { cursor: { mode: "daily" } as SignalJob["cursor"] }),
    ])
    await drainFirstRun(sb, "loc-1", {
      concurrency: 1,
      runner: async (_sb, j) => {
        ;(j as { status: string }).status = "done"
        return okResult(j)
      },
    })
    expect(claims).toEqual(["s"])
  })

  it("DEFERS a first-run insights job while its data pulls are pending, and does not run it", async () => {
    const { sb, defers } = fakeStore([job("i", "insights")], { pendingData: 4 })
    const ran: string[] = []
    const result = await drainFirstRun(sb, "loc-1", {
      concurrency: 1,
      runner: async (_sb, j) => {
        ran.push(j.pipeline)
        return okResult(j)
      },
    })
    expect(ran).toEqual([])
    expect(defers).toEqual(["i"])
    expect(result.deferred).toBe(1)
  })

  it("runs a first-run insights job the moment nothing is pending — no timer floor", async () => {
    const { sb } = fakeStore([job("i", "insights")], { pendingData: 0 })
    const ran: string[] = []
    await drainFirstRun(sb, "loc-1", {
      concurrency: 1,
      runner: async (_sb, j) => {
        ran.push(j.pipeline)
        ;(j as { status: string }).status = "done"
        return okResult(j)
      },
    })
    expect(ran).toEqual(["insights"])
  })

  it("honours the budget guard: a job that cannot finish in the time left is not started", async () => {
    let clock = 0
    const { sb, claims } = fakeStore([job("s", "starter"), job("b", "brief")])
    await drainFirstRun(sb, "loc-1", {
      concurrency: 1,
      budgetMs: 700_000,
      now: () => clock,
      runner: async (_sb, j) => {
        // the first job consumes most of the budget
        clock += 650_000
        ;(j as { status: string }).status = "done"
        return okResult(j)
      },
    })
    // brief's estimate (780s) cannot fit in what is left, so it stays queued for the next call.
    expect(claims).toEqual(["s"])
  })

  it("reports moreWork when a job is left queued, so the caller knows to come back", async () => {
    let clock = 0
    const { sb } = fakeStore([job("s", "starter"), job("b", "brief")])
    const result = await drainFirstRun(sb, "loc-1", {
      concurrency: 1,
      budgetMs: 700_000,
      now: () => clock,
      runner: async (_sb, j) => {
        clock += 650_000 // the brief no longer fits, so it is left queued
        ;(j as { status: string }).status = "done"
        return okResult(j)
      },
    })
    expect(result.ran.map((r) => r.pipeline)).toEqual(["starter"])
    expect(result.moreWork).toBe(true)
  })

  it("returns cleanly with nothing to do", async () => {
    const { sb } = fakeStore([])
    const result = await drainFirstRun(sb, "loc-1", { runner: async (_sb, j) => okResult(j) })
    expect(result).toMatchObject({ ran: [], deferred: 0, moreWork: false })
  })

  it("never rethrows a job failure — one bad pipeline cannot abort the drain", async () => {
    const { sb } = fakeStore([job("s", "starter"), job("c", "content")])
    const result = await drainFirstRun(sb, "loc-1", {
      concurrency: 1,
      runner: async (_sb, j) => {
        ;(j as { status: string }).status = "done"
        if (j.pipeline === "starter") throw new Error("boom")
        return okResult(j)
      },
    })
    expect(result.ran.map((r) => r.pipeline)).toEqual(["content"])
  })
})
