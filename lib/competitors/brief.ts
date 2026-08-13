// ---------------------------------------------------------------------------
// Per-competitor AI intelligence brief — Claude Haiku via the shared provider.
//
// Beta rescue 2.2: this was a raw Gemini Flash fetch with NO cache and NO spend
// telemetry — it fired once per page render per competitor. Now:
//   - generateCompetitorBrief() is the pure generator (Haiku through
//     claudeTransport; transport injectable for headless unit tests).
//   - getCachedCompetitorBrief() is what UI should call: the repo's standing
//     "use cache" + cacheLife idiom (lib/cache/*.ts). On Vercel that is the
//     durable shared data cache, so it holds across Fluid instances — unlike
//     the in-process Map that lib/insights/briefing-cache.ts uses, which
//     evaporates per instance. The cache key includes the insights payload, so
//     a nightly insights refresh naturally produces a fresh brief; the 24h TTL
//     only bounds staleness when inputs are byte-identical.
//   - A failed generation THROWS inside the cached scope on purpose: errors are
//     not cached, so a transient model failure can't pin "no brief" for 24h.
//
// Failure contract unchanged: callers get `null` on any failure and render
// nothing (components/competitors/intel-brief.tsx returns null on null).
// ---------------------------------------------------------------------------

import { cacheLife, cacheTag } from "next/cache"
import { claudeTransport, FAST_MODEL, type Transport } from "@/lib/ai/provider"
import { recordSpendEvent } from "@/lib/ai/spend-events"

type BriefInsight = {
  title: string
  summary: string
  severity: string
  insight_type: string
  date_key: string | null
}

export type CompetitorBrief = {
  narrative: string
  suggestedAction: string
}

export async function generateCompetitorBrief(
  competitorName: string,
  insights: BriefInsight[],
  opts: { transport?: Transport } = {}
): Promise<CompetitorBrief | null> {
  if (insights.length === 0) return null
  // Mirror the old GOOGLE_AI_API_KEY early-out on the real path only (an injected test
  // transport needs no key). Without it, claudeRaw would throw and we'd return null anyway —
  // this just skips the doomed attempt.
  if (!opts.transport && !process.env.ANTHROPIC_API_KEY) return null

  const signalSummary = insights
    .slice(0, 15)
    .map(
      (i) =>
        `- [${i.severity.toUpperCase()}] ${i.title}: ${i.summary} (${i.date_key ?? "recent"})`
    )
    .join("\n")

  const prompt = `You are Ticket, a competitive intelligence AI for local businesses.

Given recent signals about a competitor called "${competitorName}", write a brief intelligence summary.

SIGNALS THIS PERIOD:
${signalSummary}

Respond in JSON with exactly two fields:
{
  "narrative": "2-3 sentence analysis of what this competitor is doing and why it matters. Be specific, reference actual data points. Use bold (**text**) for key numbers.",
  "suggestedAction": "1-2 sentence concrete action the business owner should take in response. Be specific and actionable."
}

Only return valid JSON, nothing else.`

  try {
    const transport = opts.transport ?? claudeTransport
    const parsed = (await transport({
      tier: "reasoning",
      model: FAST_MODEL,
      prompt,
      // Explicit cap: two short prose fields. Non-thinking, so this is pure output headroom.
      maxOutputTokens: 512,
      temperature: 0.4,
      label: "competitor-brief",
      onUsage: (usage) =>
        void recordSpendEvent({
          surface: "competitor_brief",
          provider: "anthropic",
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
          metadata: { competitorName },
        }),
    })) as { narrative?: unknown; suggestedAction?: unknown } | null
    if (
      parsed &&
      typeof parsed.narrative === "string" &&
      parsed.narrative &&
      typeof parsed.suggestedAction === "string" &&
      parsed.suggestedAction
    ) {
      return { narrative: parsed.narrative, suggestedAction: parsed.suggestedAction }
    }
    return null
  } catch {
    return null
  }
}

/** Cached scope. Args are the cache key ("use cache" serializes them), so a changed insight set
 *  regenerates immediately; the TTL only bounds byte-identical staleness. Throws (never caches)
 *  when generation fails — see the header comment. */
async function cachedCompetitorBrief(
  competitorName: string,
  insights: BriefInsight[]
): Promise<CompetitorBrief> {
  "use cache"
  cacheTag("competitor-brief")
  cacheLife({ revalidate: 86400 }) // 24h; insights refresh nightly and re-key the entry anyway
  const brief = await generateCompetitorBrief(competitorName, insights)
  if (!brief) throw new Error("competitor brief unavailable")
  return brief
}

/** What UI calls. One Haiku generation per (competitor, insight set) per 24h instead of one per
 *  page render; failures return null (uncached), matching the pre-cache contract. */
export async function getCachedCompetitorBrief(
  competitorName: string,
  insights: BriefInsight[]
): Promise<CompetitorBrief | null> {
  if (insights.length === 0) return null
  try {
    return await cachedCompetitorBrief(competitorName, insights)
  } catch {
    return null
  }
}
