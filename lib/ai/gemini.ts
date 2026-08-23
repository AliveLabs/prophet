import { fetchWithRetry } from "@/lib/http/fetch-with-retry"
import { coerceItemKind } from "@/lib/content/types"
import { menuReadNote } from "@/lib/content/menu-read-note"

const GEMINI_INSIGHTS_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent"

type GeminiCandidate = {
  content?: {
    parts?: Array<{
      text?: string
    }>
  }
  finishReason?: string
}

type GeminiUsageMetadata = {
  promptTokenCount?: number
  candidatesTokenCount?: number
  // Thinking tokens count against the output budget, same as Anthropic's adaptive thinking
  // (see provider.ts's max_tokens invariant): folded into outputTokens below, not dropped.
  thoughtsTokenCount?: number
  cachedContentTokenCount?: number
}

type GeminiResponse = {
  candidates?: GeminiCandidate[]
  usageMetadata?: GeminiUsageMetadata
}

/** Per-call token usage for spend telemetry (lib/ai/spend-events.ts). Mirrors provider.ts's
 *  TokenUsage shape for Anthropic so both providers' onUsage callbacks look the same. */
export type GeminiUsage = {
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

function getGeminiKey() {
  const key = process.env.GOOGLE_AI_API_KEY
  if (!key) {
    throw new Error("GOOGLE_AI_API_KEY is not configured")
  }
  return key
}

function parseJson(text: string) {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf("{")
    const end = trimmed.lastIndexOf("}")
    if (start === -1 || end === -1 || end <= start) {
      return null
    }
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

export async function generateGeminiJson(
  prompt: string,
  options?: {
    maxOutputTokens?: number
    temperature?: number
    thinkingBudget?: number
    /** Observability only (spend telemetry, ALT beta-rescue 2.3): receives the per-call token
     *  usage so callers can attribute non-brief Gemini spend. Fires on any 200 response that
     *  carries usageMetadata, INCLUDING one whose content ends up empty (still billed). A throw
     *  inside the callback is swallowed: telemetry must never break the call. NEVER sent to the API. */
    onUsage?: (usage: GeminiUsage) => void
  }
) {
  const response = await fetchWithRetry(`${GEMINI_INSIGHTS_URL}?key=${getGeminiKey()}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: options?.temperature ?? 0.3,
        ...(options?.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
        // gemini-2.5-pro thinks by default and bills thinking against the output budget.
        // Bounding it (when the caller opts in) leaves room for the JSON so the model
        // doesn't spend the whole budget reasoning and return empty content (ALT-294).
        ...(options?.thinkingBudget != null ? { thinkingConfig: { thinkingBudget: options.thinkingBudget } } : {}),
      },
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Gemini error: ${response.status} ${text}`)
  }

  const data = (await response.json()) as GeminiResponse
  // Usage fires BEFORE the empty-content check, on purpose: a call that came back empty (thinking
  // ate the whole budget) still billed real tokens, same "runs before the truncation guard"
  // ordering provider.ts uses for Anthropic.
  const um = data.usageMetadata
  if (um && options?.onUsage) {
    try {
      options.onUsage({
        model: "gemini-2.5-pro",
        inputTokens: um.promptTokenCount ?? 0,
        outputTokens: (um.candidatesTokenCount ?? 0) + (um.thoughtsTokenCount ?? 0),
        cacheReadTokens: um.cachedContentTokenCount ?? 0,
      })
    } catch (usageErr) {
      console.warn("[Gemini] onUsage callback threw (ignored):", usageErr)
    }
  }
  const candidate = data.candidates?.[0]
  const text = candidate?.content?.parts?.map((part) => part.text ?? "").join("") ?? ""
  // A 200 with empty parts means the model produced no output — almost always
  // finishReason MAX_TOKENS (thinking consumed the whole budget). Log it so this
  // stops being an invisible null → 502 (ALT-294); contract unchanged (returns null).
  if (!text) {
    console.warn(`[Gemini] empty content (finishReason=${candidate?.finishReason ?? "unknown"}) — raise maxOutputTokens / thinkingBudget`)
    return null
  }
  return parseJson(text)
}

// ---------------------------------------------------------------------------
// Gemini + Google Search Grounding – fetch menu data from Google's knowledge
// ---------------------------------------------------------------------------

// Menu enrichment runs on Flash (beta rescue 2.2): it was the single biggest Gemini cost
// line at Pro rates (~4x more per call), Flash supports google_search grounding (the
// grounded-events adapter in lib/providers/gemini/google-events.ts is the working proof),
// and a 5-restaurant Pro-vs-Flash spot check held up on item count / categories / price
// coverage. Deliberately its OWN constant — generateGeminiJson above keeps its own model.
const GEMINI_GROUNDED_MENU_MODEL = "gemini-2.5-flash"
const GEMINI_GROUNDED_MENU_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_GROUNDED_MENU_MODEL}:generateContent`

export type GoogleMenuCategory = {
  name: string
  menuType: "dine_in" | "catering" | "banquet" | "happy_hour" | "kids" | "other"
  items: Array<{
    name: string
    description: string | null
    price: string | null
    priceValue: number | null
    tags: string[]
    itemKind: string | null
  }>
}

export type GoogleMenuResult = {
  categories: GoogleMenuCategory[]
  currency: string | null
  confidence: "high" | "medium" | "low"
  notes: string[]
}

const GOOGLE_MENU_PROMPT = `You are a restaurant menu data extraction assistant. Search Google for the complete current menu of this restaurant, including all categories and items with prices.

