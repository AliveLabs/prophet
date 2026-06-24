// ---------------------------------------------------------------------------
// Learning Spine L0 (P14) — PIPELINE 1: EXTERNAL knowledge ingestion.
//
// Per ENABLED skill_source_registry row: fetch by fetch_strategy → adversarially DISTILL each item to
// a ~500-char ACTIONABLE snippet → VALIDATE (trust-tier + confidence + attribution) → corroborate →
// write skill_knowledge rows as `candidate` → promote per the rules. NOTHING reaches a prompt until
// `active`, and `active` rows still carry NO new evidenceRefs (trends INFORM, never OVERRIDE).
//
// The cron route (app/api/cron/ingest-knowledge-feeds) is a thin wrapper around runIngestion() here;
// the gates below are PURE FUNCTIONS so they unit-test deterministically (no live network/model).
//
// SAFETY POSTURE (§2.2):
//   (a) source MUST be in the registry with a trust_tier + enabled — NO open-web ingestion, ever.
//   (b) ADVERSARIAL distill: "durable, generalizable operator tactics only; reject single-brand
//       promos, unverifiable claims, unattributable prices/stats, region-locked guidance" +
//       self-assessed confidence + attribution. low-confidence / unattributable → DROPPED.
//   (c) corroboration: ≥2 tier-1 sources → higher seed confidence + may auto-promote to `active`;
//       a lone tier-3 caps at `shadow`.
//   (d) recency: stamp active_window so trends self-retire.
//   (e) idempotent + dry-run safe.
// ---------------------------------------------------------------------------

import { generateStructured, type Transport } from "@/lib/ai/provider"

// ── Registry + fetched-item shapes ────────────────────────────────────────────────────────────────
export type SourceRow = {
  id: string
  skillIds: string[]
  name: string
  vertical: string
  url: string
  fetchStrategy: "rss" | "scrape" | "scrape-browser-headers" | "data-api"
  authKind: "none" | "free-token" | "paid"
  trustTier: 1 | 2 | 3
  enabled: boolean
}

/** A raw item pulled from a source, before distillation. */
export type FetchedItem = { title: string; body: string; url?: string }

/** The model's adversarial distill verdict for one item. */
export type DistillVerdict = {
  /** The ~500-char actionable snippet. */
  snippet: string
  /** Short label (becomes skill_knowledge.title + the dedupe handle). */
  title: string
  /** 0-100 self-assessed durability/generalizability confidence. */
  confidence: number
  /** Whether the model could attribute the tactic to the source (false → dropped). */
  attributable: boolean
  /** Why it was kept/dropped (provenance only). */
  note?: string
}

// ── Thresholds (the only tunables — kept here so they're in one place) ──────────────────────────────
export const DISTILL_MIN_CONFIDENCE = 50 // below this → dropped, never stored
export const SNIPPET_MAX_CHARS = 600 // hard cap; the prompt asks for ~500
export const TIER1_AUTOPROMOTE_CONFIDENCE = 70 // a corroborated tier-1 trend can reach `active`
export const SINGLE_TIER1_SHADOW_CONFIDENCE = 60 // a lone tier-1 (uncorroborated) can reach `shadow`
export const DEFAULT_ACTIVE_WINDOW_DAYS = 60 // trends self-retire after ~2 months
// Throughput: the weekly run fetches many sources + distills many items against a 300s function limit.
// Both phases run with a bounded concurrency pool so the run finishes well under the limit (the model
// distill is the slow step) WITHOUT hammering source sites or the model's rate limits.
export const FETCH_CONCURRENCY = 6
export const DISTILL_CONCURRENCY = 6
// When a source fans out (rss item links / scraped index → article pages), bound the per-source
// article fetches so a single source can't open dozens of sockets inside the outer FETCH pool.
export const ARTICLE_FETCH_CONCURRENCY = 3
// Default # of articles to follow off a scraped index page.
export const SCRAPE_ARTICLE_LINKS = 5
// A fetched article body longer than this in the feed itself is "full enough" to distill without
// following the link (avoids a needless second fetch when content:encoded already carries the body).
export const FEED_FULL_BODY_MIN_CHARS = 600
// Hard cap on extracted article text handed to the distill model (~500-char snippet target needs far
// less; this just keeps a giant page from blowing the prompt while still capturing the real body).
export const ARTICLE_TEXT_MAX_CHARS = 6000

