// ---------------------------------------------------------------------------
// Nightly judge over real served briefs (ALT-543 step 5).
//
// Two properties carry the design and are worth the most test effort:
//
//   1. TRUNCATED GROUND TRUTH IS SKIPPED. The judge penalises any claim it cannot find in the
//      ground truth, so scoring a brief whose summary was cut off records a falsely LOW score. Left
//      unhandled that would bias the entire trend downward and manufacture phantom regressions.
//   2. IT NEVER THROWS. This runs on a cron. A quality monitor that crashes reads as an infra
//      failure and pages the wrong person; per-brief failures must be counted, not fatal.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, afterEach } from "vitest"
import { runNightlyJudge, summarizeJudgeRun, mean, type JudgeStore } from "@/lib/eval/nightly-judge"

afterEach(() => vi.restoreAllMocks())

/** A judge that always returns the same score, so assertions are about plumbing not model output. */
const judgeReturning = (score: number, toneDeaf: string[] = []) =>
  vi.fn(async () =>
    JSON.stringify({
      scores: {
        specificity: score,
        nonObviousness: score,
        actionableSmallBudget: score,
        groundingFaithfulness: score,
      },
      toneDeaf,
      notes: "",
    }),
  )

type Row = { location_id: string; date_key: string; brief: unknown }

const briefRow = (id: string, over: Record<string, unknown> = {}): Row => ({
  location_id: id,
  date_key: "2026-08-01",
  brief: {
    locationId: id,
    dateKey: "2026-08-01",
    plays: [{ title: "t", rationale: "r", evidenceRefs: ["menu_gap"] }],
    judgeGroundTruth: "RULE OUTPUTS: - menu_gap: they sell a smash burger",
    ...over,
  },
})

/**
 * Minimal Supabase stub. `.select()` chains resolve to whichever queued result is next: the runner
 * makes exactly two reads (trailing baseline, then candidates).
 */
