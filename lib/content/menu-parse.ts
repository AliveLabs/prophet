// ---------------------------------------------------------------------------
// Menu normalizer – clean up Firecrawl's structured extraction output
// Firecrawl does the heavy lifting (LLM extraction); we just normalize.
// ---------------------------------------------------------------------------

import type { MenuCategory, MenuItem } from "./types"
import type { ExtractedMenu } from "@/lib/providers/firecrawl"

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
    .map((c) => ({
      name: cleanText(c.name),
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
    }))

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
// Merge multiple extracted menus into one combined result
// Deduplicates categories by normalized name & items by normalized item name
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

  // Track categories by normalized name → { name, items Map }
  const catMap = new Map<string, { displayName: string; itemMap: Map<string, MenuItem> }>()
  const allNotes: string[] = []
  let bestCurrency: string | null = null
  let highestConfidence: "high" | "medium" | "low" = "low"

  const confidenceRank = { high: 3, medium: 2, low: 1 }

  for (const result of results) {
    // Track best currency (first non-null wins)
    if (!bestCurrency && result.currency) {
      bestCurrency = result.currency
    }

    // Track highest confidence
    if (confidenceRank[result.confidence] > confidenceRank[highestConfidence]) {
      highestConfidence = result.confidence
    }

    // Collect all notes
    allNotes.push(...result.notes)

    // Merge categories
    for (const cat of result.categories) {
      const catKey = normalizeKey(cat.name)
      if (!catMap.has(catKey)) {
        catMap.set(catKey, {
          displayName: cat.name,
          itemMap: new Map(),
        })
      }
      const existing = catMap.get(catKey)!

      // Merge items, deduplicating by normalized name
      for (const item of cat.items) {
        const itemKey = normalizeKey(item.name)
        if (!existing.itemMap.has(itemKey)) {
          existing.itemMap.set(itemKey, item)
        } else {
          // Keep the version with more info (has price, description, etc.)
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

  // Build merged categories
  const categories: MenuCategory[] = Array.from(catMap.values()).map((entry) => ({
    name: entry.displayName,
    items: Array.from(entry.itemMap.values()),
  }))

  const totalItems = categories.reduce((s, c) => s + c.items.length, 0)
  allNotes.push(`Merged from ${results.length} sources (${totalItems} total items across ${categories.length} categories)`)

  // Recompute confidence based on merged total
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
