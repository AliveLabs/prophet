// ---------------------------------------------------------------------------
// Menu parser – extract structured menu from markdown
// Two-stage: heuristic regex pass + optional Gemini refinement
// ---------------------------------------------------------------------------

import type { MenuCategory, MenuItem } from "./types"
import { generateGeminiJson } from "@/lib/ai/gemini"

// ---------------------------------------------------------------------------
// Stage 1: Heuristic extraction
// ---------------------------------------------------------------------------

const PRICE_PATTERN = /\$\s*(\d+(?:\.\d{1,2})?)/g
const SECTION_HEADER_PATTERN = /^#{1,4}\s+(.+)/gm

type HeuristicResult = {
  categories: MenuCategory[]
  confidence: "high" | "medium" | "low"
  hasItems: boolean
}

function heuristicParse(markdown: string): HeuristicResult {
  if (!markdown || markdown.length < 50) {
    return { categories: [], confidence: "low", hasItems: false }
  }

  // Count price occurrences
  const priceMatches = [...markdown.matchAll(PRICE_PATTERN)]
  if (priceMatches.length < 2) {
    return { categories: [], confidence: "low", hasItems: false }
  }

  // Split by section headers
  const sections: Array<{ name: string; content: string }> = []
  const headerMatches = [...markdown.matchAll(SECTION_HEADER_PATTERN)]

  if (headerMatches.length === 0) {
    // No headers – treat entire text as single category
    sections.push({ name: "Menu", content: markdown })
  } else {
    for (let i = 0; i < headerMatches.length; i++) {
      const match = headerMatches[i]
      const nextMatch = headerMatches[i + 1]
      const start = match.index! + match[0].length
      const end = nextMatch ? nextMatch.index! : markdown.length
      const content = markdown.slice(start, end).trim()
      sections.push({ name: match[1].trim(), content })
    }
  }

  // Extract items from each section
  const categories: MenuCategory[] = []
  for (const section of sections) {
    const items: MenuItem[] = []
    const lines = section.content.split("\n").filter((l) => l.trim().length > 0)

    for (const line of lines) {
      const priceParts = [...line.matchAll(PRICE_PATTERN)]
      if (priceParts.length === 0) continue

      const priceStr = priceParts[0][0]
      const priceVal = parseFloat(priceParts[0][1])
      // Everything before the price is the item name/description
      const nameAndDesc = line.slice(0, priceParts[0].index).replace(/[|*_\-–—]+$/, "").trim()

      if (!nameAndDesc || nameAndDesc.length < 2) continue

      // Split name and description: first sentence is name, rest is description
      const dotIdx = nameAndDesc.indexOf(".")
      const dashIdx = nameAndDesc.indexOf(" - ")
      let name: string
      let description: string | null = null

      if (dashIdx > 0) {
        name = nameAndDesc.slice(0, dashIdx).trim()
        description = nameAndDesc.slice(dashIdx + 3).trim() || null
      } else if (dotIdx > 0 && dotIdx < nameAndDesc.length - 1) {
        name = nameAndDesc.slice(0, dotIdx).trim()
        description = nameAndDesc.slice(dotIdx + 1).trim() || null
      } else {
        name = nameAndDesc
      }

      // Detect tags from description/name text
      const text = `${name} ${description ?? ""}`.toLowerCase()
      const tags: string[] = []
      if (/\bvegan\b/.test(text)) tags.push("vegan")
      if (/\bvegetarian\b/.test(text)) tags.push("vegetarian")
      if (/\bgluten[- ]?free\b/.test(text)) tags.push("gluten-free")
      if (/\bspicy\b/.test(text)) tags.push("spicy")
      if (/\borganic\b/.test(text)) tags.push("organic")

      items.push({
        name,
        description,
        price: priceStr,
        priceValue: Number.isFinite(priceVal) ? priceVal : null,
        tags,
      })
    }

    if (items.length > 0) {
      categories.push({ name: section.name, items })
    }
  }

  const totalItems = categories.reduce((s, c) => s + c.items.length, 0)
  const confidence =
    totalItems >= 10 ? "high" : totalItems >= 3 ? "medium" : "low"

  return { categories, confidence, hasItems: totalItems > 0 }
}

