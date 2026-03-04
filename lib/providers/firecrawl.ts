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
  screenshot: string | null // URL string from Firecrawl
  metadata?: Record<string, unknown>
}

export type MenuExtractResult = {
  screenshot: string | null
  menu: ExtractedMenu | null
  markdown: string | null
}

export type ExtractedMenu = {
  currency: string | null
  categories: Array<{
    name: string
    items: Array<{
      name: string
      description: string | null
      price: string | null
      priceValue: number | null
      tags: string[]
    }>
  }>
}

export type SiteFeatureExtractResult = {
  screenshot: string | null
  markdown: string | null
  features: ExtractedSiteFeatures | null
}

export type ExtractedSiteFeatures = {
  hasReservations: boolean
  hasOnlineOrdering: boolean
  hasPrivateDining: boolean
  hasCatering: boolean
  hasHappyHour: boolean
  deliveryPlatforms: string[]
  hours: string | null
}

// ---------------------------------------------------------------------------
// JSON Schema for menu extraction
// ---------------------------------------------------------------------------

const MENU_SCHEMA = {
  type: "object",
  properties: {
    currency: { type: "string", description: "Currency code (e.g. USD, EUR)" },
    categories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Category name (e.g. Appetizers, Entrees, Drinks, Wine)" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Item name, cleaned up without markdown formatting" },
                description: { type: ["string", "null"], description: "Brief item description" },
                price: { type: ["string", "null"], description: "Price as shown (e.g. '$12.99')" },
                priceValue: { type: ["number", "null"], description: "Numeric price value" },
                tags: {
                  type: "array",
                  items: { type: "string" },
                  description: "Dietary tags: vegan, vegetarian, gluten-free, spicy, organic, new, popular",
                },
              },
              required: ["name"],
            },
          },
        },
        required: ["name", "items"],
      },
    },
  },
  required: ["categories"],
}

const MENU_EXTRACT_PROMPT = `Extract the COMPLETE restaurant menu from this page. 
- Extract EVERY menu item with its price.
- If an item has multiple price options (e.g. glass/bottle, small/large, lunch/dinner), create one entry per variant with the variant in the name (e.g. "Pinot Noir (Glass)", "Pinot Noir (Bottle)").
- Group items into natural categories (Appetizers, Entrees, Desserts, Wine, Cocktails, etc.).
- Include dietary tags where detectable.
- If no menu items are found, return empty categories array.`

// ---------------------------------------------------------------------------
// JSON Schema for site features extraction
// ---------------------------------------------------------------------------

const SITE_FEATURES_SCHEMA = {
  type: "object",
  properties: {
    hasReservations: { type: "boolean", description: "Website offers online reservations" },
    hasOnlineOrdering: { type: "boolean", description: "Website offers online ordering" },
    hasPrivateDining: { type: "boolean", description: "Private dining or event space mentioned" },
    hasCatering: { type: "boolean", description: "Catering services mentioned" },
    hasHappyHour: { type: "boolean", description: "Happy hour deals mentioned" },
    deliveryPlatforms: {
      type: "array",
      items: { type: "string" },
      description: "Delivery platforms detected (e.g. doordash, ubereats, grubhub, postmates)",
    },
    hours: { type: ["string", "null"], description: "Business hours if found" },
  },
  required: ["hasReservations", "hasOnlineOrdering", "hasPrivateDining", "hasCatering", "hasHappyHour", "deliveryPlatforms"],
}

const SITE_FEATURES_PROMPT = `Extract website features and capabilities from this restaurant/business website. 
Identify what services and features are offered (reservations, online ordering, private dining, catering, happy hour, delivery platforms).`

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
    const markdown = typeof data.markdown === "string" ? data.markdown : null
    const screenshot = typeof data.screenshot === "string" ? data.screenshot : null

    console.log(`[Firecrawl] Page scraped: ${url}, markdown: ${markdown?.length ?? 0} chars, screenshot: ${screenshot ? "yes" : "no"}`)

    return {
      markdown,
      links: Array.isArray(data.links) ? (data.links as string[]) : [],
      screenshot,
      metadata: typeof data.metadata === "object" ? (data.metadata as Record<string, unknown>) : undefined,
    }
  } catch (error) {
    console.warn("Firecrawl scrape error:", error)
    return null
  }
}

