// ---------------------------------------------------------------------------
// Domain adjacency map (P5) — the CHEAPER half of cross-domain convergence.
//
// The convergence skill (lib/skills/convergence/skill.ts) is the expensive half:
// it sees the WHOLE dossier on the deep (Opus + thinking) pass to find patterns no
// single-domain skill can. This map is the cheap half: it lets each EXISTING domain
// skill peek at a SMALL, capped slice of signals from a few ADJACENT domains, so a
// domain expert can notice a same-direction signal next door without paying for a
// whole-dossier deep pass. (Plan: "existing skills can also overlap adjacent domains
// (the cheaper half of convergence)".)
//
// Kept deliberately NARROW (plan risk note: "start ADJACENT_DOMAINS narrow to avoid
// low-signal patterns"). Each edge is a pairing where one domain's signal genuinely
// changes how the other should act — not "everything touches everything."
//
// The selection is grounded: every signal handed back is a real `d.ruleOutputs`
// entry (its `insight_type` is in the dossier ref index), so a skill that cites an
// adjacent signal still passes grounding enforcement. The helper NEVER fabricates.
// ---------------------------------------------------------------------------

import type { Dossier } from "@/lib/insights/dossier/types"
import type { GeneratedInsight } from "@/lib/insights/types"

// The grounded-signal domains, keyed by the OWNING producer skill id. The prefixes
// mirror each skill's own `isXInsight()` selector so adjacency stays in lockstep with
// what each skill already claims as its home turf — change a skill's prefixes and you
// update them here too. (These are `insight_type` PREFIXES, matched with startsWith.)
export const DOMAIN_PREFIXES: Record<string, readonly string[]> = {
  operations: ["traffic.", "hours"],
  marketing: ["social."],
  "local-demand": ["events.", "weather", "visual.weather", "cross_event"],
  // positioning@v4: seo_competitor_* ceded to marketing's competitor-move family; photo.price_change
  // added as a shared corroboration read (marketing runs the conquest campaign, positioning moves the
  // comparison set). Lockstep with the skill's own intake predicates.
  positioning: ["menu.", "content.", "photo.price_change"],
  reputation: ["rating", "review"],
}

// Which domains each skill may borrow a few signals from. Directional and narrow:
// the edge exists only where the adjacent domain's signal should change THIS skill's
// move. Edges are intentionally NOT all symmetric (e.g. operations cares about demand
// spikes; demand doesn't need staffing rules back).
//
//  - operations  ← demand (a demand spike is the reason to staff up)
//  - local-demand ← operations + reputation (own throughput limits + "slow when busy"
//                   reviews change whether a demand spike is opportunity or risk)
//  - marketing    ← demand + reputation (what's happening locally + how guests talk)
//  - positioning  ← reputation (guests must actually flag price/value before you move)
//  - reputation   ← operations (throughput/wait problems are what bad reviews are about)
export const ADJACENT_DOMAINS: Record<string, readonly string[]> = {
  operations: ["local-demand"],
  "local-demand": ["operations", "reputation"],
  marketing: ["local-demand", "reputation"],
  positioning: ["reputation"],
  reputation: ["operations"],
}

/** A trimmed signal shape — enough for a skill to reason about an adjacent cue without
 *  bloating the prompt. Mirrors the slimming the convergence skill does. */
export type AdjacentSignal = {
  domain: string // the owning skill id, e.g. "reputation"
  insight_type: string
  title: string
  summary: string
}

function matchesDomain(insightType: string, domain: string): boolean {
  const prefixes = DOMAIN_PREFIXES[domain]
  if (!prefixes) return false
  return prefixes.some((p) => insightType.startsWith(p))
}

/**
 * Select a SMALL, capped, grounded slice of signals from the domains adjacent to
 * `skillId`, for that skill to optionally fold into its prompt input.
 *
 * Design / guarantees:
 *  - Returns ONLY real `d.ruleOutputs` entries (so anything cited stays grounded).
 *  - Round-robins across the adjacent domains so the cap can't starve a whole domain
 *    (one signal from each adjacent domain per pass until `cap` is hit).
 *  - Unknown / absent skillId → `[]` (graceful: an unmapped skill simply gets no
 *    adjacency and behaves exactly as before — no regression).
 *  - Unknown adjacent domain names are skipped silently.
 *  - `cap <= 0` → `[]`.
 */
export function selectAdjacentSignals(d: Dossier, skillId: string, cap = 4): AdjacentSignal[] {
  if (cap <= 0) return []
  const adjacents = ADJACENT_DOMAINS[skillId]
  if (!adjacents || adjacents.length === 0) return []

  // Bucket the dossier's grounded signals by adjacent domain (skipping unknown domains).
  const buckets: Array<{ domain: string; signals: GeneratedInsight[] }> = []
  for (const domain of adjacents) {
    if (!DOMAIN_PREFIXES[domain]) continue // unknown domain name — skip gracefully
    const signals = d.ruleOutputs.filter((i) => matchesDomain(i.insight_type, domain))
    if (signals.length > 0) buckets.push({ domain, signals })
  }
  if (buckets.length === 0) return []

  // Round-robin so each adjacent domain is represented before any gets seconds.
  const out: AdjacentSignal[] = []
  for (let round = 0; out.length < cap; round++) {
    let added = false
    for (const { domain, signals } of buckets) {
      if (round < signals.length) {
        const s = signals[round]
        out.push({ domain, insight_type: s.insight_type, title: s.title, summary: s.summary })
        added = true
        if (out.length >= cap) break
      }
    }
    if (!added) break // every bucket exhausted
  }
  return out
}
