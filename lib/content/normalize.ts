// ---------------------------------------------------------------------------
// Content & Menu – normalization and hashing utilities
// ---------------------------------------------------------------------------

import { createHash } from "crypto"
import type {
  SiteContentSnapshot,
  DetectedFeatures,
  MenuSnapshot,
  MenuCategory,
  MenuItem,
} from "./types"

// ---------------------------------------------------------------------------
// Feature detection from page markdown
// ---------------------------------------------------------------------------

const FEATURE_PATTERNS: Record<keyof DetectedFeatures, RegExp[]> = {
  reservation: [
    /reserv(ation|e)/i,
    /book\s*a?\s*table/i,
    /opentable/i,
    /resy\.com/i,
    /yelp\.com\/reservations/i,
  ],
  onlineOrdering: [
    /order\s*online/i,
    /online\s*order/i,
    /place\s*an?\s*order/i,
    /toast(tab)?\.com/i,
    /chownow/i,
    /square\s*online/i,
  ],
  privateDining: [
    /private\s*dining/i,
    /private\s*event/i,
    /private\s*room/i,
    /banquet/i,
  ],
  catering: [
    /catering/i,
    /cater/i,
    /large\s*order/i,
    /group\s*order/i,
  ],
  happyHour: [
    /happy\s*hour/i,
    /drink\s*special/i,
    /weekday\s*special/i,
    /kids\s*eat\s*free/i,
  ],
  deliveryPlatforms: [
    /doordash/i,
    /uber\s*eats/i,
    /grubhub/i,
    /postmates/i,
    /seamless/i,
    /caviar/i,
  ],
}

const DELIVERY_PLATFORM_NAMES: Record<string, string> = {
  doordash: "doordash",
  "uber\\s*eats": "ubereats",
  grubhub: "grubhub",
  postmates: "postmates",
  seamless: "seamless",
  caviar: "caviar",
}

export function detectFeatures(text: string): DetectedFeatures {
  const features: DetectedFeatures = {
    reservation: false,
    onlineOrdering: false,
    privateDining: false,
    catering: false,
    happyHour: false,
    deliveryPlatforms: [],
  }

  for (const [key, patterns] of Object.entries(FEATURE_PATTERNS)) {
    if (key === "deliveryPlatforms") continue
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        ;(features as Record<string, unknown>)[key] = true
        break
      }
    }
  }

  // Detect specific delivery platforms
  for (const [pattern, name] of Object.entries(DELIVERY_PLATFORM_NAMES)) {
    if (new RegExp(pattern, "i").test(text)) {
      features.deliveryPlatforms.push(name)
    }
  }

  return features
}

// ---------------------------------------------------------------------------
// Normalize site content from scraped markdown
// ---------------------------------------------------------------------------

export function normalizeSiteContent(
  website: string,
  markdown: string | null,
  screenshotRef: { storagePath: string; sourceUrl: string } | null
): SiteContentSnapshot {
  const text = markdown ?? ""
  const detected = detectFeatures(text)

  return {
    website,
    capturedAt: new Date().toISOString(),
    screenshot: screenshotRef,
    corePages: [], // populated later if we scrape multiple pages
    detected,
  }
}

// ---------------------------------------------------------------------------
// Normalize menu categories/items
// ---------------------------------------------------------------------------

export function normalizeMenuItem(item: Partial<MenuItem>): MenuItem {
  return {
    name: (item.name ?? "").trim(),
    description: item.description?.trim() || null,
    price: item.price?.trim() || null,
    priceValue:
      typeof item.priceValue === "number" && Number.isFinite(item.priceValue)
        ? Math.round(item.priceValue * 100) / 100
        : null,
    tags: Array.isArray(item.tags)
      ? item.tags.map((t) => String(t).toLowerCase().trim()).filter(Boolean)
      : [],
  }
}

export function normalizeMenuCategories(categories: MenuCategory[]): MenuCategory[] {
  return categories
    .map((cat) => ({
      name: (cat.name ?? "").trim(),
      items: (cat.items ?? []).map(normalizeMenuItem).filter((i) => i.name.length > 0),
    }))
    .filter((cat) => cat.name.length > 0 && cat.items.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function buildMenuSnapshot(
  menuUrl: string | null,
  categories: MenuCategory[],
  confidence: "high" | "medium" | "low",
  notes: string[],
  screenshotRef: { storagePath: string; sourceUrl: string } | null,
  currency: string | null
): MenuSnapshot {
  const normalized = normalizeMenuCategories(categories)
  const itemsTotal = normalized.reduce((sum, cat) => sum + cat.items.length, 0)

  return {
    menuUrl,
    capturedAt: new Date().toISOString(),
    screenshot: screenshotRef,
    currency,
    categories: normalized,
    parseMeta: { itemsTotal, confidence, notes },
  }
}

// ---------------------------------------------------------------------------
// Hashing for change detection
// ---------------------------------------------------------------------------

export function computeContentDiffHash(snapshot: SiteContentSnapshot): string {
  const payload = {
    website: snapshot.website,
    detected: snapshot.detected,
    corePages: snapshot.corePages.map((p) => ({ url: p.url, type: p.type })),
  }
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex")
}

export function computeMenuDiffHash(snapshot: MenuSnapshot): string {
  const payload = {
    categories: snapshot.categories.map((cat) => ({
      name: cat.name,
      items: cat.items.map((i) => ({
        name: i.name,
        price: i.price,
        priceValue: i.priceValue,
      })),
    })),
  }
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex")
}
