// Vendor-health failback (2026-06): make a silent DataForSEO 402 outage loud.
// Covers the typed error, the signal round-trip, the per-location coverage read, and the
// fleet detector's table-free transition debounce (alert once on healthy->down).

import { describe, it, expect } from "vitest"
import { DataForSEOError } from "@/lib/providers/dataforseo/client"
import {
  vendorSignalFromError,
  moreSevereVendorSignal,
  readVendorSignal,
  loadCoverageHealth,
  detectDataForSeoHealth,
  type VendorSignal,
} from "@/lib/jobs/vendor-health"
import type { SB } from "@/lib/jobs/queue"

// Minimal thenable Supabase builder: every chain method returns the builder, awaiting yields {data}.
function mockSb(rows: unknown[]): SB {
  const builder: Record<string, unknown> = {}
  for (const m of ["select", "eq", "in", "gte", "order", "limit"]) builder[m] = () => builder
  ;(builder as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve({ data: rows })
  return { from: () => builder } as unknown as SB
}

const HOUR = 3600_000
const NOW = 1_700_000_000_000
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()

describe("DataForSEOError", () => {
  it("flags HTTP 402 as payment required", () => {
    expect(new DataForSEOError("x", 402).isPaymentRequired).toBe(true)
    expect(new DataForSEOError("x", 500).isPaymentRequired).toBe(false)
  })
  it("flags a 402xx task status_code as payment required", () => {
    expect(new DataForSEOError("x", undefined, 40200).isPaymentRequired).toBe(true)
    expect(new DataForSEOError("x", undefined, 40102).isPaymentRequired).toBe(false)
  })
})

describe("vendor signal helpers", () => {
  it("builds a signal from a DataForSEOError and nothing from other errors", () => {
    expect(vendorSignalFromError(new DataForSEOError("x", 402))).toEqual({ name: "dataforseo", status: 402, paymentRequired: true })
    expect(vendorSignalFromError(new Error("generic"))).toBeUndefined()
    expect(vendorSignalFromError(undefined)).toBeUndefined()
  })
  it("keeps the more severe (payment-required) signal", () => {
    const plain: VendorSignal = { name: "dataforseo", status: 500, paymentRequired: false }
    const pay: VendorSignal = { name: "dataforseo", status: 402, paymentRequired: true }
    expect(moreSevereVendorSignal(plain, pay)).toBe(pay)
    expect(moreSevereVendorSignal(pay, plain)).toBe(pay)
    expect(moreSevereVendorSignal(undefined, plain)).toBe(plain)
  })
  it("round-trips through pipeline_runs.signals and rejects junk", () => {
    expect(readVendorSignal({ vendor: { name: "dataforseo", status: 402, paymentRequired: true } })).toEqual({ name: "dataforseo", status: 402, paymentRequired: true })
    expect(readVendorSignal({ completed: 2, failed: 1 })).toBeUndefined()
    expect(readVendorSignal({ vendor: { name: "other" } })).toBeUndefined()
    expect(readVendorSignal(null)).toBeUndefined()
  })
})

describe("loadCoverageHealth (per-pipeline UI read)", () => {
  const down = { unavailable: true, paymentRequired: true }
  const ok = { unavailable: false, paymentRequired: false }

  it("marks ONLY the failing pipeline unavailable (events stays healthy when only visibility is 402)", async () => {
    const sb = mockSb([
      { pipeline: "visibility", outcome: "failed", reason: "DataForSEO error: 402", signals: { vendor: { name: "dataforseo", status: 402, paymentRequired: true } }, started_at: iso(HOUR) },
      { pipeline: "events", outcome: "fresh", reason: null, signals: { completed: 3, failed: 0 }, started_at: iso(2 * HOUR) },
    ])
    expect(await loadCoverageHealth(sb, "loc-1")).toEqual({ events: ok, visibility: down })
  })
  it("reports both healthy when the latest runs are fresh", async () => {
    const sb = mockSb([
      { pipeline: "visibility", outcome: "fresh", reason: null, signals: { completed: 5, failed: 0 }, started_at: iso(HOUR) },
      { pipeline: "events", outcome: "fresh", reason: null, signals: {}, started_at: iso(2 * HOUR) },
    ])
    expect(await loadCoverageHealth(sb, "loc-1")).toEqual({ events: ok, visibility: ok })
  })
  it("a benign partial (no vendor signal, no DataForSEO error) is NOT treated as unavailable", async () => {
    const sb = mockSb([
      { pipeline: "events", outcome: "partial", reason: "one venue had no listings", signals: { completed: 2, failed: 1 }, started_at: iso(HOUR) },
    ])
    expect(await loadCoverageHealth(sb, "loc-1")).toEqual({ events: ok, visibility: ok })
  })
  it("detects a task-level cost-limit code (40203) from the reason when no structured signal exists", async () => {
    // Pre-deploy / non-typed-throw rows have only the reason string — the regex must catch 402xx codes.
    const sb = mockSb([
      { pipeline: "events", outcome: "failed", reason: "Fetching local events: DataForSEO events error: 40203 The cost limit has been exceeded.", signals: {}, started_at: iso(HOUR) },
    ])
    expect(await loadCoverageHealth(sb, "loc-1")).toEqual({ events: down, visibility: ok })
  })
})

describe("detectDataForSeoHealth (fleet detector + transition debounce)", () => {
  const downNow = (loc: string) => ({ location_id: loc, pipeline: "visibility", outcome: "failed", reason: "DataForSEO error: 402", signals: { vendor: { name: "dataforseo", status: 402, paymentRequired: true } }, started_at: iso(HOUR) })
  const downOld = (loc: string) => ({ location_id: loc, pipeline: "visibility", outcome: "failed", reason: "DataForSEO error: 402", signals: { vendor: { name: "dataforseo", status: 402, paymentRequired: true } }, started_at: iso(30 * HOUR) })
  const freshNow = (loc: string) => ({ location_id: loc, pipeline: "visibility", outcome: "fresh", reason: null, signals: { completed: 5, failed: 0 }, started_at: iso(HOUR) })
  const freshOld = (loc: string) => ({ location_id: loc, pipeline: "visibility", outcome: "fresh", reason: null, signals: {}, started_at: iso(30 * HOUR) })

  it("newly_down: down now (>=50%) but healthy 24h ago → fires the alert", async () => {
    const sb = mockSb([downNow("a"), downNow("b"), downNow("c"), freshOld("a"), freshOld("b"), freshOld("c")])
    const v = await detectDataForSeoHealth(sb, { nowMs: NOW })
    expect(v.status).toBe("newly_down")
    expect(v.down).toBe(true)
    expect(v.fractionDown).toBe(1)
    expect(v.paymentRequired).toBe(true)
    expect(v.downLocations).toBe(3)
  })

  it("still_down: down now AND down 24h ago → no re-alert", async () => {
    const sb = mockSb([downNow("a"), downNow("b"), downOld("a"), downOld("b")])
    const v = await detectDataForSeoHealth(sb, { nowMs: NOW })
    expect(v.status).toBe("still_down")
    expect(v.down).toBe(true)
  })

  it("recovered: healthy now but down 24h ago → recovery note", async () => {
    const sb = mockSb([freshNow("a"), freshNow("b"), downOld("a"), downOld("b")])
    const v = await detectDataForSeoHealth(sb, { nowMs: NOW })
    expect(v.status).toBe("recovered")
    expect(v.down).toBe(false)
  })

  it("healthy: all good → no alert", async () => {
    const sb = mockSb([freshNow("a"), freshNow("b")])
    const v = await detectDataForSeoHealth(sb, { nowMs: NOW })
    expect(v.status).toBe("healthy")
    expect(v.down).toBe(false)
  })

  it("below threshold: only 1 of 3 down → not down", async () => {
    const sb = mockSb([downNow("a"), freshNow("b"), freshNow("c"), freshOld("a"), freshOld("b"), freshOld("c")])
    const v = await detectDataForSeoHealth(sb, { nowMs: NOW })
    expect(v.down).toBe(false)
    expect(v.fractionDown).toBeCloseTo(1 / 3)
    expect(v.status).toBe("healthy")
  })
})