function storeStub(results: { data: unknown; error?: { message: string } }[], onUpdate?: (b: unknown) => void) {
  let call = 0
  const chain = () => {
    const c: Record<string, unknown> = {}
    for (const m of ["select", "not", "is", "order", "limit", "eq"]) {
      c[m] = vi.fn(() => c)
    }
    // Awaiting the chain resolves the next queued result.
    ;(c as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve(results[call++] ?? { data: [] })
    c.update = vi.fn((payload: { brief: unknown }) => {
      onUpdate?.(payload.brief)
      const u: Record<string, unknown> = {}
      u.eq = vi.fn(() => u)
      ;(u as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve({ error: null })
      return u
    })
    return c
  }
  return { from: vi.fn(() => chain()) } as unknown as JudgeStore
}

describe("mean", () => {
  it("returns null on an empty list rather than NaN", () => {
    expect(mean([])).toBeNull()
    expect(mean([1, 2, 3])).toBe(2)
  })
})

describe("truncated ground truth", () => {
  it("SKIPS briefs whose ground truth was truncated, so the trend is not biased downward", async () => {
    const generate = judgeReturning(4)
    const report = await runNightlyJudge({
      store: storeStub([
        { data: [] }, // no trailing history
        { data: [briefRow("loc-truncated", { judgeGroundTruthTruncated: true }), briefRow("loc-ok")] },
      ]),
      generate,
      sample: 5,
    })
    expect(report.skippedTruncated).toBe(1)
    expect(report.judged.map((j) => j.locationId)).toEqual(["loc-ok"])
    expect(generate).toHaveBeenCalledOnce() // the truncated one never reached the model
  })
})

describe("regression detection", () => {
  it("flags a drop past the threshold against the trailing mean", async () => {
    const prior = [{ brief: { judge: { overall: 4.5 } } }, { brief: { judge: { overall: 4.5 } } }]
    const report = await runNightlyJudge({
      store: storeStub([{ data: prior }, { data: [briefRow("loc-1")] }]),
      generate: judgeReturning(3.0),
      sample: 1,
    })
    expect(report.trailingMean).toBeCloseTo(4.5)
    expect(report.batchMean).toBeCloseTo(3.0)
    expect(report.delta).toBeCloseTo(-1.5)
    expect(report.regression).toBe(true)
  })

  it("does NOT flag ordinary variation", async () => {
    const prior = [{ brief: { judge: { overall: 4.0 } } }]
    const report = await runNightlyJudge({
      store: storeStub([{ data: prior }, { data: [briefRow("loc-1")] }]),
      generate: judgeReturning(3.9),
      sample: 1,
    })
    expect(report.regression).toBe(false)
  })

  it("never flags a regression on the first run, when there is no trailing history", async () => {
    const report = await runNightlyJudge({
      store: storeStub([{ data: [] }, { data: [briefRow("loc-1")] }]),
      generate: judgeReturning(1.0), // even a terrible score
      sample: 1,
    })
    expect(report.trailingMean).toBeNull()
    expect(report.delta).toBeNull()
    expect(report.regression).toBe(false)
  })
})

describe("resilience", () => {
  it("counts a per-brief judge failure and keeps going", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    let n = 0
    const generate = vi.fn(async () => {
      if (n++ === 0) throw new Error("model down")
      return JSON.stringify({ scores: { specificity: 4, nonObviousness: 4, actionableSmallBudget: 4, groundingFaithfulness: 4 } })
    })
    const report = await runNightlyJudge({
      store: storeStub([{ data: [] }, { data: [briefRow("loc-a"), briefRow("loc-b")] }]),
      generate,
      sample: 5,
    })
    expect(report.errors).toBe(1)
    expect(report.judged).toHaveLength(1) // the second brief still got judged
  })

  it("skips briefs with no plays or no ground truth without erroring", async () => {
    const generate = judgeReturning(4)
    const report = await runNightlyJudge({
      store: storeStub([
        { data: [] },
        { data: [briefRow("no-plays", { plays: [] }), briefRow("no-gt", { judgeGroundTruth: undefined })] },
      ]),
      generate,
      sample: 5,
    })
    expect(report.judged).toHaveLength(0)
    expect(report.errors).toBe(0)
    expect(generate).not.toHaveBeenCalled()
  })
})

describe("dryRun", () => {
  it("judges but writes nothing back", async () => {
    const writes: unknown[] = []
    const report = await runNightlyJudge({
      store: storeStub([{ data: [] }, { data: [briefRow("loc-1")] }], (b) => writes.push(b)),
      generate: judgeReturning(4),
      sample: 1,
      dryRun: true,
    })
    expect(report.judged).toHaveLength(1)
    expect(writes).toHaveLength(0)
    expect(report.dryRun).toBe(true)
  })

  it("writes the verdict back on a normal run", async () => {
    const writes: Record<string, unknown>[] = []
    await runNightlyJudge({
      store: storeStub([{ data: [] }, { data: [briefRow("loc-1")] }], (b) => writes.push(b as Record<string, unknown>)),
      generate: judgeReturning(4),
      sample: 1,
    })
    expect(writes).toHaveLength(1)
    const judge = (writes[0] as { judge?: { overall: number; model: string } }).judge
    expect(judge?.overall).toBeCloseTo(4)
    expect(judge?.model).toBeTruthy() // attribution: which model produced this score
  })
})

describe("summarizeJudgeRun", () => {
  it("reads cleanly with no history", () => {
    const s = summarizeJudgeRun({
      judged: [],
      skippedTruncated: 0,
      batchMean: null,
      trailingMean: null,
      delta: null,
      regression: false,
      errors: 0,
      dryRun: false,
    })
    expect(s).toContain("judged 0 brief(s)")
    expect(s).toContain("n/a")
  })

  it("surfaces the delta sign, skips and errors", () => {
    const s = summarizeJudgeRun({
      judged: [{ locationId: "l", dateKey: "d", overall: 3 }],
      skippedTruncated: 2,
      batchMean: 3,
      trailingMean: 4,
      delta: -1,
      regression: true,
      errors: 1,
      dryRun: true,
    })
    expect(s).toContain("-1.00")
    expect(s).toContain("skipped 2 truncated")
    expect(s).toContain("1 error(s)")
    expect(s).toContain("(dry-run)")
  })
})
