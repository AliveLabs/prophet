// ---------------------------------------------------------------------------
// presenter — the decision-science / data-storytelling pass (P11).
//
// Runs in the pipeline BETWEEN synthesize() and voicePass(). It makes every play
// (from every producer) read as "smarter than the owner" by enforcing the
// presentation contract the engine commits to:
//
//   A. PRESENTATION PASS
//      (1) toRelative(busyTimes) — a relational framing ("12% slower than your
//          Friday peak, so you can cut one closer"), NEVER the raw busy-times
//          index / peak_score. Strip internal numerics (combinedScore is dropped
//          from the customer-facing copy; leverage.basisInternal never reaches text).
//      (2) resolveEvidence(play, dossier) — attach the REAL cited artifact (a
//          verbatim review quote already captured in evidence.examples, an event
//          name+date+venue, a competitor menu line) onto play.evidence[]. A quote
//          MUST byte-match a stored example and trace to a grounded ref.
//      (3) drop any relativeStat with no paired operational consequence.
//
//   B. SYNTHESIS WRITE step  (synthesis-write.ts) — runs on FUSED / multi-ref
//      plays only, names the through-line; single-signal plays keep producer copy.
//
// Pure transforms throughout; resolveEvidence + toRelative are deterministic and
// unit-tested. No model call here — the only model pass is the synthesis WRITE
// step (B), which lives in synthesis-write.ts with a deterministic keep-best
// fallback (matching synthesis.ts / voice.ts).
// ---------------------------------------------------------------------------

import { buildRefIndex, type Dossier } from "@/lib/insights/dossier/types"
import type { BusyTimesResult } from "@/lib/providers/outscraper"
import type { Brief, EnrichedRecommendation, Evidence } from "@/lib/skills/types"

// ── A1. relational busy-times framing ───────────────────────────────────────

/**
 * Reduce a busy-times curve to a RELATIONAL framing for one target day — the percentage
 * difference from the week's PEAK day — never the raw 0-100 index. Returns null when there
 * isn't enough signal to say something true (so the presenter surfaces nothing rather than a
 * fabricated stat). The caller pairs the stat with an operational consequence (the "so what").
 *
 * e.g. toRelative(bt, "Saturday") -> { stat: "Saturday runs 12% below your Friday peak",
 *                                      pctOfPeak: 88, peakDay: "Friday" }
 */
export function toRelative(
  busyTimes: BusyTimesResult | null | undefined,
  targetDay: string,
): { stat: string; pctOfPeak: number; peakDay: string } | null {
  if (!busyTimes?.days?.length) return null
  const target = busyTimes.days.find((d) => d.day_name?.toLowerCase() === targetDay.toLowerCase())
  if (!target || !Number.isFinite(target.peak_score) || target.peak_score <= 0) return null
  // The week's peak day (by that day's peak hour score).
  const peak = busyTimes.days.reduce((a, b) => (b.peak_score > a.peak_score ? b : a))
  if (!peak || peak.peak_score <= 0) return null
  if (peak.day_name?.toLowerCase() === targetDay.toLowerCase()) {
    return { stat: `${target.day_name} is your busiest day of the week`, pctOfPeak: 100, peakDay: peak.day_name }
  }
  const pctOfPeak = Math.round((target.peak_score / peak.peak_score) * 100)
  const delta = 100 - pctOfPeak
  if (delta <= 0) return null
  return {
    stat: `${target.day_name} runs about ${delta}% below your ${peak.day_name} peak`,
    pctOfPeak,
    peakDay: peak.day_name,
  }
}

// ── A2. resolve REAL evidence text ───────────────────────────────────────────

/** Normalize for a byte-match comparison (trim only — we MUST surface the verbatim text). */
function normalizeQuote(s: string): string {
  return s.trim()
}

