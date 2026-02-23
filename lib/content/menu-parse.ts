// ---------------------------------------------------------------------------
// Menu normalizer – clean up Firecrawl's structured extraction output
// Firecrawl does the heavy lifting (LLM extraction); we just normalize.
// ---------------------------------------------------------------------------

import type { MenuCategory, MenuItem, MenuType } from "./types"
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
// Deduplicates categories by normalized name & items by normalized item name
// Preserves menuType classification during merge
// ---------------------------------------------------------------------------

function normalizeKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "").trim()
}

export function mergeExtractedMenus(
  results: NormalizedMenuResult[]
): NormalizedMenuResult {
  if (results.length === 0) {
    return { categories: [], currency: null, confidence: "low", notes: ["No menu results to merge"] }
  }
  if (results.length === 1) return results[0]

  const catMap = new Map<string, { displayName: string; menuType: MenuType; itemMap: Map<string, MenuItem> }>()
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
      if (!catMap.has(catKey)) {
        catMap.set(catKey, {
          displayName: cat.name,
          menuType: cat.menuType ?? classifyMenuCategory(cat.name),
          itemMap: new Map(),
        })
      }
      const existing = catMap.get(catKey)!

      // If a non-dine_in classification comes from any source, prefer it
      if (existing.menuType === "dine_in" && cat.menuType && cat.menuType !== "dine_in") {
        existing.menuType = cat.menuType
      }

      for (const item of cat.items) {
        const itemKey = normalizeKey(item.name)
        if (!existing.itemMap.has(itemKey)) {
          existing.itemMap.set(itemKey, item)
        } else {
          const prev = existing.itemMap.get(itemKey)!
          const prevScore = (prev.price ? 1 : 0) + (prev.description ? 1 : 0) + (prev.tags.length > 0 ? 1 : 0)
          const newScore = (item.price ? 1 : 0) + (item.description ? 1 : 0) + (item.tags.length > 0 ? 1 : 0)
          if (newScore > prevScore) {
            existing.itemMap.set(itemKey, item)
          }
        }
      }
    }
  }

  const categories: MenuCategory[] = Array.from(catMap.values()).map((entry) => ({
    name: entry.displayName,
    menuType: entry.menuType,
    items: Array.from(entry.itemMap.values()),
  }))

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
