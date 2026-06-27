// ---------------------------------------------------------------------------
// Learning Spine L0 (P14) — the knowledge loader (behavior-update channel 1: KNOWLEDGE/PROMPT).
//
// Reads ACTIVE skill_knowledge snippets for a (skill, org, location) and hands them to prompt-kit
// for injection. The static `knowledge` prose on each ProducerSkill is the BASE/FLOOR; these rows
// are DYNAMIC, gated learnings layered on top. NOTHING here can relax grounding — trends INFORM,
// never OVERRIDE (the injected block + the closed allowedEvidenceRefs set enforce that).
//
// FAIL-SOFT IS THE WHOLE POINT: every read returns empty on ANY error — the table not existing
// (pre-migration), a network blip, malformed rows — so a learning-system outage can NEVER break a
// morning brief. The floor when this returns empty is EXACTLY today's behavior. Mirrors the
// loose-typed-client + try/catch→empty pattern of preferences.ts / ask/history.ts / evergreen.ts.
//
// CACHE DISCIPLINE: snippets are split GLOBAL vs SCOPED. Global snippets change ≤1×/week and ride
// INSIDE the byte-identical systemCached prefix (the shared 13-location morning cache). Org/location
// snippets go AFTER the cache breakpoint in `system`, so per-location learnings never bust the prefix.
// In-memory 1h TTL cache keeps the weekly-stable global set cheap to re-read across the morning batch.
// ---------------------------------------------------------------------------

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database.types"

/** One active, distilled snippet ready for prompt injection. */
export type KnowledgeSnippet = {
  id: string
  skillId: string
  scope: "global" | "org" | "location"
  scopeId: string | null
  learningKind: "external_trend" | "feedback_pattern" | "question_demand" | "editorial"
  title: string
  snippet: string
  confidence: number
}

/** The split a prompt build needs: global snippets ride the cached prefix; scoped snippets ride the
 *  volatile `system` block. `version` is the short hash of the GLOBAL set only — it must be part of
 *  the systemCached cache key, and scoped snippets must NOT perturb it (else they'd bust the prefix). */
export type KnowledgeInjection = {
  global: KnowledgeSnippet[]
  scoped: KnowledgeSnippet[]
  /** Short content hash of the GLOBAL active snippet set (stable across locations within a week). */
  globalVersion: string
}

export type KnowledgeScope = {
  organizationId?: string | null
  locationId?: string | null
}

/** The learning_kinds this skill DECLARES it accepts into its prompt (skill.learning.acceptedLearningKinds).
 *  A kind not in this set is NEVER injected for this skill, even if an active row exists — defense in depth
 *  alongside the per-skill scope (spec §2.5 / §2.3). `undefined` = no declared filter ⇒ accept all kinds
 *  (back-compat: a skill with no learning hook behaves exactly as today). */
type AcceptedKinds = readonly KnowledgeSnippet["learningKind"][] | undefined

// skill_knowledge is now in the generated types, so this is the real typed client (aliased for the
// injectable test client + the cron's admin client).
type KnowledgeStore = SupabaseClient<Database>

function store(client?: KnowledgeStore): KnowledgeStore {
  return client ?? createAdminSupabaseClient()
}

// ── In-memory cache (1h TTL) — keyed by skill+org+location. The global set is weekly-stable, so the
//    cache is overwhelmingly hit during the morning batch. Cache is per-process (best-effort); a cold
//    process simply re-reads. ───────────────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 60 * 60 * 1000 // 1h
type CacheEntry = { at: number; value: KnowledgeInjection }
const cache = new Map<string, CacheEntry>()

function cacheKey(skillId: string, scope: KnowledgeScope, acceptedKinds: AcceptedKinds): string {
  // acceptedKinds is a static property of a skill, but key on it anyway so a cached value always
  // reflects the exact filter that produced it (never serve an unfiltered set under a filtered call).
  const kinds = acceptedKinds ? [...acceptedKinds].sort().join(",") : "*"
  return `${skillId}::${scope.organizationId ?? ""}::${scope.locationId ?? ""}::${kinds}`
}

/** Test/ops hook — drop the in-memory cache (the cron + tests call this). */
export function clearKnowledgeCache(): void {
  cache.clear()
}

const ACTIVE_KINDS = new Set(["external_trend", "feedback_pattern", "question_demand", "editorial"])
const SCOPES = new Set(["global", "org", "location"])

