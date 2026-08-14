// ---------------------------------------------------------------------------
// Firecrawl client wrapper – website scraping, menu discovery, screenshots
// ---------------------------------------------------------------------------

import Firecrawl from "@mendable/firecrawl-js"
import {
  parseMenuMarkdown,
  priceSignalCount,
  MIN_PRICE_SIGNALS_FOR_MODEL,
} from "@/lib/content/menu-markdown"
import { THIN_READ_RATIO } from "@/lib/content/menu-thin-read"
import type { MenuExtractor } from "@/lib/content/types"

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
  /** Which extractor produced `menu`. "none" means the page had no readable menu. */
  extractor: MenuExtractor
  itemsTotal: number
  /** True when this read is implausibly small versus the caller's expectation for this URL. */
  thin: boolean
  /** Page fetches spent on this URL (2 = a thin first read was re-read). */
  attempts: number
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
      itemKind: string | null
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
                itemKind: {
                  type: ["string", "null"],
                  enum: ["combo_meal", "entree", "side", "drink", "dessert", "condiment", "family_pack", "other", null],
                  description:
                    "What KIND of item this is, so prices are compared like-to-like: 'combo_meal' (a bundled meal: entree+side+drink, 'combo', 'meal', value meal), 'entree' (a standalone main: sandwich, plate, bowl, pizza, entree salad), 'side' (fries, slaw, chips, side salad), 'drink' (soda, tea, coffee, shake, bottled), 'dessert' (cookie, pie slice, sundae), 'condiment' (sauce/dip/dressing sold alone), 'family_pack' (a multi-serving catering/party pack, platter, or bundle that feeds several people), or 'other'.",
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
- Classify each item's itemKind so meal prices can be compared like-to-like: combo_meal (a bundled meal: entree+side+drink, "combo", "meal", value meal), entree (a standalone main dish), side, drink, dessert, condiment (a sauce/dip/dressing sold on its own), family_pack (a multi-serving catering/party pack, platter, or bundle feeding several people), or other. Base it on what the item IS, not the menu section heading. Use null only when genuinely unclear.
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
// scrapeMenuPage – deterministic-first menu capture
//
// The page's markdown is fetched and parsed DETERMINISTICALLY (lib/content/menu-markdown.ts).
// Firecrawl's LLM JSON mode is the fallback for pages the parser cannot read, not the
// default for pages it reads perfectly. Measured 2026-08-14 on the live sites:
//
//   sugarbacon.com/dinner-menu   model 60 / 60 / 60   deterministic 60 / 60 / 60
//   sugarbacon.com/drink-menu    model 58 / 58 / 58   deterministic 58 / 58 / 58
//   fogharbor.com/menu           model 69 / 80 / 79   deterministic 200 / 200 / 200
//   bushschicken.com/menu        model  8 /  0 /  9   deterministic   0 /   0 /   0
//
// The markdown behind each of those was byte-identical across runs, so every one of the
// model's swings was extractor nondeterminism, not page change. Two of those rows matter
// beyond the variance: on fogharbor the model silently dropped whole categories (its 69-item
// run lost all of "Happy Hour Food"), and on bushschicken — whose menu is a JPEG, with zero
// prices anywhere in the page text — the model INVENTED priced items ("Fried Chicken Meal
// $8.99") on two runs out of three, and echoed the schema's own example category names back
// as empty categories on the third. The price-signal gate below is what stops us paying a
// model to hallucinate a menu off a page that has none.
//
// Latency, same measurements: markdown-only 5-20s per page, JSON mode 55-75s.
// ---------------------------------------------------------------------------

/**
 * Reveal tabs and accordions before capture. Kept as-is from the JSON-mode implementation:
 * it is a no-op on the sites measured above (their markdown is identical with and without
 * it) but it is the only thing standing between us and tab-hidden menus elsewhere, and
 * there is no evidence to justify removing it.
 */
const REVEAL_SCRIPT = [
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
].join("\n")

function renderActions(hardened: boolean) {
  const scrolls = hardened ? 8 : 3
  return [
    { type: "wait", milliseconds: hardened ? 4000 : 2000 },
    { type: "executeJavascript", script: REVEAL_SCRIPT },
    ...Array.from({ length: scrolls }, () => ({ type: "scroll", direction: "down" as const })),
    { type: "wait", milliseconds: hardened ? 4000 : 1500 },
  ]
}

/** Scrape once, retrying without actions on the one error Firecrawl raises for them. */
async function scrapeWithActions(
  url: string,
  baseOpts: Record<string, unknown>,
  hardened: boolean
): Promise<Record<string, unknown> | null> {
  const client = getClient()
  try {
    return (await client.scrape(url, {
      ...baseOpts,
      actions: renderActions(hardened),
    } as Record<string, unknown>)) as Record<string, unknown> | null
  } catch (err) {
    const actionsUnsupported =
      err instanceof Error &&
      (err.message.includes("SCRAPE_ACTIONS_NOT_SUPPORTED") ||
        err.message.includes("Actions are not supported"))
    if (!actionsUnsupported) {
      console.warn("Firecrawl scrapeMenuPage error:", err)
      return null
    }
    console.log("[Firecrawl] Actions not supported, retrying without actions:", url)
    try {
      return (await client.scrape(url, baseOpts)) as Record<string, unknown> | null
    } catch (retryErr) {
      console.warn("Firecrawl scrapeMenuPage retry error:", retryErr)
      return null
    }
  }
}

function countItems(menu: ExtractedMenu | null | undefined): number {
  return menu?.categories?.reduce((sum, c) => sum + (c.items?.length ?? 0), 0) ?? 0
}

type PageRead = {
  screenshot: string | null
  markdown: string | null
  menu: ExtractedMenu | null
  itemsTotal: number
  extractor: MenuExtractor
}

/** One full read of a page: markdown, deterministic parse, and the model only if needed. */
async function readMenuPage(
  url: string,
  opts: { hardened: boolean; wantScreenshot: boolean }
): Promise<PageRead | null> {
  const formats: unknown[] = ["markdown"]
  if (opts.wantScreenshot) formats.push({ type: "screenshot", fullPage: true })

  const page = await scrapeWithActions(
    url,
    {
      formats,
      onlyMainContent: false,
      timeout: opts.hardened ? 120000 : 90000,
      // A hardened re-read must not be served the same cached render that came back thin.
      ...(opts.hardened ? { maxAge: 0, waitFor: 5000 } : {}),
    },
    opts.hardened
  )
  if (!page) return null

  const screenshot = typeof page.screenshot === "string" ? page.screenshot : null
  const markdown = typeof page.markdown === "string" ? page.markdown : null
  const parsed = parseMenuMarkdown(markdown)

  if (parsed.credible && parsed.menu) {
    console.log(`[Firecrawl] Menu parsed deterministically: ${url}, ${parsed.itemsTotal} items in ${parsed.categoriesTotal} categories`)
    return { screenshot, markdown, menu: parsed.menu, itemsTotal: parsed.itemsTotal, extractor: "markdown" }
  }

  const signals = markdown ? priceSignalCount(markdown) : 0
  if (signals < MIN_PRICE_SIGNALS_FOR_MODEL) {
    // Not enough priced text on the page for a menu to exist. Paying a model to look at it
    // is how invented items get into the product.
    console.log(`[Firecrawl] No menu on page (${signals} price signals), skipping model extraction: ${url}`)
    const fallback = parsed.usable && parsed.menu ? parsed.menu : null
    return {
      screenshot,
      markdown,
      menu: fallback,
      itemsTotal: fallback ? parsed.itemsTotal : 0,
      extractor: fallback ? "markdown" : "none",
    }
  }

  const modelMenu = await extractMenuWithModel(url, opts.hardened)
  const modelItems = countItems(modelMenu)
  if (modelMenu && modelItems > parsed.itemsTotal) {
    console.log(`[Firecrawl] Menu extracted by model: ${url}, ${modelItems} items (deterministic parse: ${parsed.itemsTotal}; ${parsed.reason})`)
    return { screenshot, markdown, menu: modelMenu, itemsTotal: modelItems, extractor: "model" }
  }

  const fallback = parsed.usable && parsed.menu ? parsed.menu : null
  return {
    screenshot,
    markdown,
    menu: fallback,
    itemsTotal: fallback ? parsed.itemsTotal : 0,
    extractor: fallback ? "markdown" : "none",
  }
}

/** Firecrawl JSON mode. Fallback path only; no screenshot, no markdown, minimum surface. */
async function extractMenuWithModel(url: string, hardened: boolean): Promise<ExtractedMenu | null> {
  const page = await scrapeWithActions(
    url,
    {
      formats: [{ type: "json", schema: MENU_SCHEMA, prompt: MENU_EXTRACT_PROMPT }],
      onlyMainContent: false,
      timeout: hardened ? 120000 : 90000,
      ...(hardened ? { maxAge: 0, waitFor: 5000 } : {}),
    },
    hardened
  )
  if (!page) return null
  const menu = (page.json as ExtractedMenu | null | undefined) ?? null
  // The schema's example category names come back as EMPTY categories when the model has
  // nothing to extract; dropping them here keeps that echo out of the merge.
  if (!menu?.categories?.length) return null
  const withItems = menu.categories.filter((c) => (c.items?.length ?? 0) > 0)
  if (withItems.length === 0) return null
  return { ...menu, categories: withItems }
}

export async function scrapeMenuPage(
  url: string,
  options?: { expectedItems?: number | null }
): Promise<MenuExtractResult | null> {
  const expected = options?.expectedItems ?? null
  const isThin = (items: number) => expected !== null && expected > 0 && items < expected * THIN_READ_RATIO

  const first = await readMenuPage(url, { hardened: false, wantScreenshot: true })
  if (!first) return null

  if (!isThin(first.itemsTotal)) {
    return { ...first, thin: false, attempts: 1 }
  }

  // The read is far short of what this URL has produced before. Re-read it with a hardened
  // render and a cold cache before believing the page shrank.
  console.warn(`[Firecrawl] Thin read for ${url}: ${first.itemsTotal} items vs ${expected} expected. Re-reading.`)
  const second = await readMenuPage(url, { hardened: true, wantScreenshot: !first.screenshot })
  const best = second && second.itemsTotal > first.itemsTotal ? second : first
  const thin = isThin(best.itemsTotal)
  if (thin) {
    console.warn(`[Firecrawl] Thin read CONFIRMED for ${url}: ${best.itemsTotal} items vs ${expected} expected after re-read.`)
  }

  return {
    ...best,
    screenshot: best.screenshot ?? first.screenshot,
    thin,
    attempts: second ? 2 : 1,
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