For each menu item, provide:
- name: the item name
- description: a brief description if available, or null
- price: the price as displayed (e.g. "$12.99"), or null if unknown
- priceValue: the numeric price value (e.g. 12.99), or null if unknown
- tags: dietary tags like "vegan", "vegetarian", "gluten-free", "spicy" if applicable
- itemKind: what KIND of item this is, based on what it IS (not the section heading), so meal prices can be compared like-to-like. One of: "combo_meal" (a bundled meal: entree+side+drink, "combo", "meal", value meal), "entree" (a standalone main dish: sandwich, plate, bowl, pizza, entree salad), "side" (fries, slaw, chips, side salad), "drink" (soda, tea, coffee, shake, bottled), "dessert" (cookie, pie slice, sundae), "condiment" (a sauce/dip/dressing sold on its own), "family_pack" (a multi-serving catering/party pack, platter, or bundle feeding several people), or "other". Use null only when genuinely unclear.

For each category, classify menuType as one of:
- "dine_in" for regular menu categories (appetizers, entrees, desserts, drinks, etc.)
- "catering" for catering packages or catering-specific menus
- "banquet" for banquet or event packages
- "happy_hour" for happy hour specials
- "kids" for children's menus
- "other" for anything else

Return a JSON object with this exact structure:
{
  "categories": [
    {
      "name": "Category Name",
      "menuType": "dine_in",
      "items": [
        { "name": "Item", "description": "...", "price": "$12.99", "priceValue": 12.99, "tags": ["vegan"], "itemKind": "entree" }
      ]
    }
  ],
  "currency": "USD",
  "confidence": "high"
}

Set confidence to "high" if you found detailed menu data with prices, "medium" if partial data, "low" if very little data.
Do NOT invent items or prices. Only include items you can verify from search results.`

export async function fetchGoogleMenuData(
  restaurantName: string,
  address: string | null,
  industryType?: string
): Promise<GoogleMenuResult | null> {
  try {
    const locationInfo = address ? `${restaurantName} at ${address}` : restaurantName
    let contextPrefix = ""
    if (process.env.VERTICALIZATION_ENABLED === "true" && industryType) {
      const { getVerticalConfig } = await import("@/lib/verticals")
      const config = getVerticalConfig(industryType)
      contextPrefix = `Industry: ${config.llmContext.businessDescription}. `
    }
    const prompt = `${contextPrefix}${GOOGLE_MENU_PROMPT}\n\nRestaurant: ${locationInfo}`

    const response = await fetchWithRetry(`${GEMINI_GROUNDED_MENU_URL}?key=${getGeminiKey()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.1,
          // Room for large menus: Pro spot-check runs emitted up to ~7.5k combined tokens, and
          // 8192 minus the thinking cap truncated 2/5 real DFW menus in testing.
          maxOutputTokens: 16384,
          // Flash bills thinking against the output budget too; cap it so reasoning can't eat
          // the whole budget and return empty content (the ALT-294 class; same cap as the
          // grounded-events adapter). Grounding still runs.
          thinkingConfig: { thinkingBudget: 2048 },
        },
      }),
    })

    if (!response.ok) {
      console.warn(`[Gemini Menu] HTTP ${response.status}`)
      return null
    }

    const data = (await response.json()) as GeminiResponse
    const text =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? ""

    const parsed = parseJson(text)
    if (!parsed || !Array.isArray(parsed.categories)) {
      console.warn("[Gemini Menu] Invalid JSON structure")
      return null
    }

    const categories: GoogleMenuCategory[] = (parsed.categories as GoogleMenuCategory[])
      .filter((c) => c.name && Array.isArray(c.items) && c.items.length > 0)
      .map((c) => ({
        name: String(c.name).trim(),
        menuType: (["dine_in", "catering", "banquet", "happy_hour", "kids", "other"] as const).includes(c.menuType)
          ? c.menuType
          : "dine_in",
        items: c.items
          .filter((i) => i.name)
          .map((i) => ({
            name: String(i.name).trim(),
            description: i.description ? String(i.description).trim() : null,
            price: i.price ? String(i.price).trim() : null,
            priceValue: typeof i.priceValue === "number" && Number.isFinite(i.priceValue)
              ? i.priceValue
              : null,
            tags: Array.isArray(i.tags)
              ? i.tags.map((t) => String(t).toLowerCase().trim()).filter(Boolean)
              : [],
            itemKind: coerceItemKind(i.itemKind) ?? null,
          })),
      }))

    const totalItems = categories.reduce((s, c) => s + c.items.length, 0)
    const confidence = parsed.confidence === "high" && totalItems >= 5
      ? "high"
      : totalItems >= 3
        ? "medium"
        : "low"

    console.log(`[Gemini Menu] Found ${totalItems} items across ${categories.length} categories for ${restaurantName}`)

    return {
      categories,
      currency: typeof parsed.currency === "string" ? parsed.currency : "USD",
      confidence,
      // ALT-610: was `Google Search grounding: N items across M categories`, and it shipped to
      // customers. `parseMeta.notes` renders under "How we read it" on /content, so that string
      // cited a vendor as our data source and used internal jargon ("grounding") in the same
      // breath. Phrasing now comes from the one shared builder; see lib/content/menu-read-note.ts.
      notes: [menuReadNote("published_sources", totalItems, categories.length)],
    }
  } catch (err) {
    console.warn("[Gemini Menu] Error:", err)
    return null
  }
}
