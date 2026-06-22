// ---------------------------------------------------------------------------
// Play fusion (P6.5) — merge near-duplicate plays instead of dropping one.
//
// Two skills can produce a play on the SAME signal from different lenses (e.g. the
// marketing skill and the grassroots skill both act on `social.behind_scenes_opportunity`).
// Those aren't duplicates to discard — they're two angles on one moment. This step
// DETECTS candidate near-dup clusters (same play kind + same lead evidence) and asks a
// model to FUSE each into a single richer play — but only when the plays are genuinely the
// SAME opportunity. Safeguards against a worse/diluted play shipping:
//   - clustering is a CANDIDATE generator; the model is the merge decision (conservative —
//     default keepSeparate, fuse only when clearly one opportunity).
//   - convergence (P5) plays are NEVER fused (they're already a cross-lens synthesis).
//   - the fused play cites the UNION of inputs' (already-grounded) refs, and a runtime guard
//     rejects any fused narrative that invents a number no input had → deterministic keep-best.
//   - on any model failure → keep-best (the cluster's strongest play). Never drops a play.
//
// Runs as a pre-ranking step in synthesize(). Cost = one cheap reasoning call PER fusable
// cluster (usually 0). clusterPlays() is PURE (unit-tested); fuseNearDuplicates() does I/O.
// ---------------------------------------------------------------------------

import { generateStructured, type Transport } from "@/lib/ai/provider"
import type { Dossier } from "@/lib/insights/dossier/types"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import { coerceEnrichedPlays } from "@/lib/skills/prompt-kit"
import { dedupeRefs } from "@/lib/skills/evidence-format"
import { extractNumbers } from "@/lib/eval/checks"

export type FuseOptions = {
  transport?: Transport
  /** Used by the deterministic keep-best fallback to pick the cluster's strongest play. */
  scoreOf: (p: EnrichedRecommendation) => number
}

/** Cluster key: same play SHAPE (kind) + same LEAD evidence base. Plays sharing it are candidate
 *  near-duplicates from different lenses. Returns null (→ never clusters) for:
 *  - convergence plays — they're already a cross-lens synthesis; re-fusing would dilute/relabel them.
 *  - ungrounded plays — no evidence to cluster on.
 *  The lead is the SORTED-first deduped ref, so the key is independent of model ref ordering. */
function clusterKey(p: EnrichedRecommendation): string | null {
  if (p.skillId === "convergence") return null
  const refs = dedupeRefs(p.evidenceRefs ?? [])
  if (refs.length === 0) return null
  const leadBase = [...refs].sort()[0]
  return `${p.kind}|${leadBase}`
}

/** PURE, order-stable: split plays into FUSABLE clusters (≥2 plays from ≥2 DISTINCT skills, same key)
 *  and singletons. Same-skill repeats are NOT fused — the target is cross-lens overlap. */
export function clusterPlays(plays: EnrichedRecommendation[]): {
  clusters: EnrichedRecommendation[][]
  singletons: EnrichedRecommendation[]
} {
  const groups = new Map<string, EnrichedRecommendation[]>()
  const order: string[] = []
  const singletons: EnrichedRecommendation[] = []
  for (const p of plays) {
    const k = clusterKey(p)
    if (k == null) {
      singletons.push(p)
      continue
    }
    const g = groups.get(k)
    if (g) g.push(p)
    else {
      groups.set(k, [p])
      order.push(k)
    }
  }
  const clusters: EnrichedRecommendation[][] = []
  for (const k of order) {
    const g = groups.get(k)!
    const distinctSkills = new Set(g.map((p) => p.skillId)).size
    if (g.length >= 2 && distinctSkills >= 2) clusters.push(g)
    else for (const p of g) singletons.push(p)
  }
  return { clusters, singletons }
}

/** All narrative text of a play, for the anti-fabrication numeric guard. */
function playText(p: EnrichedRecommendation): string {
  const steps = (p.recipe ?? []).flatMap((s) => [s.channel, s.audience, s.window?.note, s.offer, s.copy, s.creativeDirection])
  return [p.title, p.rationale, ...steps].filter(Boolean).join(" ")
}

const FUSE_SYSTEM = [
  "You decide whether two or more restaurant action plays — produced by different expert lenses for the",
  "SAME underlying signal — are really the SAME opportunity (then merge into ONE richer play), or are",
  "genuinely DIFFERENT actions that merely cite the same signal (then keep them apart).",
  "",
  "DEFAULT TO keepSeparate. Merge ONLY when a busy operator would run them as a single task — the same",
  "opportunity seen through two lenses. If the plays target different subjects, events, items, dishes, or",
  "audiences — even when they cite the same signal type — they are DIFFERENT actions: keep them separate.",
  "",
  "Return JSON, exactly one of:",
  '  { "keepSeparate": true }                 // the safe default — genuinely distinct actions',
  '  { "play": { ...one merged play... } }    // ONLY when the plays are clearly one opportunity',
  "",
  "The merged play object:",
  '  { "title": string (plain, the combined action), "rationale": string (why, in plain words),',
  '    "kind": keep the shared kind, "ownerRole": one of owner|gm|marketing|kitchen|foh,',
  '    "confidence": one of high|medium|directional, "recipe": [ {"channel","platforms":[],"audience",',
  '    "window":{"note"},"offer"?,"copy"?,"creativeDirection"?,"dependencies"?:[]} ],',
  '    "leverage": {"label": high|medium|low, "basisInternal": string} }',
  "",
  "RULES: keep the recipe operator-executable; merge only what is redundant, preserving each distinct",
  "channel/step. NEVER invent a number — state only figures that appear in the input plays. Plain language",
  "(Ticket's voice), no em dashes, no chef jargon.",
].join("\n")

