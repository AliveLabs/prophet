// ---------------------------------------------------------------------------
// Learning Spine L2 (P17a) — PIPELINE 3: ASK-TICKET QUESTIONS.
//
// The third signal stream. Operators ask questions (lib/ask/history.ts → ask_history); those
// questions reveal what a skill SHOULD address but may not. This pipeline turns recurring, GROUNDED
// questions into skill_knowledge `question_demand` rows for HUMAN review — never a vetted answer.
//
//   NIGHTLY (routing — cheap, deterministic, NO LLM): route each ask to the skill(s) whose domain it
//     touches, reusing domain-map.ts ADJACENT/DOMAIN_PREFIXES + a lightweight keyword classifier over
//     the question + the signals it cited (ask_history.sources). A relevance score below the bar → the
//     ask is dropped for that skill (no billing question polluting food-pairing).
//   WEEKLY (distill — clustering, NO LLM for the GATING; a model may later refine prose): cluster
//     routed, GROUNDED, REPEATED asks per skill into question_demand candidates:
//       (a) COVERAGE GAP — operators repeatedly ask X and the skill never addresses it.
//       (b) FRAMING       — follow-ups reveal the skill's plays omit Y (an `editorial`-kind snippet).
//
// GUARDRAILS (§2.2 P3), all enforced in the PURE policy below:
//   (a) only GROUNDED + REPEATED asks count (ask_history carries grounded+confidence; ungrounded
//       one-offs are noise). A cluster must clear MIN_CLUSTER_SUPPORT distinct grounded asks.
//   (b) relevance threshold — an ask must classify to the skill at/above ROUTE_MIN_RELEVANCE or it's
//       dropped for that skill.
//   (c) MOST CONSERVATIVE — every question_demand row defaults `candidate` and is NEVER auto-promoted.
//       Promotion is the human gate (TicketAdmin). A question reveals DEMAND, not a vetted answer, so
//       it can never become a citable evidenceRef (the loader/prompt-kit grounding rules are untouched).
//
// This module is PURE + deterministic (no DB, no LLM) so it unit-tests without a transport. The
// nightly/weekly runner (ask-mining-run.ts) wires the ask_history reads + skill_knowledge writes.
// ---------------------------------------------------------------------------

import { ADJACENT_DOMAINS } from "@/lib/skills/domain-map"
import { PRODUCER_SKILLS } from "@/lib/skills/registry"

/** A grounded ask, slimmed to exactly what routing + clustering need (mirrors AskRecord). */
export type AskForMining = {
  id: string
  locationId: string
  question: string
  grounded: boolean
  confidence: "high" | "medium" | "low"
  /** the signals the answer cited — short labels like "Reviews", "Competitor: O-Ku", "This week's brief". */
  sources: string[]
  createdAt: string
}

// ── Tunables (the only knobs — kept here so the policy's bar is in one place) ───────────────────────
/** A question must classify to a skill at/above this relevance to route there (guardrail b). */
export const ROUTE_MIN_RELEVANCE = 2
/** A cluster needs at least this many DISTINCT grounded asks to distill into a candidate (guardrail a:
 *  "repeated"). One grounded ask is signal capture, not yet demand. */
export const MIN_CLUSTER_SUPPORT = 3
/** Cap on candidates emitted per skill per weekly run (keep the human review queue sane). */
export const MAX_CANDIDATES_PER_SKILL = 5

// ── (1) ROUTING — keyword classifier over question + cited sources, scored per skill ────────────────
//
// Each producer skill owns a domain (DOMAIN_PREFIXES) + a small bag of plain-language keywords. A
// question scores against a skill by (keyword hits in the question) + (a skill's cited-source hits).
// We reuse ADJACENT_DOMAINS so a question routes ALSO to a skill's adjacent domains at a discounted
// weight — the same cross-domain adjacency the producers use, kept in lockstep.

