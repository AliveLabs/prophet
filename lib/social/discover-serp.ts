// ---------------------------------------------------------------------------
// SERP handle discovery (handle-completion · Batch 1)
//
// Google's index does the fuzzy matching for us: one site-scoped organic query
// per platform (site:instagram.com "<name>" <city>) via DataForSEO Live Regular
// (~$0.002/query, seconds). All three platform tasks go in ONE request. Used for
// entities lacking a verified handle — including those with NO website, which
// website-scrape discovery can never reach (the Bush's Forney gap).
//
// Confidence blends the result TITLE vs business name (IG/FB titles carry the
// display name) with handle-vs-name token containment, discounted below rank 3.
// Verification thresholds live in the pipeline, not here.
// ---------------------------------------------------------------------------

import { postDataForSEO } from "@/lib/providers/dataforseo/client"
import type { SocialPlatform } from "./types"
import {
  type DiscoveredHandle,
  extractHandlesFromText,
  handleNameSimilarity,
  computeSimilarity,
} from "./enrich"

const PLATFORM_SITES: Record<SocialPlatform, string> = {
  instagram: "instagram.com",
  facebook: "facebook.com",
  tiktok: "tiktok.com",
}

type SerpItem = {
  type?: string
  rank_absolute?: number
  url?: string
  title?: string
}

type SerpTaskResponse = {
  tasks?: Array<{
    status_code?: number
    status_message?: string
    data?: { keyword?: string }
    result?: Array<{ items?: SerpItem[] }>
  }>
}

const SERP_TIMEOUT_MS = 15_000
const MIN_CONFIDENCE = 0.5

export async function discoverFromSerp(
  businessName: string,
  locality: string | null,
  platforms: SocialPlatform[] = ["instagram", "facebook", "tiktok"]
): Promise<DiscoveredHandle[]> {
  if (!businessName.trim()) return []

  const tasks = platforms.map((platform) => ({
    keyword: `site:${PLATFORM_SITES[platform]} "${businessName}"${locality ? ` ${locality}` : ""}`,
    location_name: "United States",
    language_code: "en",
    device: "desktop",
    depth: 10,
  }))

  let data: SerpTaskResponse
  try {
    data = await Promise.race([
      postDataForSEO<SerpTaskResponse>("/v3/serp/google/organic/live/regular", tasks),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("SERP discovery timeout")), SERP_TIMEOUT_MS)
      ),
    ])
  } catch (err) {
    console.warn(`[Social Discovery] SERP discovery failed for "${businessName}":`, err instanceof Error ? err.message : err)
    return []
  }

  const discovered: DiscoveredHandle[] = []
  for (const task of data.tasks ?? []) {
    if (task.status_code !== 20000) continue
    const items = (task.result?.[0]?.items ?? []).filter((i) => i.type === "organic" && i.url)
    for (const item of items) {
      // The url is the candidate; the title corroborates identity.
      const fromUrl = extractHandlesFromText(item.url as string, "serp", 0)
      for (const h of fromUrl) {
        const titleSim = item.title ? computeSimilarity(item.title, businessName) : 0
        const handleSim = handleNameSimilarity(h.handle, businessName)
        const rank = item.rank_absolute ?? 10
        const rankFactor = rank <= 3 ? 1 : 0.85
        const confidence = Math.min(0.85, Math.max(titleSim, handleSim) * rankFactor)
        if (confidence < MIN_CONFIDENCE) continue
        discovered.push({ ...h, confidence })
      }
    }
  }

  // Best candidate per platform.
  const best = new Map<SocialPlatform, DiscoveredHandle>()
  for (const h of discovered) {
    const cur = best.get(h.platform)
    if (!cur || h.confidence > cur.confidence) best.set(h.platform, h)
  }
  return [...best.values()]
}