function toSnippet(r: Record<string, unknown>): KnowledgeSnippet | null {
  const snippet = typeof r.snippet === "string" ? r.snippet.trim() : ""
  const title = typeof r.title === "string" ? r.title.trim() : ""
  const scope = String(r.scope ?? "")
  const learningKind = String(r.learning_kind ?? "")
  // Defensive: a malformed row must be DROPPED, never injected — an empty snippet would only add
  // noise, and an unknown kind/scope shouldn't reach a prompt.
  if (!snippet || !title || !SCOPES.has(scope) || !ACTIVE_KINDS.has(learningKind)) return null
  return {
    id: String(r.id ?? ""),
    skillId: String(r.skill_id ?? ""),
    scope: scope as KnowledgeSnippet["scope"],
    scopeId: r.scope_id == null ? null : String(r.scope_id),
    learningKind: learningKind as KnowledgeSnippet["learningKind"],
    title,
    snippet,
    confidence: typeof r.confidence === "number" ? r.confidence : 0,
  }
}

/** djb2 — a tiny, deterministic, dependency-free string hash. Base36, 8 chars. Used only to fingerprint
 *  the active snippet set into effectiveKnowledgeVersion (NOT security-sensitive). */
function shortHash(input: string): string {
  let h = 5381
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i)
  }
  // >>> 0 → unsigned; pad so the tag width is stable.
  return (h >>> 0).toString(36).padStart(7, "0").slice(0, 7)
}

/** A stable fingerprint of a snippet set, order-independent (ids sorted) so the hash doesn't flip on
 *  row-ordering. Empty set → empty string (callers treat empty as "omit the block"). */
function fingerprint(snippets: KnowledgeSnippet[]): string {
  if (snippets.length === 0) return ""
  return shortHash(
    snippets
      .map((s) => s.id)
      .sort()
      .join("|"),
  )
}

/**
 * Load the ACTIVE skill_knowledge snippets for a skill, split into the GLOBAL set (rides the cached
 * prefix) and the SCOPED set (org + this location; rides the volatile system block). Active-window
 * filtering (effective_from/effective_to) is applied client-side so a stale trend self-retires even
 * if a sweep hasn't run.
 *
 * acceptedKinds (spec §2.5 / §2.3): the skill's DECLARED acceptedLearningKinds. A learning_kind NOT
 * in this set is dropped here and never injected for this skill, even if an active row exists — a
 * defense-in-depth gate on top of the per-skill scope. `undefined` ⇒ no declared filter ⇒ accept all
 * kinds (a skill with no learning hook behaves exactly as today).
 *
 * FAIL-SOFT: returns an EMPTY injection on ANY error — the floor is today.
 */
export async function loadActiveKnowledge(
  skillId: string,
  scope: KnowledgeScope = {},
  opts: { client?: KnowledgeStore; nowMs?: number; bypassCache?: boolean; acceptedKinds?: AcceptedKinds } = {},
): Promise<KnowledgeInjection> {
  const empty: KnowledgeInjection = { global: [], scoped: [], globalVersion: "" }
  const now = opts.nowMs ?? Date.now()
  const acceptedKinds = opts.acceptedKinds
  // A declared-but-EMPTY acceptedKinds means the skill accepts nothing → inject nothing (the floor).
  const accepts = (kind: KnowledgeSnippet["learningKind"]): boolean =>
    acceptedKinds === undefined || acceptedKinds.includes(kind)
  const key = cacheKey(skillId, scope, acceptedKinds)

  if (!opts.bypassCache && !opts.client) {
    const hit = cache.get(key)
    if (hit && now - hit.at < CACHE_TTL_MS) return hit.value
  }

  try {
    // Fetch ALL active rows for this skill, then partition by scope client-side. We constrain to the
    // scopes that could possibly apply: global (always) + this org + this location. The loose query
    // surface only chains eq/eq/in, so we filter status='active' + skill_id server-side and the
    // scope/window client-side (cheap — active rows per skill are few).
    const { data, error } = await store(opts.client)
      .from("skill_knowledge")
      .select("id, skill_id, scope, scope_id, learning_kind, title, snippet, confidence, effective_from, effective_to")
      .eq("skill_id", skillId)
      .eq("status", "active")
      .in("scope", ["global", "org", "location"])
    if (error) return empty

    const inWindow = (r: Record<string, unknown>): boolean => {
      const from = r.effective_from ? Date.parse(String(r.effective_from)) : Number.NEGATIVE_INFINITY
      const to = r.effective_to ? Date.parse(String(r.effective_to)) : Number.POSITIVE_INFINITY
      const f = Number.isNaN(from) ? Number.NEGATIVE_INFINITY : from
      const t = Number.isNaN(to) ? Number.POSITIVE_INFINITY : to
      return now >= f && now <= t
    }

    const rows = (data ?? []).filter(inWindow)
    const global: KnowledgeSnippet[] = []
    const scoped: KnowledgeSnippet[] = []
    for (const r of rows) {
      const s = toSnippet(r)
      if (!s) continue
      // Defense in depth (§2.5/§2.3): a kind the skill didn't declare is NEVER injected, regardless
      // of scope/window/status — drop it before it reaches global or scoped.
      if (!accepts(s.learningKind)) continue
      if (s.scope === "global") {
        global.push(s)
      } else if (s.scope === "org" && scope.organizationId && s.scopeId === scope.organizationId) {
        scoped.push(s)
      } else if (s.scope === "location" && scope.locationId && s.scopeId === scope.locationId) {
        scoped.push(s)
      }
      // any other scoped row (a different org/location) is silently ignored — defense in depth on
      // top of RLS, since the cron writes via the service role.
    }

    // Deterministic ordering: highest confidence first, then title — so the injected block (and its
    // fingerprint) are stable across builds regardless of DB row order.
    const byConf = (a: KnowledgeSnippet, b: KnowledgeSnippet) =>
      b.confidence - a.confidence || a.title.localeCompare(b.title)
    global.sort(byConf)
    scoped.sort(byConf)

    const value: KnowledgeInjection = { global, scoped, globalVersion: fingerprint(global) }
    if (!opts.client) cache.set(key, { at: now, value })
    return value
  } catch {
    return empty
  }
}

