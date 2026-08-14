// ---------------------------------------------------------------------------
// "What changed near you" — the competitor changelog (beta rescue Phase 3.2).
//
// A scannable list of what actually moved among the tracked competitors in the last seven
// days. It is a READ over rows the nightly pipelines already wrote to `insights`, and it
// COSTS ZERO MODEL CALLS: every line below is composed deterministically from the stored
// `insight_type` plus that row's `evidence`. Nothing here generates prose.
//
// WHY THE `insights` TABLE AND NOT `snapshots`. The diffs are already computed and persisted:
// `lib/insights/rules.ts` + `lib/insights/trends.ts` diff a competitor's listing snapshot
// against yesterday's and last week's, `lib/insights/photo-insights.ts` diffs the stored photo
// set, and `lib/seo/insights.ts` diffs SERP positions. Each writes a row. Re-diffing the raw
// snapshots here would duplicate that logic and pull large jsonb payloads for no gain.
//
// WHAT COUNTS AS A CHANGE. Only rows whose rule fires on something that HAPPENED in the
// observation window. `baseline_snapshot` and `no_significant_change` are the two filler
// types the pipeline writes when it has nothing, and they are the reason this file works
// from an allowlist rather than a denylist: a new advisory insight_type must be deliberately
// admitted, never silently rendered as "a change".
//
// EXCLUDED ON PURPOSE, so the list stays a changelog rather than a digest:
//   menu.price_positioning_shift  a standing price comparison, not a change between reads
//   menu.promo_signal_detected    a gap on their menu vs yours, true whether or not it is new
//   menu.menu_change_detected     detected on the OPERATOR's own menu, not a competitor's
//   seo_new_competitor_ads_detected  attributed to a LIST of domains, so no single competitor
//                                    can be named honestly
//   *_gap / *_opportunity / *_threat  advice, which is what an insight is for
// Competitor menu diffs are simply not computed anywhere yet, so "menu changes" cannot be
// reported for a competitor. The honest outcome is that they do not appear.
//
// ATTRIBUTION IS MANDATORY. An entry that cannot name the competitor is dropped, never
// rendered as "a competitor". Most rows carry `competitor_id`; the social and SERP rules
// write NULL and put the name in `evidence.competitor` / `evidence.competitor_name`, so
// those are matched back against the tracked set by name. An unmatched name is dropped —
// a name we cannot tie to a tracked competitor is not something we should be showing.
// ---------------------------------------------------------------------------

/** The change families. Dedup happens per (competitor, kind), so the same real-world move
 *  detected by two pipelines collapses into one line. */
export type ChangeKind = "hours" | "rating" | "reviews" | "photos" | "promo" | "pricing" | "search"

/** One `insights` row, narrowed to what the changelog reads. Structural, so the assembly is
 *  unit-testable without a DB or a fixture row. */
export type ChangeRow = {
  id: string
  competitorId: string | null
  insightType: string
  dateKey: string
  /** Tiebreak only, for two rows landing on the same date_key. */
  createdAt?: string | null
  evidence?: unknown
}

/** A competitor the operator is actually tracking.
 *
 *  `name` is the DISPLAY name (the operator's own label wins over the canonical one, ALT-225).
 *  `aliases` are additional names used only for MATCHING a row back to this competitor, never
 *  for rendering: the rules that write a name into `evidence` write the canonical source name,
 *  so a relabelled competitor would otherwise stop matching its own changes. */
export type TrackedCompetitor = { id: string; name: string; aliases?: readonly string[] }

export type ChangelogEntry = {
  /** The source insights row id — stable, so React keys never collide. */
  id: string
  competitorId: string
  competitorName: string
  kind: ChangeKind
  /** Plain operator language, composed from the row's own evidence. Never model-written. */
  what: string
  dateKey: string
}

/** How many lines the section shows before deferring to /insights. The old /home/pool page was
 *  one uncapped list; this stays a glance, not a second feed. */
export const CHANGELOG_LIMIT = 6

/** Trailing window, in days. "This week" means the last seven days of date_keys. */
export const CHANGELOG_WINDOW_DAYS = 7

// ── evidence readers (defensive: evidence is free-form jsonb) ──────────────────────────

function bag(evidence: unknown): Record<string, unknown> {
  return evidence && typeof evidence === "object" ? (evidence as Record<string, unknown>) : {}
}

