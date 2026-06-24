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

const BROWSER_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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

/** Fetch + parse a single source by its strategy. Throws on transport failure (caller catches per
 *  source → increments failure_count; one dead source NEVER breaks the run). */
export async function fetchSourceItems(source: SourceRow, http: HttpFetch): Promise<FetchedItem[]> {
  if (source.authKind !== "none") {
    // (a) key-gated sources are seeded DISABLED; if one is ever enabled without wiring its key, we do
    // NOT silently scrape it — skip with a clear status. (enabled is already checked by the caller.)
    throw new Error(`source ${source.id} requires auth_kind=${source.authKind}; skipped (no key path wired)`)
  }
  const headers = source.fetchStrategy === "scrape-browser-headers" ? BROWSER_HEADERS : undefined
  const res = await http(source.url, headers ? { headers } : undefined)
  if (!res.ok) throw new Error(`http_${res.status}`)
  const text = await res.text()
  if (source.fetchStrategy === "rss") return parseRssItems(text)
  // scrape / scrape-browser-headers / data-api all degrade to the generic text path here (data-api
  // bodies are usually JSON-as-text; the distill model reads them as prose). FULLY implemented: rss +
  // generic http. Per-strategy richer parsers can drop in later without changing the gate.
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
    // Idempotent on the global unique key (skill_id, learning_kind, title): re-running refreshes the
    // snippet/confidence/window in place instead of duplicating.
    const { error: upErr } = await opts.store
      .from("skill_knowledge")
      .upsert(payload, { onConflict: "skill_id,learning_kind,title" })
    if (!upErr) result.rowsWritten += payload.length
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
