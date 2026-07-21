// ---------------------------------------------------------------------------
// Menu normalizer – clean up Firecrawl's structured extraction output
// Firecrawl does the heavy lifting (LLM extraction); we just normalize.
// ---------------------------------------------------------------------------

import type { MenuCategory, MenuItem, MenuType, MenuSnapshot, MenuSource } from "./types"
import type { ExtractedMenu } from "@/lib/providers/firecrawl"
import type { GoogleMenuResult } from "@/lib/ai/gemini"

// ---------------------------------------------------------------------------
// Strip markdown formatting from text
// ---------------------------------------------------------------------------

function cleanText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\|/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
}

// ---------------------------------------------------------------------------
// Category classification – detect catering, happy hour, kids, etc.
// ---------------------------------------------------------------------------

const CATERING_PATTERNS = [
  /\bcater/i, /\bbanquet/i, /\bevent\s*package/i, /\bgroup\s*dining/i,
  /\bparty\s*pack/i, /\bparty\s*platter/i, /\bbuffet\s*package/i,
  /\blarge\s*party/i, /\bcorporate\s*(lunch|dinner|event)/i,
]
const BANQUET_PATTERNS = [/\bbanquet/i, /\bevent\s*package/i, /\bprivate\s*dining\s*menu/i]
const HAPPY_HOUR_PATTERNS = [/\bhappy\s*hour/i, /\bhh\s*special/i, /\bdrink\s*special/i]
const KIDS_PATTERNS = [/\bkid/i, /\bchild/i, /\blittle\s*ones/i, /\bjunior/i]

export function classifyMenuCategory(categoryName: string): MenuType {
  const name = categoryName.toLowerCase()
  for (const p of BANQUET_PATTERNS) if (p.test(name)) return "banquet"
  for (const p of CATERING_PATTERNS) if (p.test(name)) return "catering"
  for (const p of HAPPY_HOUR_PATTERNS) if (p.test(name)) return "happy_hour"
  for (const p of KIDS_PATTERNS) if (p.test(name)) return "kids"
  return "dine_in"
}

// ---------------------------------------------------------------------------
// Normalize Firecrawl extracted menu into our MenuCategory/MenuItem types
// ---------------------------------------------------------------------------

export type NormalizedMenuResult = {
  categories: MenuCategory[]
  currency: string | null
  confidence: "high" | "medium" | "low"
  notes: string[]
}

export function normalizeExtractedMenu(
  extracted: ExtractedMenu | null
): NormalizedMenuResult {
  const notes: string[] = []

  if (!extracted || !extracted.categories?.length) {
    notes.push("No menu data extracted from page")
    return { categories: [], currency: null, confidence: "low", notes }
  }

  const categories: MenuCategory[] = extracted.categories
    .filter((c) => c.name && c.items?.length)
    .map((c) => {
      const name = cleanText(c.name)
      return {
        name,
        menuType: classifyMenuCategory(name),
        items: (c.items ?? [])
          .filter((i) => i.name)
          .map((i): MenuItem => ({
            name: cleanText(i.name),
            description: i.description ? cleanText(i.description) || null : null,
            price: i.price?.trim() || null,
            priceValue:
              typeof i.priceValue === "number" && Number.isFinite(i.priceValue)
                ? i.priceValue
                : null,
            tags: Array.isArray(i.tags)
              ? i.tags.map((t) => String(t).toLowerCase().trim()).filter(Boolean)
              : [],
          })),
      }
    })

  const totalItems = categories.reduce((s, c) => s + c.items.length, 0)
  const confidence = totalItems >= 10 ? "high" : totalItems >= 3 ? "medium" : "low"

  notes.push(`Extracted via Firecrawl JSON mode (${totalItems} items across ${categories.length} categories)`)

  return {
    categories,
    currency: extracted.currency ?? "USD",
    confidence,
    notes,
  }
}

// ---------------------------------------------------------------------------
// Normalize Google Gemini menu data into our NormalizedMenuResult type
// ---------------------------------------------------------------------------

