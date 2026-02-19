const GEMINI_INSIGHTS_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent"

type GeminiCandidate = {
  content?: {
    parts?: Array<{
      text?: string
    }>
  }
}

type GeminiResponse = {
  candidates?: GeminiCandidate[]
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
  options?: { maxOutputTokens?: number; temperature?: number }
) {
  const response = await fetch(`${GEMINI_INSIGHTS_URL}?key=${getGeminiKey()}`, {
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
      },
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Gemini error: ${response.status} ${text}`)
  }

  const data = (await response.json()) as GeminiResponse
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? ""
  return parseJson(text)
}

// ---------------------------------------------------------------------------
// Gemini + Google Search Grounding – fetch menu data from Google's knowledge
// ---------------------------------------------------------------------------

export type GoogleMenuCategory = {
  name: string
  menuType: "dine_in" | "catering" | "banquet" | "happy_hour" | "kids" | "other"
  items: Array<{
    name: string
    description: string | null
    price: string | null
    priceValue: number | null
    tags: string[]
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
        { "name": "Item", "description": "...", "price": "$12.99", "priceValue": 12.99, "tags": ["vegan"] }
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
  address: string | null
): Promise<GoogleMenuResult | null> {
  try {
    const locationInfo = address ? `${restaurantName} at ${address}` : restaurantName
    const prompt = `${GOOGLE_MENU_PROMPT}\n\nRestaurant: ${locationInfo}`

    const response = await fetch(`${GEMINI_INSIGHTS_URL}?key=${getGeminiKey()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
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
      notes: [`Google Search grounding: ${totalItems} items across ${categories.length} categories`],
    }
  } catch (err) {
    console.warn("[Gemini Menu] Error:", err)
    return null
  }
}
