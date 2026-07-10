// ---------------------------------------------------------------------------
// Competitor discovery core — identity-aware candidate ranking.
//
// The old onboarding discovery asked a grounded LLM for "competitors" without
// ever telling it WHO the target business is (the keyword mush went in as the
// business name), then ranked candidates distance-first. Result: a French
// bakery-café got steakhouses and cocktail bars as "Same cuisine" competitors.
//
// New shape (probe-validated on the la Madeleine Dallas case, 2026-07-10):
//   1. RECALL  — Places searchNearby tiled over type families (fast, complete,
//                real place IDs; ~300ms for a 100+ pool).
//   2. IDENTITY — the target's own Places details (editorialSummary, serves*,
//                priceLevel) describe what it actually is. primaryType alone is
//                useless ("restaurant").
//   3. PRECISION — one Sonnet call scores every candidate 0-100 on "would the
//                operator consider this a direct competitor" with a plain-
//                language reason. Fail-soft: on any model failure the caller
//                falls back to the heuristic score, never to a hard error.
//
// Pure helpers only — no fetch/DB here, so every rule is unit-testable.
// ---------------------------------------------------------------------------

import type { DiscoveredCompetitor } from "@/lib/places/google"
import type { GooglePlaceDetailsResponse } from "@/lib/places/google"
import { EM_DASH, CHEF_LINGO } from "@/lib/eval/voice-rules"

/** Everything the ranker knows about the target business. */
export type TargetIdentity = {
  name: string
  /** Human-ish category ("french restaurant", "bakery") — generic "restaurant" is fine, the
   *  editorial line carries the real identity. */
  category: string | null
  /** Google's editorial one-liner — the highest-signal identity field we have
   *  (e.g. "Quaint French cafe chain serving rustic country fare, espresso & fresh-baked baguettes"). */
  editorial: string | null
  serves: string[]
  priceLevel: string | null
}

export function buildTargetIdentity(
  name: string,
  details: GooglePlaceDetailsResponse | null,
  fallbackCategory: string | null
): TargetIdentity {
  const serves: string[] = []
  if (details?.servesBreakfast) serves.push("breakfast")
  if (details?.servesBrunch) serves.push("brunch")
  if (details?.servesLunch) serves.push("lunch")
  if (details?.servesDinner) serves.push("dinner")
  return {
    name: details?.displayName?.text || name,
    category: (details?.primaryType ?? fallbackCategory)?.replace(/_/g, " ") ?? null,
    editorial: details?.editorialSummary?.text ?? null,
    serves,
    priceLevel: details?.priceLevel ?? null,
  }
}

// Tile groups for the restaurant vertical. searchNearby ranks by distance WITHIN one
// call (cap 20), so popular generic types would crowd out specific ones in a single
// query — tiling keeps recall on bakeries/cafés/breakfast spots even in dense areas.
export const RESTAURANT_TYPE_TILES: string[][] = [
  ["restaurant"],
  ["bakery"],
  ["cafe", "coffee_shop"],
  ["breakfast_restaurant", "brunch_restaurant"],
  ["sandwich_shop", "deli"],
  ["fast_food_restaurant"],
  ["bar"],
]

/** Which searchNearby type tiles to sweep for a vertical's discovery pool. */
export function discoveryTypeTiles(placesApiType: string | undefined): string[][] {
  if (!placesApiType || placesApiType === "restaurant") return RESTAURANT_TYPE_TILES
  return [[placesApiType]]
}

/** Pool radius. Wide on purpose — recall is the pool's job, precision is the ranker's.
 *  rankPreference=DISTANCE caps each tile at its 20 nearest, so density self-limits. */
export const DISCOVERY_RADIUS_METERS = 8000

/** Pool cap fed to the ranker (nearest first). Keeps the prompt small and the call fast. */
export const RERANK_POOL_CAP = 80

/** Candidates the model scores below this are dropped outright (not competitors). */
export const RERANK_VETO_BELOW = 40

/** How many ranked candidates we persist as onboarding suggestions. */
export const DISCOVERY_KEEP = 12

export type RerankEntry = { score: number; why: string | null }