/** Stable kebab slug for a review theme, used to key its quotes under a finer ref. */
function slugifyTheme(theme: string): string {
  return theme
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * Build a lookup of the REAL artifacts the dossier proved, keyed by ref base. Today the richest
 * artifact is a verbatim review example (review.theme rules carry evidence.examples[] — captured in
 * sentiment.ts but never reaching the card). Event + competitor-menu artifacts are added as those
 * rules expose their source text; until then those refs resolve to a labeled (non-quote) entry.
 */
function buildArtifactIndex(d: Dossier): Map<string, Evidence[]> {
  const byRef = new Map<string, Evidence[]>()
  const push = (ref: string, ev: Evidence) => {
    const list = byRef.get(ref) ?? []
    list.push(ev)
    byRef.set(ref, list)
  }
  for (const insight of d.ruleOutputs) {
    const ev = insight.evidence ?? {}
    // Verbatim review quotes — the headline P11 unlock. review.theme rules carry examples[].
    const examples = ev.examples
    if (Array.isArray(examples)) {
      // All review themes share insight_type "review.theme", so keying ONLY by the base ref would
      // let a "slow service" play pick up the first stored examples — possibly from an unrelated or
      // positive theme. Also key under a finer `review.theme:<theme-slug>` ref so a producer that
      // cites the specific theme gets that theme's own quotes; the base key stays for back-compat.
      const themeSlug = typeof ev.theme === "string" ? slugifyTheme(ev.theme) : ""
      const finerRef = themeSlug ? `${insight.insight_type}:${themeSlug}` : ""
      for (const raw of examples) {
        if (typeof raw !== "string" || !raw.trim()) continue
        const entry: Evidence = { quote: normalizeQuote(raw), source: finerRef || insight.insight_type, asOf: undefined }
        push(insight.insight_type, { ...entry, source: insight.insight_type })
        if (finerRef) push(finerRef, entry)
      }
    }
  }
  return byRef
}

/**
 * Attach the REAL cited artifact(s) onto a play's evidence[], keyed off the refs it already cites.
 * Only quotes that BYTE-MATCH a stored example and trace to a ref in the play's evidenceRefs AND in
 * the dossier's grounded ref index are attached (no paraphrase, no ungrounded source). Caps at a
 * couple of artifacts so the card stays scannable. Idempotent: re-running won't duplicate.
 */
export function resolveEvidence(
  play: EnrichedRecommendation,
  artifacts: Map<string, Evidence[]>,
  allowedRefs: Set<string>,
  cap = 2,
): Evidence[] {
  const out: Evidence[] = []
  const seen = new Set<string>()
  for (const ref of play.evidenceRefs ?? []) {
    const base = ref.split(":")[0]
    if (!allowedRefs.has(ref) && !allowedRefs.has(base)) continue // grounding gate
    // Prefer artifacts keyed by the FULL ref (e.g. review.theme:slow-service) so a play that cites a
    // specific theme gets that theme's own quotes; fall back to the base key (review.theme) for plays
    // that cite the base ref only (preserving the original behavior).
    for (const ev of artifacts.get(ref) ?? artifacts.get(base) ?? []) {
      const dedupeKey = ev.quote ?? ev.relativeStat ?? ev.source
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      out.push(ev)
      if (out.length >= cap) return out
    }
  }
  return out
}

// ── A1b. wire the relational busy-times stat onto traffic plays ──────────────

/**
 * Build a lookup of {trafficRef -> targetDay} from the dossier's traffic rule outputs. Traffic
 * insights (traffic.peak_shift / surge / new_slow_period / competitive_opportunity) carry the day
 * they describe in evidence.day, so a play citing one of those refs can be framed RELATIONALLY
 * against the restaurant's OWN busy-times curve for that day. Keyed by both the full ref
 * (`traffic.x:day`) and the base (`traffic.x`) so either citation form resolves.
 */
function buildTrafficDayIndex(d: Dossier): Map<string, string> {
  const byRef = new Map<string, string>()
  for (const insight of d.ruleOutputs) {
    if (!insight.insight_type.startsWith("traffic.")) continue
    const day = insight.evidence?.day
    if (typeof day !== "string" || !day.trim()) continue
    // base ref (first one wins so the framing is stable) + the explicit `:day` field ref
    if (!byRef.has(insight.insight_type)) byRef.set(insight.insight_type, day)
    byRef.set(`${insight.insight_type}:day`, day)
  }
  return byRef
}

/**
 * For a play that cites a traffic/busy-times ref, attach a RELATIONAL busy-times stat (toRelative)
 * paired with an operational consequence (the "so what", sourced from the play's recipe window). The
 * stat is computed against the restaurant's OWN busy-times curve and only attached when toRelative
 * returns signal AND the cited traffic ref is grounded (in allowedRefs) AND we can derive a soWhat —
 * so keepPairedStats and the renderer always have real, paired data. Idempotent: skips if the play
 * already carries a relativeStat. Returns the entries to append (may be empty).
 */
function relativeTrafficStats(
  play: EnrichedRecommendation,
  busyTimes: BusyTimesResult | null | undefined,
  trafficDayByRef: Map<string, string>,
  allowedRefs: Set<string>,
): Evidence[] {
  if (!busyTimes?.days?.length) return []
  if ((play.evidence ?? []).some((e) => e.relativeStat)) return [] // idempotent
  // the operational consequence: prefer the play's own recipe window note (its "when"), else a
  // generic-but-true consequence. Never fabricated numerics — just the play's own plan, reflected.
  const windowNote = play.recipe?.find((s) => s.window?.note?.trim())?.window.note?.trim()
  const soWhat = windowNote ? `so you can plan ${windowNote} around it` : "so you can staff and plan around it"
  const seenDays = new Set<string>()
  const out: Evidence[] = []
  for (const ref of play.evidenceRefs ?? []) {
    const base = ref.split(":")[0]
    if (!base.startsWith("traffic.")) continue
    if (!allowedRefs.has(ref) && !allowedRefs.has(base)) continue // grounding gate
    const day = trafficDayByRef.get(ref) ?? trafficDayByRef.get(base)
    if (!day || seenDays.has(day.toLowerCase())) continue
    const rel = toRelative(busyTimes, day)
    if (!rel) continue
    seenDays.add(day.toLowerCase())
    out.push({ source: base, relativeStat: rel.stat, soWhat })
    if (out.length >= 1) break // one relational framing per play keeps the card scannable
  }
  return out
}

// ── A3. drop unpaired relativeStats; strip internal numerics ─────────────────

/** A surfaced relational stat MUST carry its operational consequence, or the presenter drops it. */
function keepPairedStats(evidence: Evidence[]): Evidence[] {
  return evidence.filter((e) => {
    if (!e.relativeStat) return true // not a stat entry (e.g. a quote) — keep
    return Boolean(e.soWhat?.trim()) // a stat with no "so what" is dropped
  })
}

/**
 * Strip internal numerics from the CUSTOMER-FACING surface of a play. combinedScore is the ranking
 * artifact and must never read as a customer-facing fact, so the presenter drops it from the served
 * play. leverage.basisInternal is internal-only and is dropped from the customer leverage object
 * (the ordinal label + grounded reach stay). The internal score is still available to the ranked
 * display layer separately; here we ensure it never leaks into copy.
 */
function stripInternalNumerics(play: EnrichedRecommendation): EnrichedRecommendation {
  // Drop combinedScore (the ranking artifact) from the served copy; play ORDER already encodes rank.
  const rest = { ...play }
  delete rest.combinedScore
  const leverage = play.leverage
    ? { label: play.leverage.label, reach: play.leverage.reach, basisInternal: "" }
    : play.leverage
  return { ...rest, ...(leverage ? { leverage } : {}) }
}

// ── the presentation pass ────────────────────────────────────────────────────

/**
 * Run the A-pass (presentation) over one play: attach the relational busy-times stat (A1b) for
 * traffic plays, resolve real evidence (A2), keep only paired relational stats (A3), strip internal
 * numerics. Pure + deterministic; safe to no-op when the dossier lacks artifacts/busy-times (the
 * relational stat and evidence both just stay absent → card falls back to the ref label).
 *
 * `busyTimes` + `trafficDayByRef` are optional so the existing 3-arg callers (and the unit tests)
 * keep working; when omitted, the relational-stat wiring is simply skipped.
 */
export function presentPlay(
  play: EnrichedRecommendation,
  artifacts: Map<string, Evidence[]>,
  allowedRefs: Set<string>,
  busyTimes?: BusyTimesResult | null,
  trafficDayByRef?: Map<string, string>,
): EnrichedRecommendation {
  const trafficStats = trafficDayByRef
    ? relativeTrafficStats(play, busyTimes, trafficDayByRef, allowedRefs)
    : []
  // Drop unpaired relational stats FIRST, THEN dedupe by a stable key (the key resolveEvidence uses),
  // so re-presenting a play that already carries resolved evidence — a saved play, or a P7b-resurfaced
  // one — never duplicates a quote/stat, while a paired stat is never lost to an unpaired duplicate of
  // itself (order matters: dedupe-before-filter would collapse the paired entry into the unpaired one).
  const paired = keepPairedStats([
    ...(play.evidence ?? []),
    ...trafficStats,
    ...resolveEvidence(play, artifacts, allowedRefs),
  ])
  const resolved: Evidence[] = []
  const seen = new Set<string>()
  for (const e of paired) {
    const key = e.quote ?? e.relativeStat ?? e.source
    if (seen.has(key)) continue
    seen.add(key)
    resolved.push(e)
  }
  const stripped = stripInternalNumerics(play)
  // Serve the FILTERED evidence; when nothing survives, OMIT evidence rather than letting the
  // original (possibly unpaired) play.evidence ride along on the stripped copy.
  const next: EnrichedRecommendation = { ...stripped }
  if (resolved.length) next.evidence = resolved
  else delete next.evidence
  return next
}

/**
 * The presenter pass over a whole brief — runs after synthesis, before voice. Attaches the real
 * cited artifacts to every play and scrubs internal numerics. Fail-soft: any failure leaves the
 * brief untouched (the grounded keep-best floor), matching synthesis.ts / voice.ts. The
 * synthesis-stamped combinedScore is the ranking artifact only; the served brief preserves play
 * ORDER (best-first) but drops the raw number so it can never leak into customer-facing copy.
 */
export function presentBrief(brief: Brief, dossier: Dossier): Brief {
  try {
    const artifacts = buildArtifactIndex(dossier)
    const { allowedRefs } = buildRefIndex(dossier)
    const trafficDayByRef = buildTrafficDayIndex(dossier)
    const busyTimes = dossier.location?.busyTimes
    return {
      ...brief,
      plays: brief.plays.map((p) => presentPlay(p, artifacts, allowedRefs, busyTimes, trafficDayByRef)),
    }
  } catch (err) {
    console.warn("[presenter] pass failed; serving un-presented brief", err)
    return brief
  }
}