/** Fuse one near-dup cluster into a single play (or keep it split). Deterministic keep-best on failure. */
async function fuseCluster(
  cluster: EnrichedRecommendation[],
  d: Dossier,
  opts: FuseOptions,
): Promise<EnrichedRecommendation[]> {
  const best = cluster.reduce((a, b) => (opts.scoreOf(b) > opts.scoreOf(a) ? b : a))
  const unionRefs = Array.from(new Set(cluster.flatMap((p) => p.evidenceRefs ?? [])))
  // Keep-best preserves the dominant play, annotated with the cluster's full evidence union so
  // provenance + the ground-filter still reflect every merged signal. (Its narrative recipe is the
  // dominant play's; the other lens's recipe is not carried on this fallback path.)
  const keepBest = (): EnrichedRecommendation[] => [{ ...best, evidenceRefs: unionRefs }]
  // Numbers present anywhere in the inputs — the only figures a fused play may legitimately state.
  const inputNums = new Set(cluster.flatMap((p) => extractNumbers(playText(p))))

  const prompt = JSON.stringify(
    {
      restaurant: { name: d.profile.name, attributes: d.profile.attributes, voiceTone: d.profile.voiceTone },
      plays: cluster.map((p) => ({
        lens: p.skillId,
        title: p.title,
        rationale: p.rationale,
        kind: p.kind,
        ownerRole: p.ownerRole,
        confidence: p.confidence,
        recipe: p.recipe,
        leverage: p.leverage,
        evidenceRefs: p.evidenceRefs,
      })),
      allowedEvidenceRefs: unionRefs,
    },
    null,
    2,
  )

  type FuseOutcome = { mode: "fused"; play: EnrichedRecommendation } | { mode: "separate" } | { mode: "keep-best" }

  const outcome = await generateStructured<FuseOutcome>(
    // Base reasoning tier (Sonnet + adaptive thinking, medium) — fusion is a bounded merge, not the
    // whole-dossier convergence pass; the keep-best fallback makes a cheaper model safe.
    { tier: "reasoning", system: FUSE_SYSTEM, prompt, thinking: true, effort: "medium", maxOutputTokens: 4000 },
    {
      transport: opts.transport,
      validate: (raw): FuseOutcome | null => {
        const r = (raw ?? {}) as { keepSeparate?: unknown; play?: unknown }
        if (r.keepSeparate === true) return { mode: "separate" }
        const coerced = coerceEnrichedPlays(r.play ? [r.play] : raw, {
          skillId: best.skillId,
          knowledgeVersion: "fusion@v1",
          defaultKind: best.kind,
          defaultOwner: best.ownerRole,
        })
        const merged = coerced?.[0]
        if (!merged) return null // unparseable / no recipe -> deterministic fallback
        // The fused play adopts the dominant play's identity (kind, skillId → its category/prior, and
        // its confidence/leverage so a weak lens can't inflate rank), cites the evidence UNION, and is
        // marked a fusion. Only title/rationale/recipe are the model's merge.
        const fused: EnrichedRecommendation = {
          ...merged,
          kind: best.kind,
          confidence: best.confidence,
          leverage: best.leverage ?? merged.leverage,
          evidenceRefs: unionRefs,
          skillId: best.skillId,
          knowledgeVersion: "fusion@v1",
        }
        // Anti-fabrication: fusion is a net-new model write that bypasses run.ts's grounding gate, so
        // reject a fused narrative that states any number no input play had → deterministic keep-best.
        if (extractNumbers(playText(fused)).some((n) => !inputNums.has(n))) return null
        return { mode: "fused", play: fused }
      },
      fallback: (): FuseOutcome => ({ mode: "keep-best" }),
    },
  )

  if (outcome.mode === "separate") return cluster // genuinely distinct — keep both
  if (outcome.mode === "keep-best") return keepBest()
  return [outcome.play]
}

/**
 * Replace near-duplicate clusters with fused plays. Singletons pass through untouched and in order;
 * each fusable cluster becomes its fused result, slotted where the cluster's FIRST play appeared so
 * overall ordering is preserved. Never increases the play count. A merged play folds the other lens's
 * angle into ONE play (fused path); the keep-best fallback path keeps the strongest play (and the
 * cluster's evidence union) rather than the model's merge.
 */
export async function fuseNearDuplicates(
  plays: EnrichedRecommendation[],
  d: Dossier,
  opts: FuseOptions,
): Promise<EnrichedRecommendation[]> {
  const { clusters } = clusterPlays(plays)
  if (clusters.length === 0) return plays // fast path: nothing to fuse, no LLM call

  // Map each clustered play to its cluster index so we can rebuild in original order.
  const clusterOf = new Map<EnrichedRecommendation, number>()
  clusters.forEach((c, i) => c.forEach((p) => clusterOf.set(p, i)))

  const fusedByCluster = await Promise.all(clusters.map((c) => fuseCluster(c, d, opts)))

  const out: EnrichedRecommendation[] = []
  const emitted = new Set<number>()
  for (const p of plays) {
    const ci = clusterOf.get(p)
    if (ci == null) {
      out.push(p) // singleton, in place
    } else if (!emitted.has(ci)) {
      emitted.add(ci)
      out.push(...fusedByCluster[ci]) // fused result slotted at the cluster's first occurrence
    }
  }
  return out
}