function num(evidence: unknown, key: string): number | null {
  const v = bag(evidence)[key]
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

function str(evidence: unknown, key: string): string | null {
  const v = bag(evidence)[key]
  const s = typeof v === "string" ? v.trim() : ""
  return s.length > 0 ? s : null
}

/** `evidence.platform` stores the raw platform key. Same casing the social surfaces use. */
const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
}

/** A count phrase that stays grammatical without a number when the evidence is missing. */
function counted(n: number | null, one: string, many: string, vague: string): string {
  if (n === null || n <= 0) return vague
  return n === 1 ? one : many.replace("{n}", String(n))
}

// ── the allowlist ─────────────────────────────────────────────────────────────────────

type ChangeSpec = {
  kind: ChangeKind
  /** Composes the line from stored evidence. Must degrade to a truthful number-free phrase
   *  when the evidence field it wants is absent — never to a guessed number. */
  describe: (evidence: unknown) => string
}

const CHANGE_TYPES: Record<string, ChangeSpec> = {
  // ── listing diffs (lib/insights/rules.ts, day over day) ──
  hours_changed: {
    kind: "hours",
    describe: () => "Changed their posted hours",
  },
  rating_change: {
    kind: "rating",
    describe: (e) => {
      const d = num(e, "delta")
      if (d === null || d === 0) return "Rating moved"
      return `Rating moved ${d > 0 ? "up" : "down"} ${Math.abs(d).toFixed(1)}`
    },
  },
  review_velocity_rising: {
    kind: "reviews",
    describe: (e) => {
      const d = num(e, "delta")
      return counted(d === null ? null : Math.abs(d), "Picked up a review", "Picked up {n} reviews", "Picking up reviews faster")
    },
  },
  review_velocity_falling: {
    kind: "reviews",
    describe: (e) => {
      const d = num(e, "delta")
      return counted(d === null ? null : Math.abs(d), "Lost a review", "Lost {n} reviews", "Collecting reviews more slowly")
    },
  },
  // ── listing diffs over a seven day window (lib/insights/trends.ts) ──
  weekly_rating_trend: {
    kind: "rating",
    describe: (e) => {
      const d = num(e, "delta")
      if (d === null || d === 0) return "Rating moved over the week"
      return `Rating moved ${d > 0 ? "up" : "down"} ${Math.abs(d).toFixed(1)} over the week`
    },
  },
  weekly_review_trend: {
    kind: "reviews",
    describe: (e) => {
      const d = num(e, "delta")
      if (d === null || d === 0) return "Review count moved over the week"
      return `Review count ${d > 0 ? "up" : "down"} ${Math.abs(d)} over the week`
    },
  },
  // ── photo-set diffs (lib/insights/photo-insights.ts) ──
  "photo.new_content": {
    kind: "photos",
    describe: (e) =>
      counted(num(e, "added_count"), "Added a photo", "Added {n} photos", "Added photos"),
  },
  "photo.content_removed": {
    kind: "photos",
    describe: (e) =>
      counted(num(e, "removed_count"), "Removed a photo", "Removed {n} photos", "Removed photos"),
  },
  "visual.category_shift": {
    kind: "photos",
    describe: () => "Changed what their photos show",
  },
  "visual.professional_upgrade": {
    kind: "photos",
    describe: () => "Moved to professional photography",
  },
  "photo.promotion_detected": {
    kind: "promo",
    describe: () => "Put a promotion in their listing photos",
  },
  "photo.price_change": {
    kind: "pricing",
    describe: (e) => {
      const price = str(e, "detected_price")
      return price ? `Posted a price in a new photo: ${price}` : "Posted new pricing in a photo"
    },
  },
  // ── recent social activity (lib/social/visual-insights.ts) ──
  // A window rule, not a two-read diff: it fires on the share of their RECENT posts that are
  // promotional, so it does describe what they have been doing lately. Admitted for that
  // reason, and worded as an ongoing push rather than a one-off event.
  "social.competitor_promo_blitz": {
    kind: "promo",
    describe: (e) => {
      const pct = num(e, "promotionalPct")
      const platform = str(e, "platform")
      const where = platform ? ` on ${PLATFORM_LABEL[platform.toLowerCase()] ?? platform}` : ""
      return pct === null
        ? `Pushing promotions hard${where}`
        : `Promotions in ${Math.round(pct)}% of their recent posts${where}`
    },
  },
  // ── SERP position diffs (lib/seo/insights.ts) ──
  seo_competitor_overtake: {
    kind: "search",
    describe: (e) => {
      const kw = str(e, "keyword")
      return kw ? `Moved ahead of you in search for "${kw}"` : "Moved ahead of you in search"
    },
  },
}

