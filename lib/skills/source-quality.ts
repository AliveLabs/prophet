// ---------------------------------------------------------------------------
// Source-quality review queue — the CONSUMPTION half of ALT-172.
//
// The capture half persists an operator's "this looks wrong" note on
// `play_actions` (reason='looks_wrong', note=…) and routes the brief dismissal as
// NEUTRAL to the model (a looks-wrong is almost always a complaint about bad
// THIRD-PARTY source data — wrong Google hours/price/listing — not our model's
// fault). The insights feed has the parallel: "this looks wrong" →
// insights.status='inaccurate'. This module normalizes BOTH into one read-only
// "go check the source data" view + a by-source rollup.
//
// HARD CONSTRAINT (ALT-172): this is a DATA-QUALITY loop ONLY. It must NEVER feed
// back into the recommendation model — it does NOT import (and is not imported by)
// lib/skills/feedback-rollup.ts, and never touches the band weights in
// lib/skills/feedback-signals.ts. The model-negative loop is owned by thumbs-down
// + dismissed:not_relevant. Everything here is pure + read-only (the page reads;
// nothing writes). Enforced by tests/unit/source-quality.test.ts.
// ---------------------------------------------------------------------------

import { domainLabel, humanizeRef, dedupeRefs } from "@/lib/skills/evidence-format"
import { playKey } from "@/lib/skills/preferences"
import type { Brief, EnrichedRecommendation } from "@/lib/skills/types"

/** A persisted brief "this looks wrong" dismissal (play_actions row). */
export type LooksWrongRow = {
  location_id: string
  date_key: string
  play_key: string
  note?: string | null
  updated_at: string
}

/** A persisted insight flagged "this looks wrong" (insights row, status='inaccurate'). */
export type InaccurateInsightRow = {
  id: string
  location_id: string
  insight_type: string
  title?: string | null
  summary?: string | null
  created_at: string
  feedback_at?: string | null
}

/** Resolved display info for a location (the page joins locations + organizations). */
export type LocationInfo = { id: string; name: string; orgName?: string }

/** One normalized source-quality flag — brief play OR inaccurate insight. */
export type SourceQualityFlag = {
  /** Stable, globally-unique identity for list keys (the play_actions natural key / the insight id). */
  id: string
  kind: "brief_play" | "insight"
  /** ISO timestamp the operator flagged it. */
  flaggedAt: string
  locationId: string
  locationName: string
  orgName?: string
  /** The play title or insight title. */
  title: string
  /** The operator's free-text note (brief side only — insights carry no note). */
  note?: string
  /** The insight summary, as context (insight side only). */
  summary?: string
  /** Humanized, de-jargoned source labels behind the flagged item ("Review · what reviewers say"). */
  sources: string[]
  /** Coarse source family for the rollup ("Review", "Events", "SEO", "Places", …). */
  sourceFamily: string
}

/** A by-source rollup row — how many flags trace to one source family. */
export type SourceAggregate = {
  family: string
  count: number
  briefCount: number
  insightCount: number
  /** A few of the most recent operator notes for this family (brief flags only). */
  recentNotes: string[]
}

const UNKNOWN_FAMILY = "Unknown source"

/** Coarse, de-jargoned source family for the lead evidence ref or an insight_type.
 *  Reuses evidence-format's domainLabel so labels never leak internal/API terms and
 *  match how the brief surfaces sources. Empty/absent → "Unknown source". */
export function sourceFamilyOf(leadRefOrType: string | null | undefined): string {
  if (typeof leadRefOrType !== "string" || !leadRefOrType.trim()) return UNKNOWN_FAMILY
  const label = domainLabel(leadRefOrType).trim()
  return label || UNKNOWN_FAMILY
}

/** playKey() can throw on a malformed persisted play (missing title/skillId). The queue is
 *  read-only and best-effort, so a bad play simply fails to match rather than crashing the page. */
function safePlayKey(p: EnrichedRecommendation): string {
  try {
    return playKey(p)
  } catch {
    return ""
  }
}

/** Normalize a brief "looks_wrong" row + its brief into a flag. Resolves the play in the
 *  persisted brief by the SAME key helper the capture side wrote with, so keys always match.
 *  A play that's no longer in the brief (rebuilt/pruned) still surfaces — the note + location
 *  are the point — just without resolved sources. */
export function resolvePlayFlag(row: LooksWrongRow, brief: Brief | null, loc: LocationInfo): SourceQualityFlag {
  const plays = Array.isArray(brief?.plays) ? brief.plays : []
  const play = plays.find((p) => safePlayKey(p) === row.play_key)
  const refs =
    play && Array.isArray(play.evidenceRefs)
      ? play.evidenceRefs.filter((r): r is string => typeof r === "string" && r.trim().length > 0)
      : []
  const note = typeof row.note === "string" && row.note.trim() ? row.note.trim() : undefined
  return {
    id: `brief:${row.location_id}:${row.date_key}:${row.play_key}`,
    kind: "brief_play",
    flaggedAt: row.updated_at,
    locationId: loc.id,
    locationName: loc.name,
    orgName: loc.orgName,
    title: play?.title?.trim() || "Play no longer in this brief",
    note,
    sources: dedupeRefs(refs).map(humanizeRef),
    sourceFamily: sourceFamilyOf(refs[0]),
  }
}

/** Normalize an inaccurate-insight row into a flag. Insights carry no free-text note, so the
 *  source signal is the insight_type; the summary rides along as context. */
export function insightFlag(row: InaccurateInsightRow, loc: LocationInfo): SourceQualityFlag {
  return {
    id: `insight:${row.id}`,
    kind: "insight",
    flaggedAt: row.feedback_at || row.created_at,
    locationId: loc.id,
    locationName: loc.name,
    orgName: loc.orgName,
    title: row.title?.trim() || "Insight",
    summary: typeof row.summary === "string" && row.summary.trim() ? row.summary.trim() : undefined,
    sources: row.insight_type?.trim() ? [humanizeRef(row.insight_type)] : [],
    sourceFamily: sourceFamilyOf(row.insight_type),
  }
}

/** Newest-first by flag time. Stable, pure (does not mutate the input). */
export function sortFlagsNewestFirst(flags: SourceQualityFlag[]): SourceQualityFlag[] {
  return [...flags].sort((a, b) => b.flaggedAt.localeCompare(a.flaggedAt))
}

/** Roll flags up by source family so a repeatedly-flagged source bubbles to the top — the real
 *  signal ("Places flagged 12×" matters more than 12 scattered one-offs). Sorted by count desc,
 *  then family asc. recentNotes keeps up to 3 of the newest operator notes per family. */
export function aggregateBySource(flags: SourceQualityFlag[]): SourceAggregate[] {
  const map = new Map<string, SourceAggregate>()
  for (const f of sortFlagsNewestFirst(flags)) {
    let agg = map.get(f.sourceFamily)
    if (!agg) {
      agg = { family: f.sourceFamily, count: 0, briefCount: 0, insightCount: 0, recentNotes: [] }
      map.set(f.sourceFamily, agg)
    }
    agg.count++
    if (f.kind === "brief_play") agg.briefCount++
    else agg.insightCount++
    if (f.note && agg.recentNotes.length < 3) agg.recentNotes.push(f.note)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.family.localeCompare(b.family))
}