// ---------------------------------------------------------------------------
// scrapeMenuPage – scrape + extract structured menu via Firecrawl JSON mode
// Uses Firecrawl's built-in LLM extraction (no need for external Gemini call)
// ---------------------------------------------------------------------------

export async function scrapeMenuPage(url: string): Promise<MenuExtractResult | null> {
  const client = getClient()

  const baseOpts: Record<string, unknown> = {
    formats: [
      "markdown",
      { type: "screenshot", fullPage: true },
      {
        type: "json",
        schema: MENU_SCHEMA,
        prompt: MENU_EXTRACT_PROMPT,
      },
    ],
    onlyMainContent: false,
    timeout: 90000,
  }

  const actionsPayload = [
    { type: "wait", milliseconds: 2000 },
    {
      type: "executeJavascript",
      script: [
        'document.querySelectorAll(',
        '  \'[role="tab"], .tab, [data-tab], .nav-link, .menu-tab, \'  +',
        '  \'.tab-link, .tabs a, .tabs button, .tab-header, \'  +',
        '  \'[data-toggle="tab"], [data-bs-toggle="tab"]\'',
        ').forEach(function(el) { try { el.click(); } catch(e) {} });',
        'document.querySelectorAll(',
        '  \'[style*="display: none"], [style*="display:none"], \'  +',
        '  \'.hidden, [hidden], .tab-pane, .accordion-body, \'  +',
        '  \'.collapse:not(.show), .tab-content > div\'',
        ').forEach(function(el) {',
        '  el.style.display = "block";',
        '  el.style.visibility = "visible";',
        '  el.style.opacity = "1";',
        '  el.style.height = "auto";',
        '  el.classList.remove("hidden");',
        '  el.removeAttribute("hidden");',
        '});',
      ].join('\n'),
    },
    { type: "scroll", direction: "down" as const },
    { type: "scroll", direction: "down" as const },
    { type: "scroll", direction: "down" as const },
    { type: "wait", milliseconds: 1500 },
  ]

  // Try with actions first (reveals hidden tabs/accordions), fall back to plain scrape
  let result: Record<string, unknown> | null = null
  try {
    result = await client.scrape(url, { ...baseOpts, actions: actionsPayload } as Record<string, unknown>) as Record<string, unknown> | null
  } catch (err) {
    const isActionsUnsupported =
      err instanceof Error &&
      (err.message.includes("SCRAPE_ACTIONS_NOT_SUPPORTED") ||
       err.message.includes("Actions are not supported"))
    if (isActionsUnsupported) {
      console.log("[Firecrawl] Actions not supported, retrying without actions:", url)
      try {
        result = await client.scrape(url, baseOpts) as Record<string, unknown> | null
      } catch (retryErr) {
        console.warn("Firecrawl scrapeMenuPage retry error:", retryErr)
        return null
      }
    } else {
      console.warn("Firecrawl scrapeMenuPage error:", err)
      return null
    }
  }

  if (!result) return null

  const screenshot = typeof result.screenshot === "string" ? result.screenshot : null
  const markdown = typeof result.markdown === "string" ? result.markdown : null
  const jsonData = result.json as ExtractedMenu | null | undefined

  const totalItems = jsonData?.categories?.reduce((s, c) => s + (c.items?.length ?? 0), 0) ?? 0
  console.log(`[Firecrawl] Menu extracted: ${url}, ${totalItems} items in ${jsonData?.categories?.length ?? 0} categories, screenshot: ${screenshot ? "yes" : "no"}`)

  return {
    screenshot,
    markdown,
    menu: jsonData ?? null,
  }
}

// ---------------------------------------------------------------------------
// discoverAllMenuUrls – run mapSite with multiple search terms, deduplicate
// ---------------------------------------------------------------------------

const MENU_SEARCH_TERMS = ["menu", "food", "drinks", "brunch", "lunch", "dinner"]

const MENU_URL_PATTERN = /menu|food|drink|beverage|cocktail|wine|beer|brunch|lunch|dinner|appetizer|entree|dessert|order/i