/** Same-day tiebreak: the moves an operator would want to read first. */
const KIND_ORDER: ChangeKind[] = ["promo", "pricing", "hours", "rating", "reviews", "photos", "search"]

// ── assembly (pure) ───────────────────────────────────────────────────────────────────

function resolveCompetitor(
  row: ChangeRow,
  byId: Map<string, string>,
  byName: Map<string, TrackedCompetitor>,
): TrackedCompetitor | null {
  if (row.competitorId) {
    const name = byId.get(row.competitorId)
    if (name) return { id: row.competitorId, name }
    // An id we do not track (deactivated, removed) is not something to render.
    return null
  }
  for (const key of ["competitor", "competitor_name"]) {
    const raw = str(row.evidence, key)
    if (!raw) continue
    const hit = byName.get(raw.toLowerCase())
    if (hit) return hit
  }
  return null
}

/**
 * The changelog for one location's last seven days.
 *
 * Rows in, entries out. Callers pass ONLY rows inside the window (the loader filters on
 * `date_key`) and the CURRENTLY tracked competitor set. An empty array is a real answer:
 * the section does not render at all rather than saying we looked and found nothing.
 */
export function buildCompetitorChangelog(
  rows: readonly ChangeRow[],
  competitors: readonly TrackedCompetitor[],
  opts: { limit?: number } = {},
): ChangelogEntry[] {
  const limit = opts.limit ?? CHANGELOG_LIMIT
  if (limit <= 0 || rows.length === 0 || competitors.length === 0) return []

  const byId = new Map(competitors.map((c) => [c.id, c.name]))
  // Display names claim their key FIRST, then aliases fill the gaps, so one competitor's
  // canonical alias can never steal the name another competitor is actually shown under.
  const byName = new Map<string, TrackedCompetitor>()
  const claim = (raw: string, c: TrackedCompetitor) => {
    const key = raw.trim().toLowerCase()
    if (key && !byName.has(key)) byName.set(key, c)
  }
  for (const c of competitors) claim(c.name, c)
  for (const c of competitors) for (const alias of c.aliases ?? []) claim(alias, c)

  const candidates: Array<ChangelogEntry & { order: number; createdAt: string }> = []
  for (const row of rows) {
    const spec = CHANGE_TYPES[row.insightType]
    if (!spec) continue
    const competitor = resolveCompetitor(row, byId, byName)
    if (!competitor) continue
    candidates.push({
      id: row.id,
      competitorId: competitor.id,
      competitorName: competitor.name,
      kind: spec.kind,
      what: spec.describe(row.evidence),
      dateKey: row.dateKey,
      order: KIND_ORDER.indexOf(spec.kind),
      createdAt: row.createdAt ?? "",
    })
  }

  // Newest first, then the more consequential family, then a stable tiebreak on id so the
  // same input always yields the same list (the operator must not see it reshuffle).
  candidates.sort((a, b) => {
    if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? 1 : -1
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1
    if (a.order !== b.order) return a.order - b.order
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  // Dedup: one line per competitor per family for the whole window. Two pipelines spotting
  // the same promotion, or a rating that moved on three separate days, is ONE thing that
  // changed, and the newest read is the one worth showing.
  const seen = new Set<string>()
  const entries: ChangelogEntry[] = []
  for (const c of candidates) {
    const key = `${c.competitorId}:${c.kind}`
    if (seen.has(key)) continue
    seen.add(key)
    entries.push({
      id: c.id,
      competitorId: c.competitorId,
      competitorName: c.competitorName,
      kind: c.kind,
      what: c.what,
      dateKey: c.dateKey,
    })
    if (entries.length >= limit) break
  }
  return entries
}

/** The first date_key inside the window, as YYYY-MM-DD. UTC, matching the `date_key` column. */
export function changelogWindowStart(today: Date, days: number = CHANGELOG_WINDOW_DAYS): string {
  return new Date(today.getTime() - days * 86_400_000).toISOString().slice(0, 10)
}
