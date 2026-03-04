// ---------------------------------------------------------------------------
// Social Handle Discovery Pipeline
//
// Three-layer approach:
//   1. Auto-scrape websites via Firecrawl for social media links
//   2. Data365 profile search by business name
//   3. Manual input (handled in UI, not here)
//
// Discovery runs automatically when competitors are approved and
// can be re-triggered manually.
// ---------------------------------------------------------------------------

import { scrapePage } from "@/lib/providers/firecrawl"
import { searchProfiles, Data365Error, type Data365Platform } from "@/lib/providers/data365/client"
import type { SocialPlatform } from "./types"

export type DiscoveredHandle = {
  platform: SocialPlatform
  handle: string
  profileUrl: string
  method: "auto_scrape" | "data365_search"
  confidence: number
}

// ---------------------------------------------------------------------------
// 1. Website scraping – extract social links from homepage/about page
// ---------------------------------------------------------------------------

const SOCIAL_URL_PATTERNS: Array<{
  platform: SocialPlatform
  regex: RegExp
  extractHandle: (match: RegExpMatchArray) => string | null
}> = [
  {
    platform: "instagram",
    regex: /https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]{1,30})\/?/g,
    extractHandle: (m) => {
      const h = m[1]
      if (!h || ["explore", "p", "reel", "stories", "accounts", "about", "legal"].includes(h)) return null
      return h
    },
  },
  {
    platform: "facebook",
    regex: /https?:\/\/(?:www\.)?(?:facebook|fb)\.com\/([a-zA-Z0-9.]{1,50})\/?/g,
    extractHandle: (m) => {
      const h = m[1]
      if (!h || ["sharer", "share", "dialog", "login", "help", "policies", "groups", "events", "pages", "watch"].includes(h)) return null
      return h
    },
  },
  {
    platform: "tiktok",
    regex: /https?:\/\/(?:www\.)?tiktok\.com\/@([a-zA-Z0-9._]{1,24})\/?/g,
    extractHandle: (m) => m[1] ?? null,
  },
]

export async function discoverFromWebsite(websiteUrl: string): Promise<DiscoveredHandle[]> {
  if (!websiteUrl) return []

  const discovered: DiscoveredHandle[] = []
  const seen = new Set<string>()

  try {
    const result = await scrapePage(websiteUrl, { fullPageScreenshot: false, timeout: 20000 })
    if (!result) return []

    const searchText = [result.markdown ?? "", ...result.links].join("\n")

    for (const pattern of SOCIAL_URL_PATTERNS) {
      pattern.regex.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = pattern.regex.exec(searchText)) !== null) {
        const handle = pattern.extractHandle(match)
        if (!handle) continue

        const key = `${pattern.platform}:${handle.toLowerCase()}`
        if (seen.has(key)) continue
        seen.add(key)

        discovered.push({
          platform: pattern.platform,
          handle,
          profileUrl: match[0].replace(/\/$/, ""),
          method: "auto_scrape",
          confidence: 0.9,
        })
      }
    }
  } catch (error) {
    console.warn(`[Social Discovery] Website scrape failed for ${websiteUrl}:`, error)
  }

  return discovered
}

// ---------------------------------------------------------------------------
// 2. Data365 profile search – search by business name
// ---------------------------------------------------------------------------

type SearchItem = {
  username?: string
  unique_id?: string
  name?: string
  full_name?: string
  nickname?: string
  followers_count?: number
}

type SearchResponse = {
  data?: {
    items?: SearchItem[]
  }
}

export async function discoverFromSearch(
  businessName: string,
  platforms: SocialPlatform[] = ["instagram", "facebook", "tiktok"]
): Promise<DiscoveredHandle[]> {
  if (!businessName) return []

  const discovered: DiscoveredHandle[] = []

  for (const platform of platforms) {
    try {
      const data365Platform = platform as Data365Platform
      const results = await searchProfiles<SearchResponse>(data365Platform, businessName, 5)
      const items = results.data?.items ?? []

      for (const item of items) {
        const handle = item.username ?? item.unique_id ?? item.name ?? null
        if (!handle) continue

        const name = (item.full_name ?? item.name ?? item.nickname ?? "").toLowerCase()
        const target = businessName.toLowerCase()
        const similarity = computeSimilarity(name, target)

        if (similarity < 0.3) continue

        const profileUrl = buildProfileUrl(platform, handle)
        discovered.push({
          platform,
          handle,
          profileUrl,
          method: "data365_search",
          confidence: Math.min(0.95, similarity),
        })
      }
    } catch (error) {
      if (error instanceof Data365Error && (error.statusCode === 501 || error.statusCode === 404)) {
        continue
      }
      console.warn(`[Social Discovery] Data365 search failed for ${platform}/${businessName}:`,
        error instanceof Error ? error.message : error)
    }
  }

  return discovered
}

// ---------------------------------------------------------------------------
// Combined discovery (runs both methods, deduplicates)
// ---------------------------------------------------------------------------

export async function discoverSocialHandles(
  businessName: string,
  websiteUrl: string | null
): Promise<DiscoveredHandle[]> {
  const results: DiscoveredHandle[] = []

  const [websiteResults, searchResults] = await Promise.allSettled([
    websiteUrl ? discoverFromWebsite(websiteUrl) : Promise.resolve([]),
    discoverFromSearch(businessName),
  ])

  if (websiteResults.status === "fulfilled") results.push(...websiteResults.value)
  if (searchResults.status === "fulfilled") results.push(...searchResults.value)

  // Deduplicate: prefer website-scraped (higher confidence)
  const byPlatform = new Map<string, DiscoveredHandle>()
  for (const r of results) {
    const key = `${r.platform}:${r.handle.toLowerCase()}`
    const existing = byPlatform.get(key)
    if (!existing || r.confidence > existing.confidence) {
      byPlatform.set(key, r)
    }
  }

  // Keep best per platform
  const bestPerPlatform = new Map<SocialPlatform, DiscoveredHandle>()
  for (const r of byPlatform.values()) {
    const existing = bestPerPlatform.get(r.platform)
    if (!existing || r.confidence > existing.confidence) {
      bestPerPlatform.set(r.platform, r)
    }
  }

  return Array.from(bestPerPlatform.values())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildProfileUrl(platform: SocialPlatform, handle: string): string {
  switch (platform) {
    case "instagram":
      return `https://instagram.com/${handle}`
    case "facebook":
      return `https://facebook.com/${handle}`
    case "tiktok":
      return `https://tiktok.com/@${handle}`
  }
}

/**
 * Simple Jaccard-like similarity for business name matching.
 */
function computeSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean))
  const wordsB = new Set(b.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean))
  if (wordsA.size === 0 || wordsB.size === 0) return 0

  let intersection = 0
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++
  }

  const union = new Set([...wordsA, ...wordsB]).size
  return union > 0 ? intersection / union : 0
}