/** Plain-language keyword bag per DOMAIN (the owning skill id key in DOMAIN_PREFIXES). These are the
 *  words a busy operator actually types — distinct from the internal insight_type prefixes. */
const DOMAIN_KEYWORDS: Record<string, readonly string[]> = {
  operations: ["staff", "staffing", "hours", "open", "close", "wait", "throughput", "line", "rush", "shift", "labor", "prep"],
  marketing: ["social", "instagram", "tiktok", "facebook", "post", "posting", "reel", "ad", "ads", "promo", "promotion", "campaign", "content", "follower"],
  "local-demand": ["event", "events", "weather", "game", "concert", "festival", "busy", "traffic", "demand", "crowd", "tourist", "season"],
  positioning: ["menu", "price", "pricing", "value", "competitor", "compete", "differentiate", "premium", "dish", "item", "offering"],
  reputation: ["review", "reviews", "rating", "star", "stars", "yelp", "google", "complaint", "reputation", "feedback", "respond"],
  // skill-specific domains (their own DOMAIN_PREFIXES key is the skill id, but these skills route via
  // their category keyword bags below if their id isn't a DOMAIN_PREFIXES key).
}

/** Skill-id-specific keyword bags for producers whose id is NOT a DOMAIN_PREFIXES domain key (so they
 *  still get routed). Keyed by skill registry id. */
const SKILL_KEYWORDS: Record<string, readonly string[]> = {
  "food-pairing": ["pair", "pairing", "menu", "dish", "feature", "special", "topping", "flavor", "ingredient", "lto", "limited"],
  "guerrilla-marketing": ["partner", "partnership", "school", "fundraiser", "spirit night", "catering", "sponsor", "community", "neighbor", "grassroots", "local business"],
  "social-counter": ["social", "instagram", "tiktok", "reel", "competitor post", "engagement", "viral", "trending sound", "caption"],
}

// NOTE: in this codebase the registry skill id IS its domain key — DOMAIN_PREFIXES + ADJACENT_DOMAINS
// are both keyed by the owning producer's id (see domain-map.ts). So a skill's domain bag is looked up
// directly by its id (SKILL_KEYWORDS for the specialists, else DOMAIN_KEYWORDS), and adjacency reuses
// the same id keys — no id→domain translation layer is needed.

/** Normalize a string for keyword matching: lowercase, strip punctuation to spaces, collapse runs. */
function norm(s: string): string {
  return ` ${s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()} `
}

/** Count how many of `keywords` appear in the normalized text (each keyword counts once). */
function keywordHits(text: string, keywords: readonly string[]): number {
  let n = 0
  for (const kw of keywords) {
    if (!kw) continue
    // word-ish boundary: surround with spaces (text is space-padded by norm()).
    if (text.includes(` ${kw.toLowerCase()} `) || text.includes(` ${kw.toLowerCase()}`)) n++
  }
  return n
}

/** A routing decision: the skill, the relevance score, and whether the match was direct vs adjacent. */
export type RouteHit = { skillId: string; relevance: number; via: "direct" | "adjacent" }

/**
 * Route ONE grounded ask to the skill(s) it touches, scored by relevance. PURE + deterministic.
 *
 * Scoring (per skill):
 *   - direct keyword hits in the QUESTION (skill bag OR its domain bag) — weight 1 each.
 *   - cited-source hits — a source label that names the skill's domain — weight 1 each (a question
 *     whose ANSWER leaned on reviews routes to reputation even if the wording was oblique).
 *   - adjacency: a skill ALSO accrues a DISCOUNTED (×0.5, floored) signal from its adjacent domains'
 *     direct hits, mirroring the producers' cross-domain peek (domain-map ADJACENT_DOMAINS).
 * A skill is returned only if its relevance >= ROUTE_MIN_RELEVANCE. An UNGROUNDED ask routes nowhere
 * (it's noise — the answer didn't ground in the data).
 */
