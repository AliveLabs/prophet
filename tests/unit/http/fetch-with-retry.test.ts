// ENG-H1/H2: shared provider HTTP resilience — per-attempt timeout + retry-on-transient backoff.

import { describe, it, expect, vi, afterEach } from "vitest"
import { fetchWithRetry, FetchTimeoutError } from "@/lib/http/fetch-with-retry"

const res = (status: number) => new Response(status === 204 ? null : "body", { status })
const fast = { baseBackoffMs: 1, label: "test" } // instant backoff for tests

afterEach(() => vi.unstubAllGlobals())

describe("fetchWithRetry", () => {
  it("returns the response on first success (no retry)", async () => {
    const f = vi.fn().mockResolvedValue(res(200))
    vi.stubGlobal("fetch", f)
    const r = await fetchWithRetry("https://x", {}, fast)
    expect(r.status).toBe(200)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it("retries a transient 503 then succeeds", async () => {
    const f = vi.fn().mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(200))
    vi.stubGlobal("fetch", f)
    const r = await fetchWithRetry("https://x", {}, fast)
    expect(r.status).toBe(200)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it("returns the last non-OK response after exhausting retries (does not throw)", async () => {
    const f = vi.fn().mockResolvedValue(res(503))
    vi.stubGlobal("fetch", f)
    const r = await fetchWithRetry("https://x", {}, { ...fast, retries: 2 })
    expect(r.status).toBe(503)
    expect(f).toHaveBeenCalledTimes(3) // 1 + 2 retries
  })

  it("does NOT retry a non-retryable status (402)", async () => {
    const f = vi.fn().mockResolvedValue(res(402))
    vi.stubGlobal("fetch", f)
    const r = await fetchWithRetry("https://x", {}, fast)
    expect(r.status).toBe(402)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it("honors a custom shouldRetryResponse (DataForSEO: retry 503, never 402)", async () => {
    const shouldRetryResponse = (resp: Response) => resp.status === 503
    const f1 = vi.fn().mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(200))
    vi.stubGlobal("fetch", f1)
    expect((await fetchWithRetry("https://x", {}, { ...fast, shouldRetryResponse })).status).toBe(200)
    expect(f1).toHaveBeenCalledTimes(2)

    const f2 = vi.fn().mockResolvedValue(res(402))
    vi.stubGlobal("fetch", f2)
    expect((await fetchWithRetry("https://x", {}, { ...fast, shouldRetryResponse })).status).toBe(402)
    expect(f2).toHaveBeenCalledTimes(1) // 402 not retried
  })

  it("retries:0 disables retries (timeout-only for non-idempotent POSTs)", async () => {
    const f = vi.fn().mockResolvedValue(res(503))
    vi.stubGlobal("fetch", f)
    const r = await fetchWithRetry("https://x", {}, { ...fast, retries: 0 })
    expect(r.status).toBe(503)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it("retries a network error then succeeds", async () => {
    const f = vi.fn().mockRejectedValueOnce(new Error("ECONNRESET")).mockResolvedValueOnce(res(200))
    vi.stubGlobal("fetch", f)
    expect((await fetchWithRetry("https://x", {}, fast)).status).toBe(200)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it("throws the network error after exhausting retries", async () => {
    const f = vi.fn().mockRejectedValue(new Error("ECONNRESET"))
    vi.stubGlobal("fetch", f)
    await expect(fetchWithRetry("https://x", {}, { ...fast, retries: 1 })).rejects.toThrow("ECONNRESET")
    expect(f).toHaveBeenCalledTimes(2)
  })

  it("aborts a hung request as a FetchTimeoutError and does NOT retry it", async () => {
    const f = vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => {
        ;(init.signal as AbortSignal).addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        )
      }),
    )
    vi.stubGlobal("fetch", f)
    await expect(fetchWithRetry("https://x", {}, { ...fast, timeoutMs: 20 })).rejects.toBeInstanceOf(FetchTimeoutError)
    expect(f).toHaveBeenCalledTimes(1) // a hang is not retried
  })
})