export function normalizeGoogleMenuData(
  googleResult: GoogleMenuResult
): NormalizedMenuResult {
  const categories: MenuCategory[] = googleResult.categories
    .filter((c) => c.name && c.items?.length)
    .map((c) => ({
      name: c.name.trim(),
      menuType: c.menuType ?? classifyMenuCategory(c.name),
      items: c.items
        .filter((i) => i.name)
        .map((i): MenuItem => ({
          name: i.name.trim(),
          description: i.description?.trim() || null,
          price: i.price?.trim() || null,
          priceValue:
            typeof i.priceValue === "number" && Number.isFinite(i.priceValue)
              ? i.priceValue
              : null,
          tags: Array.isArray(i.tags)
            ? i.tags.map((t) => String(t).toLowerCase().trim()).filter(Boolean)
            : [],
        })),
    }))

  return {
    categories,
    currency: googleResult.currency,
    confidence: googleResult.confidence,
    notes: googleResult.notes,
  }
}

// ---------------------------------------------------------------------------
// Merge multiple extracted menus into one combined result
// Deduplicates categories by normalized name and items by normalized item name.
// Item dedup is GLOBAL (across every category), not per-category: two sources
// routinely file the same dish under differently-named categories ("Dinner" in
// Firecrawl, "Main Courses" in Gemini), and per-category dedup let that same
// dish be counted twice. Summing two extractors that way produced ~149 items
// for an ~82-item menu (ALT-380). Each item name now survives once — the
// richest occurrence wins and keeps that occurrence's category. Category
// menuType classification is preserved (a non-dine_in read from any source wins).
// ---------------------------------------------------------------------------

function normalizeKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "").trim()
}

function itemRichness(item: MenuItem): number {
  return (item.price ? 1 : 0) + (item.description ? 1 : 0) + (item.tags.length > 0 ? 1 : 0)
}

export function mergeExtractedMenus(
  results: NormalizedMenuResult[]
): NormalizedMenuResult {
  if (results.length === 0) {
    return { categories: [], currency: null, confidence: "low", notes: ["No menu results to merge"] }
  }
  if (results.length === 1) return results[0]

  // Category metadata, first-seen order preserved. menuType upgrades if any
  // source gives a more specific classification than dine_in.
  const catMeta = new Map<string, { displayName: string; menuType: MenuType }>()
  // Global item map — one entry per normalized item name across ALL categories.
  const itemMap = new Map<string, { item: MenuItem; catKey: string }>()
  const allNotes: string[] = []
  let bestCurrency: string | null = null
  let highestConfidence: "high" | "medium" | "low" = "low"

  const confidenceRank = { high: 3, medium: 2, low: 1 }

  for (const result of results) {
    if (!bestCurrency && result.currency) {
      bestCurrency = result.currency
    }

    if (confidenceRank[result.confidence] > confidenceRank[highestConfidence]) {
      highestConfidence = result.confidence
    }

    allNotes.push(...result.notes)

    for (const cat of result.categories) {
      const catKey = normalizeKey(cat.name)
      const catMenuType = cat.menuType ?? classifyMenuCategory(cat.name)
      const existingCat = catMeta.get(catKey)
      if (!existingCat) {
        catMeta.set(catKey, { displayName: cat.name, menuType: catMenuType })
      } else if (existingCat.menuType === "dine_in" && catMenuType !== "dine_in") {
        // A non-dine_in classification from any source wins.
        existingCat.menuType = catMenuType
      }

      for (const item of cat.items) {
        const itemKey = normalizeKey(item.name)
        if (!itemKey) continue
        const prev = itemMap.get(itemKey)
        if (!prev) {
          itemMap.set(itemKey, { item, catKey })
        } else if (itemRichness(item) > itemRichness(prev.item)) {
          // Keep the richest occurrence and follow it to its category.
          itemMap.set(itemKey, { item, catKey })
        }
      }
    }
  }

  // Group the surviving items back under their winning category, preserving
  // first-seen category order. Categories left empty after dedup are dropped.
  const itemsByCat = new Map<string, MenuItem[]>()
  for (const { item, catKey } of itemMap.values()) {
    const list = itemsByCat.get(catKey)
    if (list) list.push(item)
    else itemsByCat.set(catKey, [item])
  }

  const categories: MenuCategory[] = []
  for (const [catKey, meta] of catMeta) {
    const items = itemsByCat.get(catKey)
    if (items && items.length > 0) {
      categories.push({ name: meta.displayName, menuType: meta.menuType, items })
    }
  }

  const totalItems = categories.reduce((s, c) => s + c.items.length, 0)
  allNotes.push(`Merged from ${results.length} sources (${totalItems} total items across ${categories.length} categories)`)

  const mergedConfidence = totalItems >= 10 ? "high" : totalItems >= 3 ? "medium" : "low"
  const finalConfidence = confidenceRank[mergedConfidence] > confidenceRank[highestConfidence]
    ? mergedConfidence
    : highestConfidence

  return {
    categories,
    currency: bestCurrency,
    confidence: finalConfidence,
    notes: allNotes,
  }
}