export function routeAsk(ask: AskForMining, opts: { skillIds?: string[] } = {}): RouteHit[] {
  if (!ask.grounded) return [] // guardrail (a): ungrounded asks are noise — never route them.
  const q = norm(ask.question)
  const sourcesText = norm(ask.sources.join(" "))
  const skillIds = opts.skillIds ?? PRODUCER_SKILLS.map((s) => s.id)

  // Direct score per skill id (the question + cited-source keyword hits for that id's bag). We score
  // the FULL adjacency-reachable id set, not just the requested skillIds, so an adjacent domain's
  // direct hits are available even when that domain's own skill wasn't requested.
  const adjacencyReach = new Set<string>(skillIds)
  for (const id of skillIds) for (const adj of ADJACENT_DOMAINS[id] ?? []) adjacencyReach.add(adj)
  const directById = new Map<string, number>()
  for (const id of adjacencyReach) {
    const bag = SKILL_KEYWORDS[id] ?? DOMAIN_KEYWORDS[id] ?? []
    directById.set(id, keywordHits(q, bag) + keywordHits(sourcesText, bag))
  }

  const hits: RouteHit[] = []
  for (const skillId of skillIds) {
    const direct = directById.get(skillId) ?? 0
    // Adjacency: the discounted sum of this skill's adjacent domains' direct hits.
    const adjacents = ADJACENT_DOMAINS[skillId] ?? []
    const adjacent = adjacents.reduce((s, adj) => s + Math.floor((directById.get(adj) ?? 0) * 0.5), 0)
    const relevance = direct + adjacent
    if (relevance >= ROUTE_MIN_RELEVANCE) {
      hits.push({ skillId, relevance, via: direct >= adjacent ? "direct" : "adjacent" })
    }
  }
  // Strongest relevance first (deterministic), tie-broken by skill id.
  hits.sort((a, b) => b.relevance - a.relevance || a.skillId.localeCompare(b.skillId))
  return hits
}

// ── (2) CLUSTERING + DISTILL — recurring grounded asks → question_demand candidates ─────────────────

/** A routed ask (the nightly routing output, persisted into provenance for the weekly distill). */
export type RoutedAsk = AskForMining & { skillId: string; relevance: number }

/** A question_demand candidate — the skill_knowledge row shape. ALWAYS status `candidate` (human-only
 *  promotion); `kind` distinguishes the two demand types per spec §2.2 P3. */
export type QuestionDemandCandidate = {
  skillId: string
  /** question_demand for a coverage gap; editorial for a framing tweak (tightens the playbook). */
  learningKind: "question_demand" | "editorial"
  demandType: "coverage_gap" | "framing"
  title: string
  snippet: string
  confidence: number
  supportN: number
  /** sample ask ids (provenance only — never citable evidence). */
  sampleAskIds: string[]
  /** the always-conservative status. NEVER active/shadow — the human gate promotes. */
  status: "candidate"
}

/** A tiny, deterministic theme key for a question: its top content tokens (stopwords removed), so
 *  "how do I get more reviews" and "how can I get reviews up" cluster together. Order-independent. */
const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "do", "does", "did", "i", "we", "my", "our", "you", "your", "to", "of",
  "for", "in", "on", "at", "and", "or", "how", "what", "when", "should", "can", "could", "would", "with",
  "get", "got", "make", "more", "any", "this", "that", "it", "be", "have", "has", "about", "from", "by",
  "me", "us", "if", "so", "up", "out", "best", "way", "ways", "good",
])
export function themeKey(question: string): string {
  const tokens = norm(question)
    .trim()
    .split(" ")
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
  // The clustering signature = the sorted set of content tokens (so wording order doesn't matter).
  return [...new Set(tokens)].sort().join(" ")
}

/** A FRAMING ask is one whose ANSWER leaned on the skill's own plays/brief (a follow-up that reveals
 *  the playbook omits something) — heuristic: the cited sources reference "brief"/"recommendation". A
 *  COVERAGE GAP is everything else (the operator asks about the domain but the skill doesn't address
 *  it). This is the deterministic §2.2 P3 (a)/(b) split. */
