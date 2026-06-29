// The Pass — page-local mapping for the play DETAIL page.
// Pure, server-safe helpers that translate the engine's PlayPresentation into the
// shapes the kit viz expect. Re-uses the shared honest mappers from ../pass-map
// (importing is allowed — it's server-safe shared logic; we just don't edit it).

import type { EnrichedRecommendation, HeadToHead } from "@/lib/skills/types"

/* ── Head-to-head → TkH2HBars rows ─────────────────────────────────────────
   The engine gives a qualitative lead (you/them/even) + pre-humanized values +
   a plain-language label. The kit bar takes a 0–100 magnitude rendered at half
   width from the center. We have no measured ratio to scale, so we paint an
   honest, fixed lead emphasis (you/them ⇒ strong bar, even ⇒ short) — the real
   numbers live in the verdict text beside it, never faked into a precise width. */
export type MappedH2HRow = {
  metric: string
  side: "you" | "them"
  width: number
  verdict: string
  tip?: string
  tipValue?: string
}

export function playHeadToHead(play: EnrichedRecommendation): MappedH2HRow[] | null {
  const rows: HeadToHead[] | undefined = play.presentation?.headToHead
  if (!rows?.length) return null
  return rows.slice(0, 4).map((h) => {
    const side: "you" | "them" = h.lead === "them" ? "them" : "you"
    // even ⇒ a short, neutral bar; a clear lead ⇒ a strong bar. Honest ordinal
    // emphasis only — the exact values are shown in the verdict, not the width.
    const width = h.lead === "even" ? 30 : 88
    return {
      metric: h.metric,
      side,
      width,
      verdict: h.lead === "even" ? "Even" : side === "you" ? "You lead" : "They lead",
      tip: h.label,
      tipValue: `You ${h.you} · Set ${h.setOrCompetitor}`,
    }
  })
}

/* ── Impact / leverage label for the hero meta strip ───────────────────────── */
const LEV_LABEL: Record<NonNullable<EnrichedRecommendation["leverage"]>["label"], string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
}
export function leverageLabel(play: EnrichedRecommendation): { label: string; reach?: string } | null {
  if (!play.leverage) return null
  return { label: LEV_LABEL[play.leverage.label], reach: play.leverage.reach }
}

const KIND_LABEL: Record<EnrichedRecommendation["kind"], string> = {
  prepare: "Prepare",
  capitalize: "Capitalize",
  positioning: "Positioning",
  reputation: "Reputation",
  ops: "Operations",
}
export function kindLabel(play: EnrichedRecommendation): string {
  return KIND_LABEL[play.kind]
}
