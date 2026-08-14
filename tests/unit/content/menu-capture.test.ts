// The shared capture loop. This is the only place thin-read rejection is enforced, so the
// contract under test is narrow and load-bearing:
//   - each URL is scraped with the expected item count derived from ITS OWN history,
//   - a read that comes back thin is DROPPED, never merged,
//   - a dropped read is still recorded on parseMeta.pages so the next run keeps its history,
//   - the observation counters tell an operator what happened.

import { describe, it, expect, vi, beforeEach } from "vitest"

const { scrapeMenuPageMock } = vi.hoisted(() => ({ scrapeMenuPageMock: vi.fn() }))

vi.mock("@/lib/providers/firecrawl", () => ({ scrapeMenuPage: scrapeMenuPageMock }))

import { captureMenuPages } from "@/lib/content/menu-capture"
import { newMenuObservation } from "@/lib/content/menu-telemetry"

type Read = {
  itemsTotal: number
  thin: boolean
  extractor: "markdown" | "model" | "none"
  attempts?: number
  screenshot?: string | null
}

function read({ itemsTotal, thin, extractor, attempts = 1, screenshot = null }: Read) {
  const items = Array.from({ length: itemsTotal }, (_, i) => ({
    name: `Item ${i + 1}`,
    description: null,
    price: "$10",
    priceValue: 10,
    tags: [],
    itemKind: "entree",
  }))
  return {
    screenshot,
    markdown: "# Menu",
    menu: itemsTotal > 0 ? { currency: "USD", categories: [{ name: "Mains", items }] } : null,
    extractor,
    itemsTotal,
    thin,
    attempts,
  }
}

describe("captureMenuPages", () => {
  beforeEach(() => scrapeMenuPageMock.mockReset())

  it("passes each URL the baseline from its own history, not the merged total", async () => {
    scrapeMenuPageMock.mockResolvedValue(read({ itemsTotal: 60, thin: false, extractor: "markdown" }))
    await captureMenuPages({
      urls: ["https://x.com/dinner", "https://x.com/drink"],
      pageHistory: new Map([
        ["https://x.com/dinner", [60, 63, 9]],
        ["https://x.com/drink", [58, 58]],
      ]),
      obs: newMenuObservation(),
    })
    expect(scrapeMenuPageMock).toHaveBeenNthCalledWith(1, "https://x.com/dinner", { expectedItems: 63 })
    expect(scrapeMenuPageMock).toHaveBeenNthCalledWith(2, "https://x.com/drink", { expectedItems: 58 })
  })

  it("passes null when a URL has no usable history, so nothing is judged blind", async () => {
    scrapeMenuPageMock.mockResolvedValue(read({ itemsTotal: 20, thin: false, extractor: "markdown" }))
    await captureMenuPages({
      urls: ["https://new.com/menu"],
      pageHistory: new Map(),
      obs: newMenuObservation(),
    })
    expect(scrapeMenuPageMock).toHaveBeenCalledWith("https://new.com/menu", { expectedItems: null })
  })

  it("drops a thin read instead of merging it, and says so", async () => {
    const obs = newMenuObservation()
    const warnings: string[] = []
    scrapeMenuPageMock
      .mockResolvedValueOnce(read({ itemsTotal: 60, thin: false, extractor: "markdown" }))
      .mockResolvedValueOnce(read({ itemsTotal: 9, thin: true, extractor: "model", attempts: 2 }))

    const capture = await captureMenuPages({
      urls: ["https://x.com/dinner", "https://x.com/drink"],
      pageHistory: new Map([["https://x.com/drink", [58, 58]]]),
      obs,
      onWarning: (m) => warnings.push(m),
    })

    // Only the good page reaches the merge.
    expect(capture.results).toHaveLength(1)
    expect(capture.results[0].categories[0].items).toHaveLength(60)
    // Both pages are on the record, with the rejection flagged.
    expect(capture.pages).toEqual([
      { url: "https://x.com/dinner", items: 60, extractor: "markdown", thin: false, attempts: 1 },
      { url: "https://x.com/drink", items: 9, extractor: "model", thin: true, attempts: 2 },
    ])
    expect(obs.thinRejected).toBe(1)
    expect(obs.scrapeRetries).toBe(1)
    expect(obs.scrapesWithItems).toBe(1)
    expect(obs.scrapeErrors).toBe(0)
    expect(warnings).toHaveLength(1)
  })

  it("produces nothing when every page is thin, which is what makes the run a recorded failure", async () => {
    const obs = newMenuObservation()
    scrapeMenuPageMock.mockResolvedValue(read({ itemsTotal: 9, thin: true, extractor: "model", attempts: 2 }))

    const capture = await captureMenuPages({
      urls: ["https://x.com/a", "https://x.com/b"],
      pageHistory: new Map([
        ["https://x.com/a", [60, 60]],
        ["https://x.com/b", [58, 58]],
      ]),
      obs,
    })

    expect(capture.results).toHaveLength(0)
    expect(obs.thinRejected).toBe(2)
    expect(obs.scrapesWithItems).toBe(0)
  })

  it("counts a null scrape as an error, not as an empty page", async () => {
    const obs = newMenuObservation()
    scrapeMenuPageMock.mockResolvedValue(null)
    const capture = await captureMenuPages({ urls: ["https://x.com/a"], pageHistory: new Map(), obs })
    expect(obs.scrapeErrors).toBe(1)
    expect(capture.pages).toHaveLength(0)
  })

  it("keeps going when one URL throws", async () => {
    const obs = newMenuObservation()
    const warnings: string[] = []
    scrapeMenuPageMock
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(read({ itemsTotal: 30, thin: false, extractor: "markdown" }))

    const capture = await captureMenuPages({
      urls: ["https://x.com/a", "https://x.com/b"],
      pageHistory: new Map(),
      obs,
      onWarning: (m) => warnings.push(m),
    })

    expect(obs.scrapeErrors).toBe(1)
    expect(capture.results).toHaveLength(1)
    expect(warnings).toEqual(["Could not scrape: https://x.com/a"])
  })

  it("counts model extractions separately so the spend shift is visible", async () => {
    const obs = newMenuObservation()
    scrapeMenuPageMock
      .mockResolvedValueOnce(read({ itemsTotal: 60, thin: false, extractor: "markdown" }))
      .mockResolvedValueOnce(read({ itemsTotal: 40, thin: false, extractor: "model" }))
    await captureMenuPages({
      urls: ["https://x.com/a", "https://x.com/b"],
      pageHistory: new Map(),
      obs,
    })
    expect(obs.modelExtractions).toBe(1)
  })

  it("uploads only the first screenshot it is given", async () => {
    const uploads: string[] = []
    scrapeMenuPageMock
      .mockResolvedValueOnce(read({ itemsTotal: 60, thin: false, extractor: "markdown", screenshot: "shot-a" }))
      .mockResolvedValueOnce(read({ itemsTotal: 40, thin: false, extractor: "markdown", screenshot: "shot-b" }))

    const capture = await captureMenuPages({
      urls: ["https://x.com/a", "https://x.com/b"],
      pageHistory: new Map(),
      obs: newMenuObservation(),
      uploadScreenshot: async (shot) => {
        uploads.push(shot)
        return `stored/${shot}.png`
      },
    })

    expect(uploads).toEqual(["shot-a"])
    expect(capture.screenshotPath).toBe("stored/shot-a.png")
    expect(capture.screenshotSourceUrl).toBe("https://x.com/a")
  })
})