/** Run fn over items with at most `limit` promises in flight; PRESERVES input order in the results
 *  (so per-source tallies + per-skill grouping stay deterministic regardless of completion order). */
async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const run = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) results[i] = await fn(items[i], i)
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run))
  return results
}

// ── (a) HTTP transport (injectable for tests; never hit live in unit tests) ─────────────────────────
export type HttpFetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>

// Richer browser headers for sources that bot-block a bare fetch. Adding accept-language + referer
// (a plausible Google referral) is enough to get a 200 from some WAFs (verified: QSR's WordPress feed
// goes 403→200 with these). A hard block (e.g. Toast) is disabled in the registry instead — we never
// burn weekly fetches on a guaranteed 403.
const BROWSER_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  referer: "https://www.google.com/",
}

/** Strip tags + decode the handful of entities that matter; collapse whitespace. Dependency-free. */
function stripHtml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Tolerant, dependency-free RSS/Atom item extractor. Pulls <item>/<entry> title + description/content
 *  + link. Good enough for the distill step (the model does the real reading); robust to messy feeds. */
export function parseRssItems(xml: string, max = 8): FetchedItem[] {
  const items: FetchedItem[] = []
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? []
  for (const block of blocks.slice(0, max)) {
    const pick = (tag: string): string => {
      const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))
      return m ? stripHtml(m[1]) : ""
    }
    const title = pick("title")
    const body = pick("description") || pick("content:encoded") || pick("content") || pick("summary")
    // Atom <link href=".."/> or RSS <link>..</link>.
    const linkHref = block.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1]
    const linkText = block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i)?.[1]
    const url = (linkHref || (linkText ? stripHtml(linkText) : "")) || undefined
    if (title || body) items.push({ title, body, url })
  }
  return items
}

/** Extract a few coarse content chunks from an HTML page (the generic http path). Not a real scraper —
 *  it strips to text and windows it; the distill model extracts the durable tactic from the prose. */
export function parseHtmlItems(html: string, max = 4): FetchedItem[] {
  const title = stripHtml(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")
  const text = stripHtml(html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, ""))
  if (!text) return []
  const CHUNK = 1800
  const items: FetchedItem[] = []
  for (let i = 0; i < text.length && items.length < max; i += CHUNK) {
    items.push({ title: title || "article", body: text.slice(i, i + CHUNK) })
  }
  return items
}

// ── Main-content extraction — pull the REAL article body, not the nav/teaser chrome ─────────────────
// Dependency-free + tolerant (this runs in a Vercel serverless fn — no jsdom/readability). The OLD
// path windowed the whole stripped page, so an index page's NAV MENU ("Product Pricing How it works
// …") became the "body" and the (correctly strict) distill gate rejected everything → 0 rows. These
// heuristics isolate the actual article prose so the model has a durable tactic to distill.

/** Remove non-content regions (scripts, styles, nav/header/footer/aside/form) from raw HTML. */
function stripChromeRegions(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header\b[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form\b[\s\S]*?<\/form>/gi, " ")
}

/** First inner-HTML match for a tag (e.g. <article>…</article>); "" when absent. */
function firstRegion(html: string, re: RegExp): string {
  return html.match(re)?.[1] ?? ""
}

/**
 * Extract the main article TEXT from an HTML page. Strips chrome (script/style/nav/header/footer/
 * aside/form), then PREFERS <article>, then <main>, then [role=main]; otherwise collects <p> blocks
 * and keeps the largest CONTIGUOUS cluster of paragraphs (the body, not scattered nav captions).
 * Collapses whitespace + caps length. Returns "" when there's no real body (so the caller can fall
 * back to a teaser rather than feed the distill gate page chrome). Dependency-free.
 */