export async function discoverAllMenuUrls(
  websiteUrl: string,
  maxUrls = 4
): Promise<string[]> {
  const found = new Set<string>()

  for (const term of MENU_SEARCH_TERMS) {
    try {
      const mapResult = await mapSite(websiteUrl, term, 5)
      if (mapResult?.links?.length) {
        for (const link of mapResult.links) {
          if (MENU_URL_PATTERN.test(link.url) || MENU_URL_PATTERN.test(link.title ?? "")) {
            found.add(link.url)
          }
        }
      }
    } catch {
      // Ignore individual map failures
    }
    // Stop early if we have enough
    if (found.size >= maxUrls) break
  }

  // Deduplicate by normalizing trailing slashes and fragments
  const normalized = new Map<string, string>()
  for (const url of found) {
    try {
      const u = new URL(url)
      const key = `${u.origin}${u.pathname.replace(/\/+$/, "")}`.toLowerCase()
      if (!normalized.has(key)) {
        normalized.set(key, url)
      }
    } catch {
      normalized.set(url, url)
    }
  }

  const urls = Array.from(normalized.values()).slice(0, maxUrls)
  console.log(`[Firecrawl] Discovered ${urls.length} menu URLs for ${websiteUrl}:`, urls)
  return urls
}

// ---------------------------------------------------------------------------
// detectPosOrderingUrls – extract external POS/ordering platform links
// from homepage markdown or raw HTML
// ---------------------------------------------------------------------------

const POS_PATTERNS: RegExp[] = [
  /https?:\/\/order\.toasttab\.com\/[^\s)"',>]+/gi,
  /https?:\/\/ordering\.chownow\.com\/[^\s)"',>]+/gi,
  /https?:\/\/direct\.chownow\.com\/[^\s)"',>]+/gi,
  /https?:\/\/[^\s)"',>]*squareup\.com\/[^\s)"',>]*order[^\s)"',>]*/gi,
  /https?:\/\/[^\s)"',>]*square\.site\/[^\s)"',>]*/gi,
  /https?:\/\/[^\s)"',>]*ezcater\.com\/[^\s)"',>]+/gi,
  /https?:\/\/[^\s)"',>]*doordash\.com\/store\/[^\s)"',>]+/gi,
  /https?:\/\/[^\s)"',>]*ubereats\.com\/store\/[^\s)"',>]+/gi,
  /https?:\/\/[^\s)"',>]*grubhub\.com\/restaurant\/[^\s)"',>]+/gi,
  /https?:\/\/[^\s)"',>]*clover\.com\/[^\s)"',>]+/gi,
  /https?:\/\/[^\s)"',>]*olo\.com\/[^\s)"',>]+/gi,
  /https?:\/\/[^\s)"',>]*getbento\.com\/[^\s)"',>]+/gi,
]

export function detectPosOrderingUrls(markdown: string | null): string[] {
  if (!markdown) return []
  const found = new Set<string>()
  for (const pattern of POS_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(markdown)) !== null) {
      // Clean trailing punctuation
      const url = match[0].replace(/[)"',>.\s]+$/, "")
      found.add(url)
    }
  }
  const urls = Array.from(found)
  if (urls.length > 0) {
    console.log(`[Firecrawl] Detected POS ordering URLs:`, urls)
  }
  return urls
}

// ---------------------------------------------------------------------------
// scrapeHomepage – scrape + extract site features via Firecrawl JSON mode
// ---------------------------------------------------------------------------

export async function scrapeHomepage(url: string): Promise<SiteFeatureExtractResult | null> {
  try {
    const client = getClient()
    const result = await client.scrape(url, {
      formats: [
        "markdown",
        { type: "screenshot", fullPage: true },
        {
          type: "json",
          schema: SITE_FEATURES_SCHEMA,
          prompt: SITE_FEATURES_PROMPT,
        },
      ],
      onlyMainContent: true,
      timeout: 45000,
    } as Record<string, unknown>)

    if (!result) return null

    const data = result as Record<string, unknown>
    const screenshot = typeof data.screenshot === "string" ? data.screenshot : null
    const markdown = typeof data.markdown === "string" ? data.markdown : null
    const jsonData = data.json as ExtractedSiteFeatures | null | undefined

    console.log(`[Firecrawl] Homepage extracted: ${url}, features: ${JSON.stringify(jsonData ?? {})}, screenshot: ${screenshot ? "yes" : "no"}`)

    return {
      screenshot,
      markdown,
      features: jsonData ?? null,
    }
  } catch (error) {
    console.warn("Firecrawl scrapeHomepage error:", error)
    return null
  }
}
