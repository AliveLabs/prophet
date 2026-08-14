// Menu ingestion reliability telemetry (beta rescue 2.6, ALT-363). Two things this guards:
//   (1) the failure classification: every observation must map to exactly one (outcome, reason)
//       verdict, and the verdicts must keep "empty" (looked, found nothing) distinct from
//       "failed" (could not get an answer) — conflating those is what made menu reliability
//       unmeasurable in the first place.
//   (2) the recorder's no-throw contract: recording is observation only and must NEVER turn a
//       real menu run into a failed one. Mirrors tests/unit/ai/spend-events.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest"

const { insertMock, fromMock, createAdminSupabaseClientMock } = vi.hoisted(() => {
  const insertMock = vi.fn(async (_row: Record<string, unknown>) => ({ error: null as { message: string } | null }))
  const fromMock = vi.fn((_table: string) => ({ insert: insertMock }))
  const createAdminSupabaseClientMock = vi.fn(() => ({ from: fromMock }))
  return { insertMock, fromMock, createAdminSupabaseClientMock }
})

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: createAdminSupabaseClientMock,
}))

import {
  classifyMenuRun,
  firecrawlStatus,
  newMenuObservation,
  recordMenuIngestEvent,
  type MenuStageObservation,
} from "@/lib/content/menu-telemetry"

function obs(overrides: Partial<MenuStageObservation> = {}): MenuStageObservation {
  return { ...newMenuObservation(), ...overrides }
}

describe("firecrawlStatus", () => {
  it("skipped when no scrape was ever attempted", () => {
    expect(firecrawlStatus(obs())).toBe("skipped")
  })

  it("items when at least one scrape parsed to items, even if others errored", () => {
    expect(firecrawlStatus(obs({ scrapeAttempts: 3, scrapeErrors: 2, scrapesWithItems: 1 }))).toBe("items")
  })

  it("error only when EVERY attempt errored — one fetched page moves it to empty", () => {
    expect(firecrawlStatus(obs({ scrapeAttempts: 2, scrapeErrors: 2 }))).toBe("error")
    expect(firecrawlStatus(obs({ scrapeAttempts: 2, scrapeErrors: 1 }))).toBe("empty")
  })
})

describe("classifyMenuRun", () => {
  it("no website -> failed/no_website, regardless of anything else", () => {
    expect(classifyMenuRun(obs({ hasWebsite: false, mergedItems: 50 }))).toEqual({
      outcome: "failed",
      reason: "no_website",
    })
  })

  it("an unexpected pipeline exception -> failed/pipeline_error, even when items were merged", () => {
    expect(classifyMenuRun(obs({ mergedItems: 40, pipelineError: "boom" }))).toEqual({
      outcome: "failed",
      reason: "pipeline_error",
    })
  })

  it("items merged and saved -> succeeded with no reason", () => {
    expect(
      classifyMenuRun(obs({ scrapeAttempts: 2, scrapesWithItems: 1, enrichment: "items", mergedItems: 82 }))
    ).toEqual({ outcome: "succeeded", reason: null })
  })

  it("items merged but the snapshot upsert failed -> failed/save_failed (the data never landed)", () => {
    expect(
      classifyMenuRun(obs({ scrapeAttempts: 1, scrapesWithItems: 1, mergedItems: 30, saveError: "permission denied" }))
    ).toEqual({ outcome: "failed", reason: "save_failed" })
  })

  it("every scrape errored -> failed/fetch_failed, whatever Gemini said (a secondary 'empty' is not trustworthy when the site was never read)", () => {
    for (const enrichment of ["error", "empty", "skipped"] as const) {
      expect(classifyMenuRun(obs({ scrapeAttempts: 2, scrapeErrors: 2, enrichment }))).toEqual({
        outcome: "failed",
        reason: "fetch_failed",
      })
    }
  })

  it("pages fetched but parsed to zero + Gemini errored -> failed/enrichment_failed (the backstop was down, so 'is it really empty' went unanswered)", () => {
    expect(classifyMenuRun(obs({ scrapeAttempts: 2, scrapeErrors: 0, enrichment: "error" }))).toEqual({
      outcome: "failed",
      reason: "enrichment_failed",
    })
  })

  it("pages fetched but parsed to zero + Gemini also found nothing -> empty/zero_items (both channels agree)", () => {
    expect(classifyMenuRun(obs({ scrapeAttempts: 2, scrapeErrors: 0, enrichment: "empty" }))).toEqual({
      outcome: "empty",
      reason: "zero_items",
    })
  })

  it("pages fetched but parsed to zero, Gemini never ran -> empty/parse_empty (page-level evidence only)", () => {
    expect(classifyMenuRun(obs({ scrapeAttempts: 3, scrapeErrors: 1, enrichment: "skipped" }))).toEqual({
      outcome: "empty",
      reason: "parse_empty",
    })
  })

  it("no scrapes ran at all: Gemini error -> failed/enrichment_failed; Gemini empty -> empty/zero_items; nothing ran -> failed/fetch_failed (never a clean 'empty')", () => {
    expect(classifyMenuRun(obs({ enrichment: "error" }))).toEqual({ outcome: "failed", reason: "enrichment_failed" })
    expect(classifyMenuRun(obs({ enrichment: "empty" }))).toEqual({ outcome: "empty", reason: "zero_items" })
    expect(classifyMenuRun(obs())).toEqual({ outcome: "failed", reason: "fetch_failed" })
  })

  it("is total: every combination of channel states yields exactly one verdict, and success is the only reason-less one", () => {
    for (const scrapeAttempts of [0, 2]) {
      for (const scrapeErrors of [0, 1, 2]) {
        if (scrapeErrors > scrapeAttempts) continue
        for (const scrapesWithItems of [0, 1]) {
          if (scrapesWithItems > scrapeAttempts - scrapeErrors) continue
          for (const enrichment of ["items", "empty", "error", "skipped"] as const) {
            for (const mergedItems of [0, 10]) {
              for (const coverageRatio of [null, 0.12, 0.9]) {
                const verdict = classifyMenuRun(obs({ scrapeAttempts, scrapeErrors, scrapesWithItems, enrichment, mergedItems, coverageRatio }))
                expect(["succeeded", "degraded", "empty", "failed"]).toContain(verdict.outcome)
                if (verdict.outcome === "succeeded") expect(verdict.reason).toBeNull()
                else expect(verdict.reason).not.toBeNull()
              }
            }
          }
        }
      }
    }
  })
})

