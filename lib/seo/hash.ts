// ---------------------------------------------------------------------------
// SEO Search Intelligence – Diff hashing
// ---------------------------------------------------------------------------

import { createHash } from "crypto"
import type { DomainRankSnapshot, NormalizedRankedKeyword, SerpRankEntry } from "./types"

/**
 * Hash a Domain Rank Overview snapshot for change detection.
 */
export function hashDomainRankSnapshot(snapshot: DomainRankSnapshot): string {
  const payload = {
    domain: snapshot.domain,
    organic: snapshot.organic,
    paid: { etv: snapshot.paid.etv, rankedKeywords: snapshot.paid.rankedKeywords },
  }
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex")
}

/**
 * Hash ranked keywords list for change detection.
 */
export function hashRankedKeywords(keywords: NormalizedRankedKeyword[]): string {
  const sorted = [...keywords]
    .sort((a, b) => a.keyword.localeCompare(b.keyword))
    .map((k) => ({ keyword: k.keyword, rank: k.rank }))
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex")
}

/**
 * Hash SERP rank entries for a set of tracked keywords.
 */
export function hashSerpRanks(entries: SerpRankEntry[]): string {
  const sorted = [...entries]
    .sort((a, b) => a.keyword.localeCompare(b.keyword))
    .map((e) => ({ keyword: e.keyword, positions: e.positions }))
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex")
}

/**
 * Generic JSON hash for any snapshot payload.
 */
export function hashJsonPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex")
}
