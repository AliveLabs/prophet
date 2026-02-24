import type { PriorityItem } from "@/lib/ai/prompts/priority-briefing"

const TTL_MS = 10 * 60 * 1000 // 10 minutes

type CacheEntry = {
  data: PriorityItem[]
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

export function getCachedBriefing(key: string): PriorityItem[] | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return null
  }
  return entry.data
}

export function setCachedBriefing(key: string, data: PriorityItem[]): void {
  // Evict stale entries periodically to prevent unbounded growth
  if (cache.size > 200) {
    const now = Date.now()
    for (const [k, v] of cache) {
      if (now > v.expiresAt) cache.delete(k)
    }
  }
  cache.set(key, { data, expiresAt: Date.now() + TTL_MS })
}