function classifyDemand(asks: AskForMining[]): "coverage_gap" | "framing" {
  const framingHits = asks.filter((a) =>
    a.sources.some((s) => /brief|recommendation|play|this week/i.test(s)),
  ).length
  return framingHits > asks.length / 2 ? "framing" : "coverage_gap"
}

/**
 * Cluster a skill's routed asks into question_demand candidates. PURE + deterministic.
 *
 *  - groups by themeKey (a recurring question theme);
 *  - guardrail (a): a cluster needs >= MIN_CLUSTER_SUPPORT DISTINCT GROUNDED asks (ungrounded asks
 *    never arrive here — routeAsk already dropped them — but we re-assert grounded defensively);
 *  - classifies coverage_gap vs framing (§2.2 P3 a/b);
 *  - emits a `candidate` row (NEVER shadow/active) with the sample ask ids in provenance.
 * confidence scales with cluster support + the asks' own answer-confidence, capped — but is ADVISORY
 * only (a question_demand never auto-promotes regardless of confidence; the human gate decides).
 */
export function clusterQuestionDemand(skillId: string, routed: RoutedAsk[]): QuestionDemandCandidate[] {
  const grounded = routed.filter((a) => a.grounded)
  const byTheme = new Map<string, RoutedAsk[]>()
  for (const a of grounded) {
    const key = themeKey(a.question)
    if (!key) continue
    const arr = byTheme.get(key) ?? []
    arr.push(a)
    byTheme.set(key, arr)
  }

  const out: QuestionDemandCandidate[] = []
  for (const cluster of byTheme.values()) {
    // distinct asks by id (one operator asking twice still counts as repeated demand, but dedupe rows).
    const distinct = [...new Map(cluster.map((a) => [a.id, a])).values()]
    if (distinct.length < MIN_CLUSTER_SUPPORT) continue // guardrail (a): not repeated enough yet.

    const demandType = classifyDemand(distinct)
    const learningKind: QuestionDemandCandidate["learningKind"] =
      demandType === "framing" ? "editorial" : "question_demand"

    // confidence: a soft, advisory signal (cluster mass + mean answer-confidence). NOT used to
    // auto-promote — question_demand is human-only.
    const confWeight = { high: 1, medium: 0.6, low: 0.3 } as const
    const meanConf = distinct.reduce((s, a) => s + confWeight[a.confidence], 0) / distinct.length
    const confidence = Math.min(90, Math.round(40 + distinct.length * 6 + meanConf * 20))

    // a representative verbatim question (the most recent) — for the human reviewer to read.
    const rep = [...distinct].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]
    const repQ = rep.question.trim().replace(/\s+/g, " ").slice(0, 160)

    const snippet =
      demandType === "coverage_gap"
        ? `Operators repeatedly ask about this and the playbook may not address it: "${repQ}" (${distinct.length} grounded asks). COVERAGE GAP — consider adding a play/angle that answers it. Human review required before this informs the prompt.`.slice(0, 600)
        : `Follow-up questions suggest the plays here under-explain "${repQ}" (${distinct.length} grounded asks). FRAMING — tighten the playbook to address it up front. Human review required before this informs the prompt.`.slice(0, 600)

    out.push({
      skillId,
      learningKind,
      demandType,
      title: `ask: ${themeKey(repQ).slice(0, 64) || repQ.slice(0, 64)}`.slice(0, 80),
      snippet,
      confidence,
      supportN: distinct.length,
      sampleAskIds: distinct.map((a) => a.id).slice(0, 10),
      status: "candidate", // NEVER auto-promoted — the human gate.
    })
  }

  // Strongest demand first; cap the per-skill queue.
  out.sort((a, b) => b.supportN - a.supportN || a.title.localeCompare(b.title))
  return out.slice(0, MAX_CANDIDATES_PER_SKILL)
}