// The failure this whole ticket is about: the run worked, the row saved, and the menu is a
// fraction of itself. Under the old three-outcome taxonomy a 12-item read of a 137-item menu
// recorded as "succeeded", identical to a good run, so the ledger could never show it.
describe("classifyMenuRun: degraded reads (nonempty but badly incomplete)", () => {
  const healthyRun = { scrapeAttempts: 2, scrapesWithItems: 1, enrichment: "items" as const }

  it("items merged and saved, but coverage below the claim floor -> degraded/low_coverage", () => {
    expect(
      classifyMenuRun(obs({ ...healthyRun, mergedItems: 12, coverageRatio: 12 / 98, historicalHighItems: 98 }))
    ).toEqual({ outcome: "degraded", reason: "low_coverage" })
  })

  it("is distinguishable from an empty run: a degraded read still carries its items", () => {
    const degraded = classifyMenuRun(obs({ ...healthyRun, mergedItems: 12, coverageRatio: 0.12 }))
    const empty = classifyMenuRun(obs({ scrapeAttempts: 2, enrichment: "empty", mergedItems: 0 }))
    expect(degraded.outcome).toBe("degraded")
    expect(empty.outcome).toBe("empty")
    expect(degraded.outcome).not.toBe(empty.outcome)
  })

  it("healthy coverage stays 'succeeded'", () => {
    expect(classifyMenuRun(obs({ ...healthyRun, mergedItems: 137, coverageRatio: 1 }))).toEqual({
      outcome: "succeeded",
      reason: null,
    })
    expect(classifyMenuRun(obs({ ...healthyRun, mergedItems: 90, coverageRatio: 0.85 }))).toEqual({
      outcome: "succeeded",
      reason: null,
    })
  })

  it("no coverage verdict stays 'succeeded': absence is unknown, not an accusation", () => {
    // A brand-new location's first reads have no baseline. Calling those degraded would
    // slander every new customer's first week.
    expect(classifyMenuRun(obs({ ...healthyRun, mergedItems: 40, coverageRatio: null }))).toEqual({
      outcome: "succeeded",
      reason: null,
    })
  })

  it("a save failure still outranks a coverage verdict (the data never landed at all)", () => {
    expect(
      classifyMenuRun(obs({ ...healthyRun, mergedItems: 12, coverageRatio: 0.12, saveError: "permission denied" }))
    ).toEqual({ outcome: "failed", reason: "save_failed" })
  })
})