// ---------------------------------------------------------------------------
// Cross-run union of recent menu snapshots (ALT-380 #4)
//
// A single weekly scrape is noisy: some runs under-read the same page (a real
// ~82-item menu came back as 12), others over-read (a hallucination-heavy run
// padded to ~127). Real menus barely change (~annually), so the trustworthy
// "current menu" is the UNION of items seen across the recent weekly captures,
// not whatever the latest single run happened to return. Unioning holds the
// read at the true size instead of letting one thin scrape collapse it.
//
// Storage stays raw per-run (the change detector needs the true per-run series);
// this is a read/present-time transform applied where insights consume the menu.
//
// Faithful to the ticket's non-negotiable principle #2 ("an anomalous read is a
// scrape failure, not truth"): a run whose item count is a clear HIGH outlier
// versus the window median is dropped before unioning, so a single padded run
// can't poison the union. Thin runs need no guard — union takes the max, so a
// subset read simply contributes nothing new.
// ---------------------------------------------------------------------------

// Number of recent weekly captures to union over. A removed item lingers at
// most this many weeks; genuine removals are surfaced by the sustained-change
// detector, not by the union shrinking.
export const MENU_UNION_WINDOW = 4
const UNION_OUTLIER_FACTOR = 2

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function snapshotToResult(snap: MenuSnapshot): NormalizedMenuResult {
  return {
    categories: snap.categories,
    currency: snap.currency,
    confidence: snap.parseMeta?.confidence ?? "low",
    notes: [],
  }
}

// snapshots: the location's recent firecrawl_menu snapshots, NEWEST-FIRST.
// Returns a single MenuSnapshot representing the unioned menu, or null if none.
export function unionRecentMenus(
  snapshots: (MenuSnapshot | null | undefined)[],
  windowSize: number = MENU_UNION_WINDOW
): MenuSnapshot | null {
  const usable = snapshots.filter((s): s is MenuSnapshot => !!s && !!s.categories)
  if (usable.length === 0) return null

  const window = usable.slice(0, Math.max(1, windowSize))
  const newest = window[0]

  // Drop clear HIGH outliers (likely a padded/hallucinated run) once we have
  // enough runs to judge a median. Never drop everything.
  let considered = window
  if (window.length >= 3) {
    const counts = window.map((s) => s.parseMeta?.itemsTotal ?? 0)
    const med = median(counts)
    const cap = med * UNION_OUTLIER_FACTOR
    const kept = window.filter((s) => (s.parseMeta?.itemsTotal ?? 0) <= cap)
    if (kept.length > 0) considered = kept
  }

  if (considered.length === 1) return considered[0]

  const merged = mergeExtractedMenus(considered.map(snapshotToResult))
  const itemsTotal = merged.categories.reduce((s, c) => s + c.items.length, 0)

  const sources = new Set<MenuSource>()
  for (const s of considered) for (const src of s.parseMeta?.sources ?? []) sources.add(src)

  return {
    menuUrl: newest.menuUrl,
    capturedAt: newest.capturedAt,
    screenshot: newest.screenshot,
    currency: merged.currency ?? newest.currency,
    categories: merged.categories,
    parseMeta: {
      itemsTotal,
      confidence: merged.confidence,
      notes: [
        `Unioned across ${considered.length} recent capture(s) (${itemsTotal} items); ${
          window.length - considered.length
        } outlier run(s) dropped`,
      ],
      sources: Array.from(sources),
    },
  }
}
