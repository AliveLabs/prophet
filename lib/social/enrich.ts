// ---------------------------------------------------------------------------
// Social Handle Discovery Pipeline (handle-completion · Batch 1)
//
// Candidate sources, cheapest/most-trusted first:
//   1. Auto-scrape websites via Firecrawl for social media links
//   2. Google SERP via DataForSEO (site:instagram.com "<name>" <city>) — discover-serp.ts
//   3. Bio expansion from an already-verified handle (bio links + linktree)
//   4. Data365 profile search by business name (fallback; candidates only, never auto-verified)
//   5. Manual input (handled in UI, not here)
//
// Discovery runs automatically for entities lacking a VERIFIED handle and
// can be re-triggered manually.
// ---------------------------------------------------------------------------

import { scrapePage } from "@/lib/providers/firecrawl"
import { searchProfiles, Data365Error, type Data365Platform } from "@/lib/providers/data365/client"
import type { SocialPlatform } from "./types"

export type DiscoveredHandle = {
  platform: SocialPlatform
  handle: string
  profileUrl: string
  /** TS-level source; "serp" and "bio_expansion" persist as discovery_method
   *  'auto_scrape' + metadata.source until the Batch-2 migration widens the CHECK. */
  method: "auto_scrape" | "data365_search" | "serp" | "bio_expansion"
  confidence: number
}

// ---------------------------------------------------------------------------
// 1. Website scraping – extract social links from homepage/about page
// ---------------------------------------------------------------------------

export const SOCIAL_URL_PATTERNS: Array<{
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

const SEARCH_PER_PLATFORM_TIMEOUT_MS = 20_000

// Fuzzy name-search is the low-quality discovery source — it produced junk handles
// (e.g. "naadaaaaaaaaaa") at the old 0.3 floor. Require a strong name match; the
// canonical handle should come from scraping the official website anyway.
const SEARCH_MIN_SIMILARITY = 0.6

export async function discoverFromSearch(
  businessName: string,
  platforms: SocialPlatform[] = ["instagram", "facebook", "tiktok"]
): Promise<DiscoveredHandle[]> {
  if (!businessName) return []

  const results = await Promise.allSettled(
    platforms.map((platform) =>
      withSearchTimeout(searchSinglePlatform(platform, businessName), SEARCH_PER_PLATFORM_TIMEOUT_MS, platform, businessName)
    )
  )

  const discovered: DiscoveredHandle[] = []
  for (const r of results) {
    if (r.status === "fulfilled") discovered.push(...r.value)
  }
  return discovered
}

async function searchSinglePlatform(
  platform: SocialPlatform,
  businessName: string
): Promise<DiscoveredHandle[]> {
  try {
    const data365Platform = platform as Data365Platform
    const results = await searchProfiles<SearchResponse>(data365Platform, businessName, 5)
    const items = results.data?.items ?? []
    const discovered: DiscoveredHandle[] = []

    for (const item of items) {
      const handle = item.username ?? item.unique_id ?? item.name ?? null
      if (!handle) continue

      const name = (item.full_name ?? item.name ?? item.nickname ?? "").toLowerCase()
      const target = businessName.toLowerCase()
      const similarity = computeSimilarity(name, target)

      if (similarity < SEARCH_MIN_SIMILARITY) continue

      const profileUrl = buildProfileUrl(platform, handle)
      discovered.push({
        platform,
        handle,
        profileUrl,
        method: "data365_search",
        confidence: Math.min(0.95, similarity),
      })
    }

    return discovered
  } catch (error) {
    if (error instanceof Data365Error && (error.statusCode === 501 || error.statusCode === 404)) {
      return []
    }
    console.warn(`[Social Discovery] Data365 search failed for ${platform}/${businessName}:`,
      error instanceof Error ? error.message : error)
    return []
  }
}

function withSearchTimeout<T>(
  promise: Promise<T>,
  ms: number,
  platform: string,
  businessName: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      console.warn(`[Social Discovery] ${platform}/${businessName} search timed out after ${ms / 1000}s — skipping`)
      reject(new Error(`Search timeout for ${platform}/${businessName}`))
    }, ms)
    promise
      .then((v) => { clearTimeout(timer); resolve(v) })
      .catch((e) => { clearTimeout(timer); reject(e) })
  })
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
// Re-discovery targeting
// ---------------------------------------------------------------------------