describe("recordMenuIngestEvent", () => {
  beforeEach(() => {
    insertMock.mockClear()
    fromMock.mockClear()
    createAdminSupabaseClientMock.mockClear()
    insertMock.mockResolvedValue({ error: null })
  })

  it("inserts the expected row shape into menu_ingest_events, with the classified verdict", async () => {
    await recordMenuIngestEvent({
      runSource: "content_pipeline",
      target: "competitor",
      locationId: "loc-1",
      competitorId: "comp-1",
      dateKey: "2026-08-12",
      observation: obs({ scrapeAttempts: 2, scrapeErrors: 1, scrapesWithItems: 1, enrichment: "items", mergedItems: 42 }),
      sources: ["firecrawl", "gemini_google_search"],
    })
    expect(fromMock).toHaveBeenCalledWith("menu_ingest_events")
    expect(insertMock).toHaveBeenCalledTimes(1)
    const row = insertMock.mock.calls[0][0]
    expect(row).toMatchObject({
      run_source: "content_pipeline",
      target: "competitor",
      location_id: "loc-1",
      competitor_id: "comp-1",
      date_key: "2026-08-12",
      outcome: "succeeded",
      failure_reason: null,
      items_total: 42,
      sources: ["firecrawl", "gemini_google_search"],
      // No history behind this run, so no verdict. Null, never a stand-in value.
      coverage_ratio: null,
      historical_high_items: null,
    })
    // The raw observation rides along so a reason can be re-derived later.
    expect(row.stages).toMatchObject({ scrapeAttempts: 2, scrapeErrors: 1, enrichment: "items" })
  })

  it("records a degraded run with its coverage columns, so the ledger can rank the bad reads", async () => {
    await recordMenuIngestEvent({
      runSource: "content_pipeline",
      target: "location",
      locationId: "loc-1",
      dateKey: "2026-07-12",
      observation: obs({
        scrapeAttempts: 2,
        scrapesWithItems: 1,
        enrichment: "items",
        mergedItems: 12,
        coverageRatio: 12 / 98,
        historicalHighItems: 98,
      }),
      sources: ["firecrawl"],
    })
    const row = insertMock.mock.calls[0][0]
    expect(row).toMatchObject({
      outcome: "degraded",
      failure_reason: "low_coverage",
      items_total: 12,
      historical_high_items: 98,
    })
    expect(row.coverage_ratio).toBeCloseTo(12 / 98, 5)
  })

  it("defaults missing ids/sources instead of sending undefined, and records failure verdicts", async () => {
    await recordMenuIngestEvent({
      runSource: "competitor_enrich",
      target: "competitor",
      competitorId: "comp-2",
      dateKey: "2026-08-12",
      observation: obs({ scrapeAttempts: 2, scrapeErrors: 2, enrichment: "error" }),
    })
    const row = insertMock.mock.calls[0][0]
    expect(row).toMatchObject({
      location_id: null,
      competitor_id: "comp-2",
      outcome: "failed",
      failure_reason: "fetch_failed",
      items_total: 0,
      sources: [],
    })
  })

  it("never throws when the insert resolves with a DB error (logs a warning instead)", async () => {
    insertMock.mockResolvedValueOnce({ error: { message: "relation menu_ingest_events does not exist" } })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(
      recordMenuIngestEvent({
        runSource: "content_refresh_action",
        target: "location",
        locationId: "loc-1",
        dateKey: "2026-08-12",
        observation: obs(),
      })
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("never throws when the insert call itself throws", async () => {
    insertMock.mockImplementationOnce(async () => {
      throw new Error("network error")
    })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(
      recordMenuIngestEvent({
        runSource: "content_pipeline",
        target: "location",
        locationId: "loc-1",
        dateKey: "2026-08-12",
        observation: obs({ mergedItems: 12 }),
      })
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("never throws when createAdminSupabaseClient itself throws (e.g. missing env)", async () => {
    createAdminSupabaseClientMock.mockImplementationOnce(() => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured")
    })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(
      recordMenuIngestEvent({
        runSource: "competitor_enrich",
        target: "competitor",
        competitorId: "comp-1",
        dateKey: "2026-08-12",
        observation: obs(),
      })
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
