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

// Per-item type, classified at menu-PARSE time so price comparisons can be made
// like-to-like (combo-vs-combo, entree-vs-entree, family_pack-vs-family_pack) instead of
// flat-averaging a combo-driven concept against an à-la-carte one (ALT-296 / root cause of
// ALT-290). OPTIONAL: legacy snapshots captured before this field existed have no itemKind —
// classification accrues on new scrapes, and comparison code falls back to a name heuristic
// for unclassified items, so absence is expected and safe.
export type ItemKind =
  | "combo_meal"   // a bundled meal (entree + side + drink, "combo", "meal deal", value meal)
  | "entree"       // a standalone main dish (sandwich, plate, bowl, pizza, entree salad)
  | "side"         // a standalone side (fries, slaw, chips, side salad)
  | "drink"        // a beverage (soda, tea, coffee, shake, bottled)
  | "dessert"      // a standalone sweet (cookie, pie slice, sundae)
  | "condiment"    // a sauce/dip/dressing/add-on sold on its own
  | "family_pack"  // a multi-serving catering/party pack, bundle, or platter
  | "other"        // anything that doesn't fit above (merch, gift card, unclear)

export const ITEM_KINDS: readonly ItemKind[] = [
  "combo_meal", "entree", "side", "drink", "dessert", "condiment", "family_pack", "other",
] as const

/** Validate an extractor-supplied itemKind, returning undefined for anything not in the
 *  taxonomy (so a hallucinated/blank value degrades to "unclassified", not a bad bucket). */
export function coerceItemKind(raw: unknown): ItemKind | undefined {
  return typeof raw === "string" && (ITEM_KINDS as readonly string[]).includes(raw)
    ? (raw as ItemKind)
    : undefined
}

export type MenuItem = {
  name: string
  description: string | null
  price: string | null       // raw price string e.g. "$12.99"
  priceValue: number | null  // numeric value e.g. 12.99
  tags: string[]             // e.g. ["vegan", "spicy", "gluten-free"]
  itemKind?: ItemKind        // parse-time item classification (ALT-296); absent on legacy snapshots
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

// ---------------------------------------------------------------------------
// Generic catalog type aliases (verticalization)
// These allow new vertical code to use generic names while existing
// restaurant-specific code continues to use the original types unchanged.
// ---------------------------------------------------------------------------

export type CatalogItem = MenuItem
export type CatalogCategory = MenuCategory
export type CatalogSnapshot = MenuSnapshot

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