export function buildRerankPrompt(
  identity: TargetIdentity,
  pool: DiscoveredCompetitor[]
): string {
  const target = [
    `TARGET: ${identity.name}`,
    identity.editorial ? `— ${identity.editorial}` : null,
    identity.category ? `Category: ${identity.category}.` : null,
    identity.serves.length ? `Serves: ${identity.serves.join(", ")}.` : null,
    identity.priceLevel
      ? `Price: ${identity.priceLevel.replace("PRICE_LEVEL_", "").toLowerCase()}.`
      : null,
  ]
    .filter(Boolean)
    .join(" ")

  const lines = pool.map(
    (c, i) =>
      `${i} | ${c.name} | ${(c.primaryType ?? "unknown").replace(/_/g, " ")} | ${
        c.distanceMeters ?? "?"
      }m | ${c.rating ?? "?"}★ (${c.reviewCount ?? 0} reviews) | ${
        c.priceLevel?.replace("PRICE_LEVEL_", "").toLowerCase() ?? "?"
      }`
  )

  return [
    "You are helping a local business owner pick which nearby businesses to track as competitors.",
    target,
    "",
    "Below is a list of nearby businesses (index | name | type | distance | rating | price).",
    "Score each 0-100: would the owner of the TARGET consider it a direct competitor — a place their regular customer would realistically pick INSTEAD for the same occasion, food style, service model, and price tier?",
    "Chains and independents both count. Being close is not enough: a different-occasion spot (say a late-night bar or a fine-dining steakhouse next to a bakery-café) is NOT a direct competitor even at 100m.",
    "Other locations of the target's own brand are NOT competitors: score them 0.",
    'For every candidate scoring 55 or higher, add "why": one short sentence the owner would nod at. Write it plainly, like you would say it to them over coffee.',
    'Hard rules for "why": everyday words only; no industry jargon (never say daypart, foot traffic, positioning, price point, fast-casual, service model); no scores or rankings; no em dashes.',
    'Respond with ONLY this JSON, covering every index: {"rankings":[{"i":0,"score":72,"why":"..."}, …]} (omit "why" when the score is under 55).',
    "",
    lines.join("\n"),
  ].join("\n")
}

/** Validate + clamp a raw model response into index → {score, why}. Returns null when the
 *  payload is unusable (caller then falls back to heuristic ranking). Individually bad
 *  entries are skipped, not fatal. */
export function parseRerank(raw: unknown, poolSize: number): Map<number, RerankEntry> | null {
  if (!raw || typeof raw !== "object") return null
  const rankings = (raw as { rankings?: unknown }).rankings
  if (!Array.isArray(rankings) || rankings.length === 0) return null
  const out = new Map<number, RerankEntry>()
  for (const entry of rankings) {
    if (!entry || typeof entry !== "object") continue
    const i = (entry as { i?: unknown }).i
    const score = (entry as { score?: unknown }).score
    if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= poolSize) continue
    if (typeof score !== "number" || !Number.isFinite(score)) continue
    const why = (entry as { why?: unknown }).why
    out.set(i, {
      score: Math.max(0, Math.min(100, Math.round(score))),
      why: typeof why === "string" && why.trim() ? why.trim() : null,
    })
  }
  // A response covering under half the pool ranks candidates against missing rivals —
  // unreliable; better to fall back to heuristics entirely.
  if (out.size < Math.ceil(poolSize / 2)) return null
  return out
}

/** Voice-gate a model-written "why" before it becomes customer-facing copy.
 *  Em/en dashes are rewritten; chef-lingo (or over-long copy) rejects the line —
 *  the UI then falls back to its own deterministic why. */
export function sanitizeWhy(why: string | null): string | null {
  if (!why) return null
  let cleaned = why.trim().replace(new RegExp(EM_DASH.source, "g"), ", ")
  cleaned = cleaned.replace(/\s+/g, " ").replace(/\s,/g, ",")
  if (!cleaned || cleaned.length > 160) return null
  if (CHEF_LINGO.some(({ term }) => term.test(cleaned))) return null
  return cleaned
}
