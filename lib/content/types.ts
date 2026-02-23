// ---------------------------------------------------------------------------
// Content & Menu Intelligence – normalized data types
// Stored in location_snapshots.raw_data (location) and snapshots.raw_data (competitor)
// ---------------------------------------------------------------------------

export type ScreenshotRef = {
  storagePath: string
  sourceUrl: string
}

// ---------------------------------------------------------------------------
// Site Content snapshot (provider = "firecrawl_site_content")
// ---------------------------------------------------------------------------

export type CorePage = {
  url: string
  title: string
  type: "home" | "about" | "reservations" | "catering" | "contact" | "menu" | "other"
  summary: string
}

export type DetectedFeatures = {
  reservation: boolean
  onlineOrdering: boolean
  privateDining: boolean
  catering: boolean
  happyHour: boolean
  deliveryPlatforms: string[]
}

export type SiteContentSnapshot = {
  website: string
  capturedAt: string
  screenshot: ScreenshotRef | null
  corePages: CorePage[]
  detected: DetectedFeatures
}

// ---------------------------------------------------------------------------
// Menu snapshot (provider = "firecrawl_menu")
// ---------------------------------------------------------------------------

export type MenuItem = {
  name: string
  description: string | null
  price: string | null       // raw price string e.g. "$12.99"
  priceValue: number | null  // numeric value e.g. 12.99
  tags: string[]             // e.g. ["vegan", "spicy", "gluten-free"]
}

export type MenuType = "dine_in" | "catering" | "banquet" | "happy_hour" | "kids" | "other"

export type MenuCategory = {
  name: string
  menuType: MenuType
  items: MenuItem[]
}

export type MenuSource = "firecrawl" | "gemini_google_search"

export type ParseMeta = {
  itemsTotal: number
  confidence: "high" | "medium" | "low"
  notes: string[]
  sources?: MenuSource[]
}

export type MenuSnapshot = {
  menuUrl: string | null
  capturedAt: string
  screenshot: ScreenshotRef | null
  currency: string | null
  categories: MenuCategory[]
  parseMeta: ParseMeta
}

// ---------------------------------------------------------------------------
// Helper: default empty snapshots
// ---------------------------------------------------------------------------

export function emptySiteContent(website: string): SiteContentSnapshot {
  return {
    website,
    capturedAt: new Date().toISOString(),
    screenshot: null,
    corePages: [],
    detected: {
      reservation: false,
      onlineOrdering: false,
      privateDining: false,
      catering: false,
      happyHour: false,
      deliveryPlatforms: [],
    },
  }
}

export function emptyMenu(): MenuSnapshot {
  return {
    menuUrl: null,
    capturedAt: new Date().toISOString(),
    screenshot: null,
    currency: null,
    categories: [],
    parseMeta: { itemsTotal: 0, confidence: "low", notes: ["No menu data found"], sources: [] },
  }
}