export function extractArticleText(html: string, maxChars = ARTICLE_TEXT_MAX_CHARS): string {
  if (!html) return ""
  const cleaned = stripChromeRegions(html)
  const cap = (s: string) => stripHtml(s).slice(0, maxChars).trim()

  // (1) Semantic containers, most-specific first.
  const article = firstRegion(cleaned, /<article\b[^>]*>([\s\S]*?)<\/article>/i)
  if (stripHtml(article).length >= 200) return cap(article)
  const main = firstRegion(cleaned, /<main\b[^>]*>([\s\S]*?)<\/main>/i)
  if (stripHtml(main).length >= 200) return cap(main)
  const roleMainMatch = cleaned.match(/<([a-z0-9]+)\b[^>]*\srole=["']main["'][^>]*>([\s\S]*?)<\/\1>/i)
  if (roleMainMatch && stripHtml(roleMainMatch[2]).length >= 200) return cap(roleMainMatch[2])

  // (2) No semantic container → collect <p> blocks and take the largest contiguous cluster. A big gap
  // of non-<p> markup (typical of a nav/sidebar break) starts a new cluster; keep the most-text one.
  const pBlocks: Array<{ text: string; start: number; end: number }> = []
  const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi
  for (let m = pRe.exec(cleaned); m !== null; m = pRe.exec(cleaned)) {
    const text = stripHtml(m[1])
    if (text.length >= 40) pBlocks.push({ text, start: m.index, end: pRe.lastIndex })
  }
  if (pBlocks.length === 0) {
    // (3) Last resort: a no-paragraph page (rare). Return "" so the caller falls back to its teaser —
    // we explicitly do NOT window the whole stripped page (that's the bug we're fixing).
    return ""
  }
  // Cluster paragraphs: a gap larger than GAP chars of intervening markup breaks the cluster.
  const GAP = 1500
  const clusters: string[][] = []
  let current: string[] = []
  let prevEnd = -1
  for (const b of pBlocks) {
    if (prevEnd >= 0 && b.start - prevEnd > GAP) {
      clusters.push(current)
      current = []
    }
    current.push(b.text)
    prevEnd = b.end
  }
  if (current.length) clusters.push(current)
  let best = ""
  for (const c of clusters) {
    const joined = c.join(" ")
    if (joined.length > best.length) best = joined
  }
  return stripHtml(best).slice(0, maxChars).trim()
}

/**
 * Extract same-host ARTICLE links from an index/listing page. Heuristics keep slug-like content links
 * and drop nav/category/tag/login/anchors. Resolves relative → absolute against baseUrl, dedupes, caps.
 * Dependency-free. Returns absolute URLs.
 */
export function extractArticleLinks(html: string, baseUrl: string, max = SCRAPE_ARTICLE_LINKS): string[] {
  if (!html) return []
  let base: URL
  try {
    base = new URL(baseUrl)
  } catch {
    return []
  }
  // Only mine the main body — drop nav/header/footer so we don't pick up menu links.
  const body = stripChromeRegions(html)
  const out: string[] = []
  const seen = new Set<string>()
  // Path segments that signal a nav/utility link rather than an article.
  const BAD_SEGMENTS = new Set([
    "category", "categories", "tag", "tags", "topic", "topics", "author", "authors", "page",
    "login", "signin", "sign-in", "signup", "sign-up", "register", "account", "subscribe",
    "search", "about", "contact", "privacy", "terms", "cookie", "cookies", "sitemap", "feed",
    "rss", "wp-login", "cart", "checkout", "pricing", "demo", "careers", "press", "media", "legal",
  ])
  const hrefRe = /<a\b[^>]*\shref=["']([^"'#]+)["'][^>]*>/gi
  for (let m = hrefRe.exec(body); m !== null && out.length < max; m = hrefRe.exec(body)) {
    const raw = m[1].trim()
    if (!raw || raw.startsWith("mailto:") || raw.startsWith("tel:") || raw.startsWith("javascript:")) continue
    let u: URL
    try {
      u = new URL(raw, base)
    } catch {
      continue
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue
    if (u.host !== base.host) continue // same-host only
    const segments = u.pathname.split("/").filter(Boolean)
    if (segments.length === 0) continue // homepage
    if (segments.some((s) => BAD_SEGMENTS.has(s.toLowerCase()))) continue
    // Article heuristic: a reasonably deep path whose LAST segment is slug-like (letters + hyphens,
    // several chars, usually multi-word). Drops shallow section roots like /news/ or /blog/.
    const last = segments[segments.length - 1].toLowerCase()
    const slugLike = /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(last) || (segments.length >= 2 && /^[a-z0-9-]{8,}$/.test(last))
    if (!slugLike) continue
    const abs = `${u.origin}${u.pathname}`
    if (seen.has(abs)) continue
    seen.add(abs)
    out.push(abs)
  }
  return out
}

/** Fetch + parse a single source by its strategy. Throws on transport failure (caller catches per
 *  source → increments failure_count; one dead source NEVER breaks the run).
 *
 *  REAL-BODY EXTRACTION (the fix): the OLD path distilled either the RSS <description> TEASER or a
 *  window of the whole stripped INDEX page (mostly nav menu). The strict distill gate correctly
 *  rejected that chrome → 0 rows. Now:
 *    • rss   → use the feed body if it's already a full article; else FOLLOW the item link and extract
 *              the real article text; else fall back to the teaser. One dead article → teaser fallback.
 *    • scrape / scrape-browser-headers → fetch the index, pull ARTICLE links, fetch + extract each;
 *              if no links found, fall back to extractArticleText(index) (better than windowing chrome).
 *    • data-api → unchanged JSON-as-text path. */
export async function fetchSourceItems(source: SourceRow, http: HttpFetch): Promise<FetchedItem[]> {
  if (source.authKind !== "none") {
    // (a) key-gated sources are seeded DISABLED; if one is ever enabled without wiring its key, we do
    // NOT silently scrape it — skip with a clear status. (enabled is already checked by the caller.)
    throw new Error(`source ${source.id} requires auth_kind=${source.authKind}; skipped (no key path wired)`)
  }
  // Send browser headers for scrape-browser-headers AND rss: several feeds (QSR's WordPress /feed/ was
  // VERIFIED 200 ONLY with these headers; a bare fetch is 403). Browser headers are harmless to a feed
  // that doesn't need them (a /feed/ returns the same RSS either way), so this can't regress the others.
  const useBrowserHeaders = source.fetchStrategy === "scrape-browser-headers" || source.fetchStrategy === "rss"
  const headers = useBrowserHeaders ? BROWSER_HEADERS : undefined

  // The index/feed fetch (this is what fails the source if it 403s/404s — propagated to the caller).
  const res = await http(source.url, headers ? { headers } : undefined)
  if (!res.ok) throw new Error(`http_${res.status}`)
  const text = await res.text()

  // Fetch ONE article page; never throws (one dead article must not fail the source).
  const fetchArticle = async (url: string): Promise<string> => {
    try {
      const r = await http(url, useBrowserHeaders ? { headers: BROWSER_HEADERS } : undefined)
      if (!r.ok) return ""
      return await r.text()
    } catch {
      return ""
    }
  }

  if (source.fetchStrategy === "rss") {
    const feedItems = parseRssItems(text)
    // For each feed item: use a full feed body if present; else follow the link → real article text;
    // else fall back to the teaser. Bounded fan-out so one source can't open many sockets at once.
    const built = await mapPool(feedItems, ARTICLE_FETCH_CONCURRENCY, async (it): Promise<FetchedItem | null> => {
      const teaser = it.body
      if (teaser.length >= FEED_FULL_BODY_MIN_CHARS) {
        // The feed already carried a full article body (content:encoded). Distill that directly.
        return { title: it.title, body: teaser, url: it.url }
      }
      if (it.url) {
        const articleText = extractArticleText(await fetchArticle(it.url))
        if (articleText) return { title: it.title, body: articleText, url: it.url }
      }
      // Fallback: the teaser is all we have (link missing or its fetch failed/empty).
      if (teaser) return { title: it.title, body: teaser, url: it.url }
      return null
    })
    return built.filter((x): x is FetchedItem => x !== null)
  }

  if (source.fetchStrategy === "scrape" || source.fetchStrategy === "scrape-browser-headers") {
    const links = extractArticleLinks(text, source.url)
    if (links.length === 0) {
      // No article links discovered → extract the index page's own main content (still far better than
      // windowing the whole stripped page, which is mostly nav). Empty body → no items (fail-soft).
      const body = extractArticleText(text)
      const title = stripHtml(text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") || source.name
      return body ? [{ title, body, url: source.url }] : []
    }
    const built = await mapPool(links, ARTICLE_FETCH_CONCURRENCY, async (url): Promise<FetchedItem | null> => {
      const articleText = extractArticleText(await fetchArticle(url)) // fetchArticle never throws
      if (!articleText) return null // one dead/empty article skipped, source still ok
      return { title: source.name, body: articleText, url }
    })
    return built.filter((x): x is FetchedItem => x !== null)
  }

  // data-api (e.g. BLS): JSON-as-text path unchanged — the distill model reads the JSON as prose.
  return parseHtmlItems(text)
}

// ── (b) ADVERSARIAL distill — the gate that rejects garbage before it can ever become a prior ──────
const DISTILL_SYSTEM = [
  "You are a skeptical restaurant-industry analyst distilling a source item into a DURABLE, GENERALIZABLE operator tactic that could inform a restaurant's strategy.",
  "Extract ONLY a tactic that would still be true and useful for a typical independent restaurant operator, independent of any single brand.",
  "REJECT (set attributable=false or confidence below 50): single-brand promos or press releases; unverifiable claims; prices, percentages, or stats you cannot attribute to the named source; region-locked guidance; anything you cannot phrase as a generalizable operator tactic.",
  "The snippet must be ACTIONABLE prose a busy owner could act on, <= 500 characters, with NO fabricated numbers — only cite a figure if the source clearly states it and you attribute it ('per <source>, ...').",
  "This is a PRIOR, never a fact about any specific restaurant, and never evidence — write it accordingly.",
  'Return ONLY JSON: { "title": string (<=80 chars), "snippet": string, "confidence": 0-100 integer (your self-assessed durability + generalizability + attribution), "attributable": boolean, "note": string (one line: why) }',
].join(" ")

/** Distill one item via the reasoning model. Injectable transport → deterministic in tests. Returns
 *  null on a malformed model response (treated as a drop). */
export async function distillItem(
  item: FetchedItem,
  source: SourceRow,
  opts: { transport?: Transport } = {},
): Promise<DistillVerdict | null> {
  const prompt = JSON.stringify({
    source: { name: source.name, vertical: source.vertical, trustTier: source.trustTier, url: source.url },
    item: { title: item.title, body: item.body.slice(0, 4000), url: item.url },
  })
  const verdict = await generateStructured<DistillVerdict | null>(
    { tier: "reasoning", system: DISTILL_SYSTEM, prompt, temperature: 0.2, maxOutputTokens: 1200 },
    {
      // Forward the injectable transport so distill is deterministic in tests (the docstring promises
      // this, and runIngestion's write-path tests depend on it). In prod opts.transport is undefined →
      // generateStructured falls back to defaultTransport exactly as before.
      transport: opts.transport,
      validate: (raw) => {
        if (!raw || typeof raw !== "object") return null
        const r = raw as Record<string, unknown>
        const snippet = typeof r.snippet === "string" ? r.snippet.trim() : ""
        const title = typeof r.title === "string" ? r.title.trim() : ""
        if (!snippet || !title) return null
        return {
          snippet: snippet.slice(0, SNIPPET_MAX_CHARS),
          title: title.slice(0, 80),
          confidence: typeof r.confidence === "number" ? Math.max(0, Math.min(100, Math.round(r.confidence))) : 0,
          attributable: r.attributable === true,
          note: typeof r.note === "string" ? r.note : undefined,
        }
      },
      fallback: () => null,
    },
  )
  return verdict
}

/** (b) Keep gate: a verdict survives only if attributable AND confidence >= the floor. */
export function passesDistillGate(v: DistillVerdict): boolean {
  return v.attributable && v.confidence >= DISTILL_MIN_CONFIDENCE
}

// ── (c) corroboration → status + seed confidence ───────────────────────────────────────────────────
export type CandidateRow = {
  skillId: string
  title: string
  snippet: string
  confidence: number
  supportN: number
  status: "candidate" | "shadow" | "active"
  knowledgeVersion: string
  provenance: Record<string, unknown>
  effectiveFromMs: number
  effectiveToMs: number
}

/** A distilled, gate-passing verdict tied to its source (one per (source,item)). */
export type DistilledHit = { verdict: DistillVerdict; source: SourceRow; itemUrl?: string }

/**
 * Roll gate-passing hits for ONE skill into candidate rows, applying corroboration:
 *   - group hits by a normalized title (the asserted trend);
 *   - support_n = # distinct sources asserting it; tier1Count = # of those that are tier-1;
 *   - ≥2 tier-1 sources AND max confidence >= TIER1_AUTOPROMOTE_CONFIDENCE → `active` (auto-promote);
 *   - a single tier-1 at/above SINGLE_TIER1_SHADOW_CONFIDENCE → `shadow`;
 *   - anything resting on a lone tier-3 source → capped at `shadow` (never active);
 *   - everything else → `candidate`.
 * Seed confidence is the max item confidence, nudged up when corroborated. Pure + deterministic.
 */
export function corroborate(skillId: string, hits: DistilledHit[], opts: { nowMs?: number; baseVersion?: string } = {}): CandidateRow[] {
  const now = opts.nowMs ?? Date.now()
  const baseVersion = opts.baseVersion ?? `${skillId}@learned`
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  const groups = new Map<string, DistilledHit[]>()
  for (const h of hits) {
    const key = norm(h.verdict.title)
    if (!key) continue
    const arr = groups.get(key) ?? []
    arr.push(h)
    groups.set(key, arr)
  }

  const rows: CandidateRow[] = []
  for (const group of groups.values()) {
    const sources = new Map<string, SourceRow>()
    for (const h of group) sources.set(h.source.id, h.source)
    const distinctSources = [...sources.values()]
    const tier1Count = distinctSources.filter((s) => s.trustTier === 1).length
    const hasOnlyTier3 = distinctSources.every((s) => s.trustTier === 3)
    const supportN = distinctSources.length
    const maxConf = Math.max(...group.map((h) => h.verdict.confidence))
    // corroboration bonus: +10 per extra corroborating source, capped at 100.
    const seedConfidence = Math.min(100, maxConf + Math.max(0, supportN - 1) * 10)

    let status: CandidateRow["status"] = "candidate"
    if (hasOnlyTier3) {
      status = "shadow" // a lone/only-tier-3 trend can never go active until corroborated by a higher tier
    } else if (tier1Count >= 2 && seedConfidence >= TIER1_AUTOPROMOTE_CONFIDENCE) {
      status = "active" // (c) ≥2 tier-1 sources + high confidence → auto-promote
    } else if (tier1Count >= 1 && seedConfidence >= SINGLE_TIER1_SHADOW_CONFIDENCE) {
      status = "shadow" // a single tier-1 source: compute + observe, but don't yet serve
    }

    // pick the best-written representative (highest confidence) for the snippet/title.
    const rep = [...group].sort((a, b) => b.verdict.confidence - a.verdict.confidence)[0]
    rows.push({
      skillId,
      title: rep.verdict.title,
      snippet: rep.verdict.snippet,
      confidence: seedConfidence,
      supportN,
      status,
      knowledgeVersion: `${baseVersion}+f${now.toString(36).slice(-4)}`,
      provenance: {
        streams: ["external"],
        sources: distinctSources.map((s) => ({ id: s.id, name: s.name, trust_tier: s.trustTier, url: s.url })),
        items: group.map((h) => ({ url: h.itemUrl, note: h.verdict.note })),
        distilled_by: "model",
        distilled_at: new Date(now).toISOString(),
      },
      effectiveFromMs: now,
      effectiveToMs: now + DEFAULT_ACTIVE_WINDOW_DAYS * 86_400_000,
    })
  }
  return rows
}

// ── Persistence surface (loose-typed; service-role; idempotent) ──────────────────────────────────────
export type IngestStore = {
  from: (t: string) => {
    select: (cols: string) => {
      eq: (c: string, v: boolean | string) => Promise<{ data: Record<string, unknown>[] | null; error: unknown }>
    }
    upsert: (rows: Record<string, unknown>[], opts: { onConflict: string }) => Promise<{ error: { message: string } | null }>
    update: (row: Record<string, unknown>) => {
      eq: (c: string, v: string) => Promise<{ data?: Record<string, unknown>[] | null; error: { message: string } | null }>
    }
  }
}

export function rowToSource(r: Record<string, unknown>): SourceRow {
  return {
    id: String(r.id ?? ""),
    skillIds: Array.isArray(r.skill_ids) ? (r.skill_ids as unknown[]).map(String) : [],
    name: String(r.name ?? ""),
    vertical: String(r.vertical ?? ""),
    url: String(r.url ?? ""),
    fetchStrategy: (["rss", "scrape", "scrape-browser-headers", "data-api"].includes(String(r.fetch_strategy))
      ? r.fetch_strategy
      : "scrape") as SourceRow["fetchStrategy"],
    authKind: (["none", "free-token", "paid"].includes(String(r.auth_kind)) ? r.auth_kind : "none") as SourceRow["authKind"],
    trustTier: (r.trust_tier === 1 || r.trust_tier === 3 ? r.trust_tier : 2) as SourceRow["trustTier"],
    enabled: r.enabled !== false,
  }
}

export type IngestResult = {
  dryRun: boolean
  sourcesTried: number
  sourcesOk: number
  sourcesFailed: number
  itemsFetched: number
  distilledKept: number
  rowsWritten: number
  bySkill: Record<string, number>
  errors: Array<{ sourceId: string; error: string }>
  /** Persistence (upsert) failures, SURFACED — never swallowed. A non-empty array means rows that were
   *  distilled+kept did NOT reach skill_knowledge (e.g. an ON CONFLICT mismatch). This is what made the
   *  original bug invisible: an upsert error must show up here AND in the logs, even though the run
   *  stays fail-soft (a write error does not throw). rowsWritten is NOT incremented on a failed write. */
  writeErrors: Array<{ skillId: string; error: string }>
}

export type RunIngestionOpts = {
  store: IngestStore
  http: HttpFetch
  transport?: Transport
  dryRun?: boolean
  nowMs?: number
  /** Cap on items distilled per source per run (cost guard). */
  maxItemsPerSource?: number
}

/**
 * The whole PIPELINE 1 run. Idempotent (skill_knowledge upserts on the unique key; sources update
 * last_fetch/last_status/failure_count). dryRun=true does everything EXCEPT write skill_knowledge —
 * it still records the per-source fetch status so a dry run is observable. One dead source never
 * breaks the run (each is try/caught → failure_count++).
 */
export async function runIngestion(opts: RunIngestionOpts): Promise<IngestResult> {
  const now = opts.nowMs ?? Date.now()
  const maxItems = opts.maxItemsPerSource ?? 6
  const result: IngestResult = {
    dryRun: !!opts.dryRun,
    sourcesTried: 0,
    sourcesOk: 0,
    sourcesFailed: 0,
    itemsFetched: 0,
    distilledKept: 0,
    rowsWritten: 0,
    bySkill: {},
    errors: [],
    writeErrors: [],
  }

  const { data, error } = await opts.store.from("skill_source_registry").select("*").eq("enabled", true)
  if (error) return result // fail-soft: registry absent/unreadable → no-op run (floor = today)
  const sources = (data ?? []).map(rowToSource).filter((s) => s.enabled)

  result.sourcesTried = sources.length

  // PHASE 1 — fetch every source CONCURRENTLY (bounded I/O). One dead source never breaks the run
  // (per-source try/catch → failure_count++). mapPool keeps source order so the tallies below + errors[]
  // stay deterministic regardless of which fetch finishes first.
  type Fetched = { source: SourceRow; items: FetchedItem[]; ok: boolean; error?: string }
  const fetched = await mapPool(sources, FETCH_CONCURRENCY, async (source): Promise<Fetched> => {
    try {
      const items = (await fetchSourceItems(source, opts.http)).slice(0, maxItems)
      await updateSourceStatus(opts.store, source.id, { last_fetch: new Date(now).toISOString(), last_status: items.length ? "ok" : "no_items", reset_failures: true })
      return { source, items, ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "fetch_error"
      await updateSourceStatus(opts.store, source.id, { last_fetch: new Date(now).toISOString(), last_status: msg.slice(0, 80), increment_failures: true })
      return { source, items: [], ok: false, error: msg }
    }
  })
  for (const f of fetched) {
    if (f.ok) {
      result.sourcesOk++
      result.itemsFetched += f.items.length
    } else {
      result.sourcesFailed++
      result.errors.push({ sourceId: f.source.id, error: f.error ?? "fetch_error" })
    }
  }

  // PHASE 2 — distill every fetched item CONCURRENTLY (bounded). The model distill is the slow step, so
  // this pool is what keeps the whole run well under the function time limit.
  const toDistill = fetched.flatMap((f) => f.items.map((item) => ({ source: f.source, item })))
  const verdicts = await mapPool(toDistill, DISTILL_CONCURRENCY, ({ source, item }) =>
    distillItem(item, source, { transport: opts.transport }),
  )

  // hits grouped per skill (a source can feed several), built IN ORDER so corroboration is deterministic.
  const hitsBySkill = new Map<string, DistilledHit[]>()
  verdicts.forEach((verdict, i) => {
    if (!verdict || !passesDistillGate(verdict)) return
    result.distilledKept++
    const { source, item } = toDistill[i]
    for (const skillId of source.skillIds) {
      const arr = hitsBySkill.get(skillId) ?? []
      arr.push({ verdict, source, itemUrl: item.url })
      hitsBySkill.set(skillId, arr)
    }
  })

  // Corroborate per skill → candidate rows → write (unless dry-run).
  for (const [skillId, hits] of hitsBySkill) {
    const rows = corroborate(skillId, hits, { nowMs: now })
    result.bySkill[skillId] = rows.length
    if (opts.dryRun || rows.length === 0) continue
    const payload = rows.map((r) => ({
      skill_id: r.skillId,
      scope: "global",
      scope_id: null,
      learning_kind: "external_trend",
      title: r.title,
      snippet: r.snippet,
      provenance: r.provenance,
      confidence: r.confidence,
      support_n: r.supportN,
      status: r.status,
      knowledge_version: r.knowledgeVersion,
      effective_from: new Date(r.effectiveFromMs).toISOString(),
      effective_to: new Date(r.effectiveToMs).toISOString(),
      updated_at: new Date(now).toISOString(),
    }))
    // Idempotent on the dedupe index (skill_id, scope, scope_id, learning_kind, title) — NULLS NOT
    // DISTINCT, so global rows (scope_id NULL) dedupe too. This MUST match uq_skill_knowledge_dedupe;
    // a mismatch makes Postgres raise 42P10 and write nothing. (External-trend rows are all global, so
    // every payload row carries scope='global', scope_id=null, set above.)
    try {
      const { error: upErr } = await opts.store
        .from("skill_knowledge")
        .upsert(payload, { onConflict: "skill_id,scope,scope_id,learning_kind,title" })
      if (upErr) {
        // SURFACE the error (the original bug was swallowing it: `if (!upErr) rowsWritten += …`). Stay
        // fail-soft — one skill's write failure must not abort the run — but it can NEVER be invisible.
        console.warn(`[ingest-knowledge] skill_knowledge upsert failed for ${skillId}:`, upErr.message)
        result.writeErrors.push({ skillId, error: upErr.message })
      } else {
        result.rowsWritten += payload.length
      }
    } catch (e) {
      // A thrown transport error (timeout, connection reset) must NOT abort the whole run: catch it,
      // surface it, and continue to the next skill — matching the fail-soft posture of the other writers.
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`[ingest-knowledge] skill_knowledge upsert threw for ${skillId}:`, msg)
      result.writeErrors.push({ skillId, error: msg })
    }
  }

  return result
}

async function updateSourceStatus(
  store: IngestStore,
  sourceId: string,
  patch: { last_fetch: string; last_status: string; reset_failures?: boolean; increment_failures?: boolean },
): Promise<void> {
  // Best-effort: a status-write failure must never abort ingestion (the run already did its real work).
  try {
    const row: Record<string, unknown> = {
      last_fetch: patch.last_fetch,
      last_status: patch.last_status,
      updated_at: patch.last_fetch,
    }
    if (patch.reset_failures) {
      row.failure_count = 0
    } else if (patch.increment_failures) {
      // read-then-write the count (no atomic RPC on the loose surface; a lost race just under-counts,
      // which is harmless for a weekly health signal).
      const { data } = await store.from("skill_source_registry").select("id, failure_count").eq("id", sourceId)
      const current = typeof data?.[0]?.failure_count === "number" ? (data[0].failure_count as number) : 0
      row.failure_count = current + 1
    }
    await store.from("skill_source_registry").update(row).eq("id", sourceId)
  } catch {
    /* best-effort */
  }
}
