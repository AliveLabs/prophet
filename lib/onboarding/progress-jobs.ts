// Which signal_jobs rows describe "the first run" for the progress endpoint — pure, so the rule
// is unit-testable.
//
// The subtlety this module exists for (Chris, 2026-08-25): the first-run batch enqueues starter,
// the data pulls and insights under ONE run_id, but the `brief` job is enqueued LATER, and not
// always under that run_id. The worker chains it with the same run_id when first-run insights
// finishes — unless a brief job already exists for the location (the ALT-674 dedupe), and one
// usually does, because /home's self-healing enqueuer (ensureBriefQueued) fires the moment the
// operator lands on the panel, minting a FRESH run_id with no first_run cursor. Filtering strictly
// on run_id therefore hid the one job the operator was waiting on: every visible row read Done,
// the panel said "Everything has landed" while the brief row fell back to "Queued", and the
// auto-swap condition (brief job done) could never fire. Chris sat on that screen for 22 minutes
// while the brief was already built.
//
// So: the run is still identified by the newest first_run job's run_id, but the brief row is the
// location's NEWEST brief job regardless of run_id, because for a location with no brief yet there
// is only one brief anyone can mean.

export type ProgressJobRow = {
  run_id: string
  pipeline: string
  status: string
  cursor: unknown
  created_at: string
}

export type ProgressJob = { pipeline: string; status: string }

function isFirstRun(cursor: unknown): boolean {
  return (
    typeof cursor === "object" &&
    cursor !== null &&
    (cursor as { mode?: string }).mode === "first_run"
  )
}

/**
 * Select the jobs the progress panel should report, from this location's jobs NEWEST FIRST.
 * Returns the first-run batch's jobs plus the location's newest `brief` job (whatever run it
 * belongs to), and the run's start (earliest created_at of the batch — never the adopted brief,
 * which by construction is enqueued after the batch).
 */
export function selectProgressJobs(jobs: ProgressJobRow[]): {
  runJobs: ProgressJob[]
  runStartedAt: string | null
} {
  const latest = jobs.find((j) => isFirstRun(j.cursor))
  if (!latest) return { runJobs: [], runStartedAt: null }

  const thisRun = jobs.filter((j) => j.run_id === latest.run_id)
  const runStartedAt = thisRun.reduce(
    (earliest, j) => (j.created_at < earliest ? j.created_at : earliest),
    thisRun[0].created_at
  )

  if (!thisRun.some((j) => j.pipeline === "brief")) {
    const brief = jobs.find((j) => j.pipeline === "brief")
    if (brief) thisRun.push(brief)
  }

  return {
    runJobs: thisRun.map((j) => ({ pipeline: j.pipeline, status: j.status })),
    runStartedAt,
  }
}