export type DiscoveryEntity = { id: string; website: string | null; name?: string | null }

/** The full set of platforms discovery tracks — an entity is only "fully verified"
 *  (and safe to stop re-scanning) once every one of these has a verified row. */
export const TRACKED_DISCOVERY_PLATFORMS: readonly SocialPlatform[] = ["instagram", "facebook", "tiktok"]

/**
 * Which entities should (re)run discovery. An entity qualifies when it's missing a
 * *verified* handle for at least one tracked platform and we have SOMETHING to
 * search with — a website to scrape OR a name for SERP discovery.
 *
 * `verifiedPlatformKeys` is per-(entity, platform) — `"<entityId>:<platform>"` —
 * NOT per-entity. (ALT-198 root cause: the old signature took a per-ENTITY
 * verified-id Set, so ANY one verified platform excluded the entity from
 * discovery entirely — Raising Cane's had Instagram added + verified manually
 * early on, which silently blocked Facebook/TikTok from ever being
 * auto-discovered afterward. An entity must now be verified on EVERY tracked
 * platform before discovery stops re-scanning it.)
 *
 * (Earlier behavior also required a website, which silently excluded every
 * competitor whose website was missing — the Bush's Forney gap.)
 */
export function selectDiscoveryTargets<T extends DiscoveryEntity>(
  entities: T[],
  verifiedPlatformKeys: ReadonlySet<string>
): T[] {
  return entities.filter((e) => {
    if (!e.website && !e.name?.trim()) return false
    return TRACKED_DISCOVERY_PLATFORMS.some(
      (platform) => !verifiedPlatformKeys.has(`${e.id}:${platform}`)
    )
  })
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

/** Extract platform handles from any text blob (scraped page, SERP urls, a bio). */
export function extractHandlesFromText(
  text: string,
  method: DiscoveredHandle["method"],
  confidence: number
): DiscoveredHandle[] {
  const discovered: DiscoveredHandle[] = []
  const seen = new Set<string>()
  for (const pattern of SOCIAL_URL_PATTERNS) {
    for (const match of text.matchAll(pattern.regex)) {
      const handle = pattern.extractHandle(match)
      if (!handle) continue
      const key = `${pattern.platform}:${handle.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      discovered.push({
        platform: pattern.platform,
        handle,
        profileUrl: match[0].replace(/\/$/, ""),
        method,
        confidence,
      })
    }
  }
  return discovered
}

/**
 * Handle-vs-business-name similarity. Handles concatenate words ("bushschicken"),
 * so token containment beats word-set comparison here: "Bush's Chicken" vs
 * "bushschickenforney" → strong; "naadaaaaaaaaaa" vs "Nada" → weak.
 */
export function handleNameSimilarity(handle: string, businessName: string): number {
  const h = handle.toLowerCase().replace(/[._-]/g, "")
  const tokens = businessName.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((t) => t.length > 1)
  if (!h || tokens.length === 0) return 0
  const joined = tokens.join("")
  if (joined.length >= 5 && (h.includes(joined) || joined.includes(h))) return 0.9
  const present = tokens.filter((t) => h.includes(t)).length
  return present / tokens.length
}

/** Link-in-bio aggregator URLs found in a profile bio (worth one expansion scrape). */
const BIO_LINK_AGGREGATORS = /https?:\/\/(?:www\.)?(?:linktr\.ee|beacons\.ai|bio\.link|linkin\.bio|taplink\.cc)\/[^\s)"']+/gi

export function extractAggregatorUrls(bio: string | null | undefined): string[] {
  if (!bio) return []
  return [...new Set(bio.match(BIO_LINK_AGGREGATORS) ?? [])].slice(0, 2)
}

/**
 * Simple Jaccard-like similarity for business name matching.
 */
export function computeSimilarity(a: string, b: string): number {
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
