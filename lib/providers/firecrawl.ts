// ---------------------------------------------------------------------------
// Firecrawl client wrapper – website scraping, menu discovery, screenshots
// ---------------------------------------------------------------------------

import Firecrawl from "@mendable/firecrawl-js"

function getClient() {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY is not configured")
  }
  return new Firecrawl({ apiKey })
}

// ---------------------------------------------------------------------------
// Types returned by the wrapper
// ---------------------------------------------------------------------------

export type MapResult = {
  links: Array<{ url: string; title?: string; description?: string }>
}

export type ScrapeResult = {
  markdown: string | null
  links: string[]
  screenshot: string | null // base64 data URL or null
  metadata?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// mapSite – find relevant pages on a website (e.g. menu, reservations)
// ---------------------------------------------------------------------------

export async function mapSite(
  websiteUrl: string,
  searchTerm: string,
  limit = 10
): Promise<MapResult | null> {
  try {
    const client = getClient()
    const result = await client.map(websiteUrl, {
      search: searchTerm,
      limit,
    })

    if (!result || !result.links) {
      return null
    }

    // The SDK can return links as strings or objects depending on version
    const links = (result.links as unknown[]).map((link) => {
      if (typeof link === "string") {
        return { url: link }
      }
      const obj = link as Record<string, unknown>
      return {
        url: String(obj.url ?? ""),
        title: obj.title ? String(obj.title) : undefined,
        description: obj.description ? String(obj.description) : undefined,
      }
    })

    return { links }
  } catch (error) {
    console.warn("Firecrawl map error:", error)
    return null
  }
}

// ---------------------------------------------------------------------------
// scrapePage – scrape a single URL for markdown + screenshot
// ---------------------------------------------------------------------------

export async function scrapePage(
  url: string,
  options?: { fullPageScreenshot?: boolean; timeout?: number }
): Promise<ScrapeResult | null> {
  try {
    const client = getClient()
    const result = await client.scrape(url, {
      formats: [
        "markdown",
        "links",
        { type: "screenshot", fullPage: options?.fullPageScreenshot ?? true },
      ],
      onlyMainContent: true,
      timeout: options?.timeout ?? 30000,
    })

    if (!result) return null

    const data = result as Record<string, unknown>
    return {
      markdown: typeof data.markdown === "string" ? data.markdown : null,
      links: Array.isArray(data.links) ? (data.links as string[]) : [],
      screenshot: typeof data.screenshot === "string" ? data.screenshot : null,
      metadata: typeof data.metadata === "object" ? (data.metadata as Record<string, unknown>) : undefined,
    }
  } catch (error) {
    console.warn("Firecrawl scrape error:", error)
    return null
  }
}

// ---------------------------------------------------------------------------
// scrapeMenuPage – same as scrapePage but with PDF parser enabled
// ---------------------------------------------------------------------------

export async function scrapeMenuPage(url: string): Promise<ScrapeResult | null> {
  try {
    const client = getClient()
    const result = await client.scrape(url, {
      formats: [
        "markdown",
        "links",
        { type: "screenshot", fullPage: true },
      ],
      onlyMainContent: true,
      timeout: 30000,
      parsers: ["pdf"],
    } as Record<string, unknown>)

    if (!result) return null

    const data = result as Record<string, unknown>
    return {
      markdown: typeof data.markdown === "string" ? data.markdown : null,
      links: Array.isArray(data.links) ? (data.links as string[]) : [],
      screenshot: typeof data.screenshot === "string" ? data.screenshot : null,
      metadata: typeof data.metadata === "object" ? (data.metadata as Record<string, unknown>) : undefined,
    }
  } catch (error) {
    console.warn("Firecrawl scrapeMenuPage error:", error)
    return null
  }
}
