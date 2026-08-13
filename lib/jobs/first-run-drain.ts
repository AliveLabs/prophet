// ---------------------------------------------------------------------------
// First-run fast path (beta rescue Phase 3.1) — FIRST RUN ONLY.
//
// WHY THIS EXISTS. The durable queue is drained by a cron on a */5 schedule, and
// `claim_signal_jobs` is fleet-wide and orders by created_at. Both are right for the nightly
// drain and both are wrong for a brand-new signup:
//   · the tick alone costs a new location up to 5 minutes before anything starts, and
//   · at 06:00 the daily cron enqueues the whole fleet, so a 07:00 signup's jobs sit BEHIND
//     every one of them.
// The result is a first session where nothing happens. This drains ONE location's first-run jobs
// immediately, so a brand-new location jumps the cadence and the backlog.
//
// IT IS THE SAME WORKER, NOT A SECOND ONE. Every job still runs through `runJob`, still records a
// pipeline_runs outcome, still retries through `finishJob`'s backoff, still respects the budget
// guard (`shouldDeferJob`) and the data-readiness gate (`claimedJobShouldWait`). The only
// differences are WHICH jobs it looks at (this location, first_run scope only) and that it runs a
// few concurrently.
//
// THE NIGHTLY PATH IS UNTOUCHED. Nothing here can claim a job that is not scoped `first_run`, and
// `enqueueFirstRun` is the only thing that ever creates those, once per location. A location that
// already has briefs has no first-run jobs at all, and the route refuses it anyway.
//
// IF THE CALLER GOES AWAY (the operator closes the tab mid-drain), an in-flight job is left
// 'running' and the existing 20-minute zombie reclaim in the cron worker requeues it. That is
// exactly what already happens when a worker invocation dies mid-batch: a known, handled failure
// mode, not a new one.
// ---------------------------------------------------------------------------

import {
  claimJobById,
  claimedJobShouldWait,
  deferJob,
  dueFirstRunJobs,
  shouldDeferJob,
  type SB,
  type SignalJob,
} from "@/lib/jobs/queue"
import { runJob, type WorkerJobResult } from "@/lib/jobs/worker"

/** How many first-run jobs run at once.
 *
 *  2 by default, and the default is a deliberate middle: the pipelines are independent, and each
 *  already fans out 3-4 concurrent vendor calls internally, so running three or four whole
 *  pipelines at once puts a dozen simultaneous requests on the data vendors for a single new
 *  location. The Anthropic side is governed (lib/ai/concurrency.ts) but the vendors are not.
 *  Env dial so this is tunable against real first-run behaviour without a deploy. */
export const FIRST_RUN_DRAIN_CONCURRENCY = (() => {
  const raw = Number(process.env.FIRST_RUN_DRAIN_CONCURRENCY ?? 2)
  if (!Number.isFinite(raw)) return 2
  return Math.min(Math.max(Math.floor(raw), 1), 4)
})()

/** Wall-clock budget for ONE drain call. Under the route's maxDuration (800s) with headroom, so
 *  the call returns a real summary instead of being killed mid-flight. The caller re-invokes
 *  while work remains. */
export const FIRST_RUN_DRAIN_BUDGET_MS = 700_000

export type FirstRunDrainResult = {
  ran: WorkerJobResult[]
  deferred: number
  /** True when jobs remain for this location, so the caller should invoke again. */
  moreWork: boolean
  elapsedMs: number
}

/**
 * Claim and run this location's due first-run jobs until the budget is spent or nothing is left.
 *
 * `now` is injectable so the budget arithmetic can be exercised without waiting on a clock.
 */
export async function drainFirstRun(
  sb: SB,
  locationId: string,
  opts: {
    concurrency?: number
    budgetMs?: number
    now?: () => number
    /** Test seam, mirroring the engine's injectable-transport convention: the ordering, gating and
     *  budget decisions are the whole point of this module, and they are only reachable without a
     *  database if the job executor can be swapped. Production always uses the real `runJob`. */
    runner?: typeof runJob
  } = {},
): Promise<FirstRunDrainResult> {
  const concurrency = opts.concurrency ?? FIRST_RUN_DRAIN_CONCURRENCY
  const budgetMs = opts.budgetMs ?? FIRST_RUN_DRAIN_BUDGET_MS
  const now = opts.now ?? Date.now
  const run = opts.runner ?? runJob
  const startedAt = now()

  const ran: WorkerJobResult[] = []
  let deferred = 0
  // Ids this call has already handled (claimed, deferred, or lost the claim race on), so the
  // re-query each pass cannot hand back the same row forever.
  const handled = new Set<string>()
  // Jobs this call deferred on readiness (the first-run insights job, waiting on its data pulls).
  // They are re-eligible as soon as some other job COMPLETES, so a single call can carry a
  // location from data pulls straight through to insights instead of ending the invocation and
  // making the caller come back. Gated on real progress, so it cannot spin.
  const readinessDeferred = new Set<string>()
  const inFlight = new Map<string, Promise<void>>()

  /** The next job this call may START, already claimed. Null when there is nothing runnable. */
  async function nextClaimed(): Promise<SignalJob | null> {
    const due = await dueFirstRunJobs(sb, locationId)
    for (const candidate of due) {
      if (handled.has(candidate.id)) continue
      // Budget guard, same rule the cron worker uses: the first job of an invocation always runs;
      // after that a job only starts if its (pessimistic) estimate fits the time left.
      const executed = ran.length + inFlight.size
      if (shouldDeferJob({ pipeline: candidate.pipeline, elapsedMs: now() - startedAt, executed })) {
        // Leave it queued for the next call / the cron worker. Not marked handled: a cheaper job
        // later in the list may still fit, and this one may fit on the next invocation.
        continue
      }
      handled.add(candidate.id)
      const claimed = await claimJobById(sb, candidate.id)
      if (!claimed) continue // the cron worker got there first; that is fine, it will run it
      // Data readiness (first-run insights waits for its data pulls; see claimedJobShouldWait).
      if (await claimedJobShouldWait(sb, claimed)) {
        try {
          await deferJob(sb, claimed)
          deferred++
          readinessDeferred.add(claimed.id)
        } catch (e) {
          console.warn(`[first-run] defer failed for ${claimed.id} (${claimed.pipeline}):`, e)
        }
        continue
      }
      return claimed
    }
    return null
  }

  while (now() - startedAt < budgetMs) {
    while (inFlight.size < concurrency) {
      const job = await nextClaimed()
      if (!job) break
      const task = run(sb, job)
        .then((result) => {
          ran.push(result)
        })
        .catch((e) => {
          // runJob is already failure-isolating; this is the last-resort net so one job's throw
          // cannot reject the whole drain.
          console.warn(`[first-run] runJob threw for ${job.id} (${job.pipeline}):`, e)
        })
      inFlight.set(
        job.id,
        task.finally(() => {
          inFlight.delete(job.id)
        }),
      )
    }
    if (inFlight.size === 0) break
    await Promise.race(inFlight.values())
    // A job finished, so a readiness-deferred job may now be ready. Re-open exactly those.
    for (const id of readinessDeferred) handled.delete(id)
    readinessDeferred.clear()
  }

  await Promise.allSettled(inFlight.values())

  // Anything still queued for this location means the caller should come back.
  let moreWork = false
  try {
    moreWork = (await dueFirstRunJobs(sb, locationId)).length > 0
  } catch {
    moreWork = false
  }

  return { ran, deferred, moreWork, elapsedMs: now() - startedAt }
}