// ---------------------------------------------------------------------------
// Stage 2: Gemini refinement – send markdown to LLM for structured extraction
// ---------------------------------------------------------------------------

const MENU_PARSE_PROMPT = `You are a menu data extraction assistant. Given the following restaurant website content in markdown, extract a structured menu.

Return ONLY valid JSON with this exact schema:
{
  "currency": "USD",
  "categories": [
    {
      "name": "Category Name",
      "items": [
        {
          "name": "Item Name",
          "description": "Brief description or null",
          "price": "$12.99",
          "priceValue": 12.99,
          "tags": ["vegan", "spicy"]
        }
      ]
    }
  ]
}

Rules:
- Extract ALL menu items you can find with their prices
- Group items into their natural categories (Appetizers, Entrees, Desserts, Drinks, etc.)
- tags should only include: "vegan", "vegetarian", "gluten-free", "spicy", "organic", "new", "popular"
- If no price is found for an item, set price to null and priceValue to null
- If currency cannot be determined, default to "USD"
- Return empty categories array if no menu items are found

MARKDOWN CONTENT:
`

export async function parseMenuFromMarkdown(
  markdown: string
): Promise<{
  categories: MenuCategory[]
  currency: string | null
  confidence: "high" | "medium" | "low"
  notes: string[]
}> {
  const notes: string[] = []

  // Stage 1: Heuristic
  const heuristic = heuristicParse(markdown)

  // If heuristic found enough items with high confidence, use directly
  if (heuristic.confidence === "high" && heuristic.categories.length >= 2) {
    notes.push("Parsed via heuristic extraction (high confidence)")
    return {
      categories: heuristic.categories,
      currency: "USD",
      confidence: "high",
      notes,
    }
  }

  // Stage 2: Gemini refinement
  if (!heuristic.hasItems && markdown.length < 100) {
    notes.push("Content too short for menu extraction")
    return { categories: [], currency: null, confidence: "low", notes }
  }

  try {
    // Truncate markdown to avoid token limits (keep first 8000 chars)
    const truncated = markdown.length > 8000 ? markdown.slice(0, 8000) + "\n...(truncated)" : markdown
    const prompt = MENU_PARSE_PROMPT + truncated

    const result = await generateGeminiJson(prompt) as {
      currency?: string
      categories?: Array<{
        name?: string
        items?: Array<{
          name?: string
          description?: string
          price?: string
          priceValue?: number
          tags?: string[]
        }>
      }>
    } | null

    if (!result?.categories?.length) {
      notes.push("Gemini returned no categories; falling back to heuristic")
      return {
        categories: heuristic.categories,
        currency: "USD",
        confidence: heuristic.confidence,
        notes,
      }
    }

    const geminiCategories: MenuCategory[] = result.categories
      .filter((c) => c.name && c.items?.length)
      .map((c) => ({
        name: c.name!,
        items: (c.items ?? [])
          .filter((i) => i.name)
          .map((i) => ({
            name: i.name!,
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

    const totalItems = geminiCategories.reduce((s, c) => s + c.items.length, 0)
    const geminiConfidence = totalItems >= 10 ? "high" : totalItems >= 3 ? "medium" : "low"
    notes.push(`Parsed via Gemini refinement (${totalItems} items)`)

    return {
      categories: geminiCategories,
      currency: result.currency ?? "USD",
      confidence: geminiConfidence,
      notes,
    }
  } catch (error) {
    notes.push(`Gemini parse failed: ${error instanceof Error ? error.message : "unknown"}; using heuristic`)
    return {
      categories: heuristic.categories,
      currency: "USD",
      confidence: heuristic.confidence,
      notes,
    }
  }
}