/**
 * Learning Spine L3 (P17a) — SHADOW reader. Loads the SHADOW-status snippets for a skill (the same
 * shape + window filter as loadActiveKnowledge, but status='shadow'). Shadow rows NEVER reach the
 * served prompt — they exist only so shadow-mode instrumentation (lib/skills/shadow.ts) can COMPUTE
 * what they WOULD do and LOG it. Same fail-soft posture: EMPTY on any error / absent table.
 *
 * The `status` param defaults to "shadow" but is parameterized so the active reader can share this
 * core; the public loadActiveKnowledge keeps its own historic signature for back-compat.
 */
export async function loadShadowKnowledge(
  skillId: string,
  scope: KnowledgeScope = {},
  opts: { client?: KnowledgeStore; nowMs?: number; acceptedKinds?: AcceptedKinds } = {},
): Promise<KnowledgeInjection> {
  const empty: KnowledgeInjection = { global: [], scoped: [], globalVersion: "" }
  const now = opts.nowMs ?? Date.now()
  const acceptedKinds = opts.acceptedKinds
  const accepts = (kind: KnowledgeSnippet["learningKind"]): boolean =>
    acceptedKinds === undefined || acceptedKinds.includes(kind)

  try {
    const { data, error } = await store(opts.client)
      .from("skill_knowledge")
      .select("id, skill_id, scope, scope_id, learning_kind, title, snippet, confidence, effective_from, effective_to")
      .eq("skill_id", skillId)
      .eq("status", "shadow")
      .in("scope", ["global", "org", "location"])
    if (error) return empty

    const inWindow = (r: Record<string, unknown>): boolean => {
      const from = r.effective_from ? Date.parse(String(r.effective_from)) : Number.NEGATIVE_INFINITY
      const to = r.effective_to ? Date.parse(String(r.effective_to)) : Number.POSITIVE_INFINITY
      const f = Number.isNaN(from) ? Number.NEGATIVE_INFINITY : from
      const t = Number.isNaN(to) ? Number.POSITIVE_INFINITY : to
      return now >= f && now <= t
    }

    const global: KnowledgeSnippet[] = []
    const scoped: KnowledgeSnippet[] = []
    for (const r of (data ?? []).filter(inWindow)) {
      const s = toSnippet(r)
      if (!s || !accepts(s.learningKind)) continue
      if (s.scope === "global") global.push(s)
      else if (s.scope === "org" && scope.organizationId && s.scopeId === scope.organizationId) scoped.push(s)
      else if (s.scope === "location" && scope.locationId && s.scopeId === scope.locationId) scoped.push(s)
    }
    const byConf = (a: KnowledgeSnippet, b: KnowledgeSnippet) =>
      b.confidence - a.confidence || a.title.localeCompare(b.title)
    global.sort(byConf)
    scoped.sort(byConf)
    return { global, scoped, globalVersion: fingerprint(global) }
  } catch {
    return empty
  }
}

/**
 * effectiveKnowledgeVersion = the skill's BASE knowledgeVersion + a short hash of the active GLOBAL
 * snippet set. This is the value stamped onto plays AND the cache key for the cached prefix:
 *   - EMPTY global set → returns the base version UNCHANGED (so an empty table is byte-identical to
 *     today, and the cache key is identical to today).
 *   - non-empty       → `${base}+f<hash>` (e.g. `food-pairing@v1+fa3c9b1`).
 * Only the GLOBAL set perturbs this — scoped snippets ride the volatile block and MUST NOT change the
 * shared cache key (else per-location learnings would bust the 13-location morning prefix cache).
 */
export function effectiveKnowledgeVersion(baseVersion: string, injection: KnowledgeInjection): string {
  if (!injection.globalVersion) return baseVersion
  return `${baseVersion}+f${injection.globalVersion}`
}
