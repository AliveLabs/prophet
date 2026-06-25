// Vendor-health propagation in the visibility pipeline (2026-06-20): a DataForSEO payment/credit
// outage must PROPAGATE out of the per-call catch blocks so the worker stamps signals.vendor,
// while a non-payment failure still soft-degrades. Tested via the ads_search step — it hits no
// Supabase before the DataForSEO call, so the throw path needs no DB mock. "top" tier enables ads.

import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/providers/dataforseo/ads-search", () => ({ fetchAdsSearch: vi.fn() }))

import { buildVisibilitySteps } from "@/lib/jobs/pipelines/visibility"
import { fetchAdsSearch } from "@/lib/providers/dataforseo/ads-search"
import { DataForSEOError } from "@/lib/providers/dataforseo/client"
import { isVendorOutageRun } from "@/lib/jobs/vendor-health"

const adsStep = () => {
  const step = buildVisibilitySteps().find((s) => s.name === "ads_search")
  if (!step) throw new Error("ads_search step not found")
  return step
}

function ctx() {
  return {
    supabase: {} as never,
    locationId: "loc-1",
    dateKey: "2026-06-20",
    tier: "top", // seoAdsEnabled: true, so the step runs the loop
    allDomains: ["example.com"],
    competitors: [],
    state: { serpEntries: [], adCreatives: [], intersectionRows: [], warnings: [] },
  } as unknown as Parameters<ReturnType<typeof adsStep>["run"]>[0]
}

/** Run the step; return its resolved value, or the rejection reason if it threw. */
const outcome = (mockImpl: () => Promise<never>) => {
  vi.mocked(fetchAdsSearch).mockImplementation(mockImpl)
  return adsStep().run(ctx()).then((v) => v as unknown).catch((e) => e as unknown)
}

describe("visibility pipeline — DataForSEO vendor-health propagation", () => {
  it("re-throws a payment/credit outage (HTTP 402) so the worker can stamp vendor health", async () => {
    const r = await outcome(async () => { throw new DataForSEOError("DataForSEO error: 402", 402) })
    expect(r).toBeInstanceOf(DataForSEOError)
  })

  it("re-throws a task-level credit code (40203 cost limit) too", async () => {
    const r = await outcome(async () => { throw new DataForSEOError("cost limit exceeded", undefined, 40203) })
    expect(r).toBeInstanceOf(DataForSEOError)
  })

  it("soft-degrades a non-payment error (continues, no throw)", async () => {
    const r = await outcome(async () => { throw new Error("transient blip") })
    expect(r).toMatchObject({ adCreatives: 0 })
  })

  it("soft-degrades a non-payment DataForSEOError (e.g. a 500) — only payment outages propagate", async () => {
    const r = await outcome(async () => { throw new DataForSEOError("DataForSEO error: 500", 500) })
    expect(r).toMatchObject({ adCreatives: 0 })
  })
})

// The FLEET-ALERT classifier (2026-06-25): the daily watchdog was firing "degraded" off benign partial
// events runs (DataForSEO 40102 "no results" / 40501 "invalid field" on one query, no payment issue).
// isVendorOutageRun must count ONLY genuine outages — payment/credits or a fully-failed run.
describe("isVendorOutageRun — fleet-alert sensitivity (only genuine outages count)", () => {
  const sig = (paymentRequired: boolean, status = 40102) => ({ vendor: { name: "dataforseo", status, paymentRequired } })

  it("does NOT count a PARTIAL run with a benign non-payment vendor hiccup (the daily false alarm)", () => {
    expect(isVendorOutageRun("partial", "DataForSEO events error: 40102", sig(false, 40102))).toBe(false)
    expect(isVendorOutageRun("partial", "DataForSEO events error: 40501", sig(false, 40501))).toBe(false)
  })
  it("DOES count a payment/credit outage (the actionable refill case) even when partial", () => {
    expect(isVendorOutageRun("partial", "out of credits", sig(true, 40200))).toBe(true)
  })
  it("DOES count a fully FAILED vendor run (got no data)", () => {
    expect(isVendorOutageRun("failed", "DataForSEO error: 500", { vendor: { name: "dataforseo", status: 500, paymentRequired: false } })).toBe(true)
  })
  it("does NOT count a non-vendor run", () => {
    expect(isVendorOutageRun("failed", "some unrelated timeout", null)).toBe(false)
  })
})
