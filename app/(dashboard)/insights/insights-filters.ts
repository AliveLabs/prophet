// The /insights filters — pure functions only (no JSX, no React), so the whole set is
// server-safe and unit-testable (vitest collects `tests/unit/**/*.test.ts`, no `.tsx`).
//
// One filter state applies across BOTH sections of the consolidated page (Ready to act
// on + Observations), so the rules here are written against a section-agnostic
// descriptor rather than against a play or a row directly. The page derives that
// descriptor with the SAME mapping functions the cards render with (pass-map for plays,
// insights-map for detector rows), which is what keeps a filter and the chip/score it
// filters on agreeing by construction:
//
//   · TYPE is the card's own "what" chip label (playChipLabel / insightChipLabel).
//     The option set is derived from the data actually present — no label vocabulary is
//     invented here. Plays name their CATEGORY (the shared CATEGORY_LABEL map, ALT-554)
//     and detector rows name the SIGNAL they were read from (SOURCE_LABELS), so the
//     dropdown honestly mixes both: they are different objects and one list of words
//     could only describe them by overstating one of them.
//   · STATUS is the #213 lifecycle read: All active / New / Kept / Dismissed /
//     Reported inaccurate. Keep/Dismiss are the only verbs; the groups below map the
//     stored statuses and play actions onto them, legacy Track-era rows included.
//   · CONFIDENCE / IMPACT are WORD LEVELS only — the same words the card's score axes
//     display. No numeral ever reaches a filter, in either direction.

import type { PlayAction } from "@/lib/insights/momentum"

export type StatusGroup = "new" | "kept" | "dismissed" | "inaccurate"
export type ConfidenceLevel = "high" | "medium" | "directional"
export type ImpactLevel = "high" | "medium" | "low"

export type InsightFilterState = {
  /** A type slug from `typeSlug`, or "" for every type. */
  type: string
  /** "" = All active (everything the operator has not cleared). */
  status: "" | StatusGroup
  confidence: "" | ConfidenceLevel
  impact: "" | ImpactLevel
}

/** What the page derives per item (play or row) for the filter to read. */
export type FilterableInsight = {
  typeLabel: string
  statusGroup: StatusGroup
  confidence: ConfidenceLevel
  impact: ImpactLevel
}

const STATUS_VALUES = new Set<StatusGroup>(["new", "kept", "dismissed", "inaccurate"])
const CONFIDENCE_VALUES = new Set<ConfidenceLevel>(["high", "medium", "directional"])
const IMPACT_VALUES = new Set<ImpactLevel>(["high", "medium", "low"])

/** URL-safe slug for a chip label ("Google Business Profile" → "google-business-profile"). */
export function typeSlug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/** Parse the page's searchParams into a validated filter state. Unknown values read as
 *  "" (the filter's everything-view) rather than throwing on a hand-edited URL. */
export function parseInsightFilters(
  params: Record<string, string | undefined> | undefined,
): InsightFilterState {
  const status = params?.status ?? ""
  const confidence = params?.confidence ?? ""
  const impact = params?.impact ?? ""
  return {
    type: typeSlug(params?.type ?? ""),
    status: STATUS_VALUES.has(status as StatusGroup) ? (status as StatusGroup) : "",
    confidence: CONFIDENCE_VALUES.has(confidence as ConfidenceLevel)
      ? (confidence as ConfidenceLevel)
      : "",
    impact: IMPACT_VALUES.has(impact as ImpactLevel) ? (impact as ImpactLevel) : "",
  }
}

/** True when any filter narrows the view (drives the honest "N of M" subs and the
 *  labelled empty states; the location switch is a scope, not a filter). */
export function filtersActive(f: InsightFilterState): boolean {
  return Boolean(f.type || f.status || f.confidence || f.impact)
}

/** A play's lifecycle group, from its latest pool action. Plays have no "inaccurate"
 *  path (that complaint is a detector-row concept), so the group never reads it. */
export function playStatusGroup(current: PlayAction | null): StatusGroup {
  if (current === "saved") return "kept"
  if (current === "dismissed" || current === "snoozed") return "dismissed"
  return "new"
}

/** A detector row's lifecycle group. Mirrors insightKeptState(): the legacy positive
 *  statuses (read / todo / actioned — written by the retired Track menu) all read as
 *  kept, so nothing an operator marked disappears from the Kept view. */
export function rowStatusGroup(status: string): StatusGroup {
  if (status === "read" || status === "todo" || status === "actioned") return "kept"
  if (status === "dismissed" || status === "snoozed") return "dismissed"
  if (status === "inaccurate") return "inaccurate"
  return "new"
}

/**
 * Does one item survive the current filters?
 * The default status view (All active) hides what the operator has cleared —
 * dismissed and reported-inaccurate items stay reachable through their own views,
 * exactly the #213 semantics.
 */
export function matchesFilters(item: FilterableInsight, f: InsightFilterState): boolean {
  if (f.type && typeSlug(item.typeLabel) !== f.type) return false
  if (f.status) {
    if (item.statusGroup !== f.status) return false
  } else if (item.statusGroup === "dismissed" || item.statusGroup === "inaccurate") {
    return false
  }
  if (f.confidence && item.confidence !== f.confidence) return false
  if (f.impact && item.impact !== f.impact) return false
  return true
}

/**
 * The type dropdown's options, derived from the labels actually present across both
 * sections (deduped by slug, alphabetical). An empty label contributes nothing.
 */
export function typeOptions(labels: Iterable<string>): Array<{ value: string; label: string }> {
  const bySlug = new Map<string, string>()
  for (const label of labels) {
    const slug = typeSlug(label)
    if (!slug || bySlug.has(slug)) continue
    bySlug.set(slug, label)
  }
  return [...bySlug.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label))
}
