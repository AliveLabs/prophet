// ---------------------------------------------------------------------------
// Convergence skill — REWRITTEN (convergence@v2, 2026-07-03), the NINTH and
// final skill in the one-at-a-time mastery program. marketing@v2, reputation@v2,
// operations@v2, local-demand@v2, positioning@v4 (all on main) plus the drafted
// social-counter@v2 / food-pairing@v2 / guerrilla-unthrottle are the templates.
//
// THIS SKILL'S BAR IS DIFFERENT. Every sibling is a single-domain master; this
// is the ONE producer that sees the WHOLE dossier (no prefix filter) and exists
// only for the play NO single-domain expert can produce — the move that appears
// when two or more signal families are read TOGETHER. A convergence play that
// restates one domain's insight is a FAILURE even when it cites three refs; the
// product is the combination, and the reaction it is engineered for is "I never
// would have put those together."
//
// WHAT v1 GOT RIGHT (kept, verbatim where possible):
//   - the whole-dossier intake with the interleaved cap (P5 review finding C):
//     `interleaveByDomain` is KEPT and exported unchanged; selectInput now uses
//     the family-keyed variant of the same round-robin (see below);
//   - the >=3-distinct-domains citation rule, enforced in BOTH the prompt and
//     parse() (P5 review finding D) — upgraded, not relaxed (see the family gate);
//   - `deep: true` — the Opus + adaptive-thinking pass (run.ts:61-62). KEPT
//     deliberately: it is the only mechanism that lets one call reason over every
//     family at once, the registry + plan doc treat it as standing cost policy
//     ("Opus stays reserved for convergence + synthesis"), and the program memo
//     gates this skill's quality on model depth explicitly. Do not demote it.
//   - fusion exemption (fusion.ts clusterKey returns null for convergence) and
//     the neutral 1.0 category prior — both unchanged, both verified.
//
// WHAT v1 GOT WRONG (the v2 fixes, each verified against the live generators):
//  (1) THE DOMAIN GATE HAD A HOLE. v1 counted "domains" with domainLabel(), the
//      FIRST TOKEN of the type. But weekly_rating_trend / rating_change /
//      review_velocity_falling tokenize to "Weekly" / "Rating" / "Review" —
//      three "domains" that are ALL the reputation family. A play citing those
//      three shipped tagged cross-domain while being single-domain in substance.
//      v2 introduces signalFamily(): a verified map of every live insight_type
//      to its INFORMATION CHANNEL (demand / weather / traffic / hours / social /
//      reputation / menu / visibility / visual), with unknown future prefixes
//      (e.g. the planned opportunity.window ledger) counting as their own
//      family. parse() requires >=3 distinct FAMILIES — stricter than v1 where
//      it matters, byte-equivalent where v1 was already honest.
//  (2) THE FLOOR WAS SEVERITY-BLIND AND SELF-CONTRADICTORY. v1's fallback fired
//      whenever 3 first-token domains existed — three info-grade rows with zero
//      interaction manufactured a "line up the threads" card, the exact
//      "restate three unrelated facts" failure its own knowledge forbids. v2
//      severity-gates the floor (the program pattern): it fires ONLY when >=3
//      distinct families are present AND the strongest pick is warning/critical.
//      A calm all-info week now yields NOTHING from the floor (quiet-week golden
//      unchanged; competitive-week still fires exactly one, now on the
//      warning-grade picks — see rationale.md §6).
//  (3) NO STANCE ANYWHERE. v1's fallback omitted stance (silently scored as
//      capture) and parse() never backstopped it. v2: the model's deliberate
//      stance wins; unset stance is backstopped from cited-ref severity (fix on
//      warning/critical, capture otherwise; maintain only ever model-chosen —
//      the five mastered siblings' exact convention).
//  (4) NO KILL-LIST. v2 adds the customer-writing backstop (founder mandate,
//      2026-07-03, the ALC Dance Studios postmortem): internal-dialogue /
//      meta-justification / score-talk / taxonomy leaks / the "band" size-
//      bracket misuse are SUPPRESSED in parse. This is a BACKSTOP — the real
//      writing quality comes from the playbook's audience doctrine + contrast
//      pairs (the founder was explicit that a deny-list is not the fix), so the
//      regex set is deliberately minimal and precise.
//  (5) NO ARCHETYPES, NO LEARNING HOOK. v1 was the only skill with neither.
//      v2 exports CONVERGENCE_ARCHETYPES (7 stable combination-shape keys) and
//      declares the P14 learning hook (click + ask; lead domain "convergence")
//      so per-archetype click feedback becomes learnable like every sibling.
//
// SIGNAL-RAIL DEPENDENCY (why this rewrite ran last): the founder's flagship
// combination — a competitor's busy-curve gap x the events calendar x your own
// hours — is still only PARTLY groundable: traffic.surge/peak_shift/
// extended_busy/new_slow_period are DORMANT (traffic pipeline hardcodes
// previous:null — ticket T1), competitor busyTimes is typed but never populated
// by buildDossier (T3), and no own-scoped traffic/hours rule exists (T2).
// selectInput already carries the competitor-curve projection fail-soft (rides
// empty today, arms itself the day T3 lands — operations@v2's proven pattern),
// and the claim_the_dead_zone archetype is scoped to windows INSIDE current
// service hours until the HOURS_GATE trial-mode inversion (plan Phase 0) lands.
// See rationale.md §4 for which archetypes strengthen when each rail arrives.
//
// TOKEN BUDGET (deep pass, Opus high effort, 120s abort): v1 ran ~2.7k of
// knowledge over an uncapped-summary 40-signal intake of pretty-printed
// objects. v2's knowledge is ~11k, so the intake pays for it twice over:
//   - SIGNAL_CAP 20, severity-sorted WITHIN each family before the round-robin,
//     so the cap always carries every family's STRONGEST rows (v1's cap carried
//     each family's first-listed rows, severity-blind — a late warning could
//     lose its slot to an early info row);
//   - every input block is a compact LINE projection, not a nested object
//     (positioning@v4's distilled-menuRead precedent): pretty-printed JSON was
//     burning ~40% of the user prompt on braces and indentation.
// The prompt smoke pins the HONEST worst case (evidence-keyed refs, five armed
// rival curves) under the ~34k safe band — do NOT trust the stale 40k figure
// (guerrilla's audit debunked it; food-pairing measured ~43k already in the
// timeout zone at medium effort, and this skill runs the slowest config in the
// engine).
// ---------------------------------------------------------------------------

import type { Dossier } from "@/lib/insights/dossier/types"
import type { GeneratedInsight } from "@/lib/insights/types"
import type { ProducerSkill } from "@/lib/skills/skill-types"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import { buildSkillPrompt, coerceEnrichedPlays } from "@/lib/skills/prompt-kit"
import { domainLabel } from "@/lib/skills/evidence-format"
import { CONVERGENCE_KNOWLEDGE } from "@/lib/skills/convergence/knowledge"

// VERSION: convergence@v1 is the ONLY string ever persisted for this skill
// (verified via `git log --all -p -- lib/skills/convergence/` — no @v2/@v3
// collision, unlike positioning's P4-era strings which forced @v4). The plain
// program bump to @v2 is safe; the feedback rollup keys on this string.
const KNOWLEDGE_VERSION = "convergence@v2"

// ── The convergence archetypes (stable keys — the click-feedback sub-domain the
//    rollup learns by, mirroring the siblings' *_ARCHETYPES exports). UNLIKE the
//    siblings', these are not domain triggers: each names a COMBINATION SHAPE —
//    a way two-plus signal families interact to make a move true that neither
//    would justify alone. Designed in the playbook; keys stable for P15. ──
export const CONVERGENCE_ARCHETYPES = [
  "collide_the_windows", // two independent clocks land on the same days -> one move rides both
  "stack_the_win", // a proven own strength x a live moment x an ops lever -> multiply, don't invent
  "flip_the_reflex", // a second family REVERSES the obvious response to the first -> the corrected move
  "hit_the_wobble", // a rival's weakness x your proven strength x a timing window -> strike, never chase price
  "claim_the_dead_zone", // demand evidence vs your slack window -> a piloted rhythm/daypart claim (T1-T3 arm it fully)
  "triangulate_the_whisper", // three small signals, three families, ONE subject -> the compound case
  "stack_to_the_threshold", // several families feed one near-threshold flip -> one concerted push
] as const
export type ConvergenceArchetype = (typeof CONVERGENCE_ARCHETYPES)[number]

// ── Signal families — the verified information channels (the v2 domain gate) ──
// Read from the live generators (see rationale.md §1 for the full attribution
// table), NOT from type-name aesthetics. A "family" is an independent CHANNEL of
// information about the business; the cross-domain bar is >=3 of THESE, so three
// reputation-shaped tokens can no longer masquerade as three domains (v1's hole).
//
// Bookkeeping rows are NOT signals: they carry no operator-facing story and must
// never pad the family count (a dossier with baseline_snapshot +
// competitive_summary + one real row is a ONE-family dossier).
const NON_SIGNAL_TYPES = new Set(["baseline_snapshot", "competitive_summary", "no_significant_change"])

// Exact-type overrides FIRST: both live weather reads ride other families'
// prefixes (visual. / traffic.) but bottom out in the same forecast — counting
// either alongside its prefix family would double-count one channel.
const WEATHER_FAMILY_TYPES = new Set(["visual.weather_patio", "traffic.weather_suppression"])

/** Map a ref (base insight_type, any :field suffix stripped) to its signal
 *  family, or null for bookkeeping rows that must never count as evidence.
 *  Unknown/future prefixes fall back to their first token so a new rule family
 *  (e.g. the planned `opportunity.window` ledger or `hours.competitor_open_gap`)
 *  automatically counts as its OWN distinct family — future rails arm the gate,
 *  never fight it. */
export function signalFamily(ref: string): string | null {
  const base = ref.split(":")[0]
  if (!base) return null
  if (NON_SIGNAL_TYPES.has(base)) return null
  if (WEATHER_FAMILY_TYPES.has(base)) return "weather"
  if (base.startsWith("events.")) return "demand"
  if (base.startsWith("traffic.")) return "traffic" // busy-curve channel (diff family dormant on T1; baseline/competitive_opportunity live)
  if (base.startsWith("hours")) return "hours" // hours_changed today; the M1 hours.* rules tomorrow
  if (base.startsWith("social.")) return "social" // all 44 live types, incl. social.cross_* (corroboration-grade)
  if (base.startsWith("rating") || base.startsWith("review") || base.startsWith("weekly_")) return "reputation"
  if (base.startsWith("menu.") || base.startsWith("photo.")) return "menu" // what they sell/charge, read from menus + listing photos
  if (base.startsWith("content.") || base.startsWith("seo") || base.startsWith("cross_event")) return "visibility"
  if (base.startsWith("visual.")) return "visual" // rival look-and-feel posture (category_shift / professional_upgrade)
  const label = domainLabel(base)
  return label ? label.toLowerCase() : null
}

/** Distinct signal families across a set of refs (nulls — bookkeeping — excluded). */
export function distinctFamilies(refs: string[]): string[] {
  const out = new Set<string>()
  for (const r of refs) {
    const f = signalFamily(r)
    if (f) out.add(f)
  }
  return [...out]
}

/** The cross-domain citation bar: >=3 refs from >=3 distinct signal FAMILIES.
 *  v1's rule (>=3 first-token domains) is kept in spirit and tightened in
 *  mechanism; stated in the playbook, enforced in parse(), structural in the
 *  floor — the P5 defense-in-depth stays triple-layered. */
const REQUIRED_FAMILIES = 3

// ── Intake: the whole dossier, interleaved so the cap can't starve a family ──

const SIGNAL_CAP = 20 // v1: 40 severity-blind rows. v2's cap carries every family's STRONGEST rows instead (see below) — breadth of the best, not depth; the siblings each see more of their own family than this skill ever needs to.
const SUMMARY_CAP = 120 // chars per signal summary in the prompt — the title + type carry the scent; the summary is a reminder, not the evidence

const SEV_RANK: Record<string, number> = { critical: 2, warning: 1, info: 0 }

/** Round-robin items across buckets: one item per bucket per pass until the cap,
 *  so a flat slice can never silently drop a whole bucket (P5 review finding C). */
function roundRobin<T>(items: T[], keyOf: (it: T) => string, cap: number): T[] {
  const groups = new Map<string, T[]>()
  for (const it of items) {
    const k = keyOf(it)
    const g = groups.get(k)
    if (g) g.push(it)
    else groups.set(k, [it])
  }
  const lists = [...groups.values()]
  const out: T[] = []
  for (let round = 0; out.length < cap; round++) {
    let added = false
    for (const list of lists) {
      if (round < list.length) {
        out.push(list[round])
        added = true
        if (out.length >= cap) break
      }
    }
    if (!added) break // every list exhausted
  }
  return out
}

/** v1's export, KEPT byte-compatible (first-token domain buckets) for back-compat. */
export function interleaveByDomain<T extends { insight_type: string }>(items: T[], cap: number): T[] {
  return roundRobin(items, (it) => domainLabel(it.insight_type), cap)
}

/** v2 intake variant: buckets by signal FAMILY (the same partition the citation
 *  gate uses, so intake fairness and grounding stay in lockstep), drops
 *  bookkeeping rows before they can waste a slot, and sorts each family
 *  STRONGEST-FIRST (critical > warning > info, stable within a rank) so the cap
 *  always carries every family's best material — v1's round-robin was
 *  severity-blind, so a family's late-listed warning could lose its slot to an
 *  early info row. */
export function interleaveByFamily(items: GeneratedInsight[], cap: number): GeneratedInsight[] {
  const signals = items.filter((i) => signalFamily(i.insight_type) !== null)
  const byStrength = [...signals].sort(
    (a, b) => (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0), // stable: original order within a rank
  )
  return roundRobin(byStrength, (i) => signalFamily(i.insight_type)!, cap)
}

// UNLIKE the domain skills, selectInput does NOT prefix-filter — convergence must
// see ALL families at once. Every block is a COMPACT LINE projection (one string
// per fact — pretty-printed nested objects were burning ~40% of the user prompt
// on punctuation; positioning@v4's distilled-menuRead is the precedent). Context
// blocks (events/weather/busy times/themes/hours) are REASONING MATERIAL, not
// citable — the playbook states this and the grounded refs must carry each
// play's weight.

/** One-line window-grain read of a busy-times day ("Fri: peak 19h (96), slow 14-16h"). */
function busyDayLine(day: { day_name: string; peak_hour: number; peak_score: number; slow_hours: number[] }): string {
  const slow = day.slow_hours.length ? `, slow ${day.slow_hours.join("/")}h` : ""
  return `${day.day_name}: peak ${day.peak_hour}h (${day.peak_score})${slow}`
}

function selectInput(d: Dossier) {
  // Rival busy curves at window grain (operations@v2's proven trim, flattened to
  // one line per rival). buildDossier's competitor path doesn't populate
  // busyTimes yet (T3) so this rides empty today — fail-soft by design; it arms
  // itself the day T3 lands and claim_the_dead_zone gets its rival-side legs.
  const competitorBusyTimes = d.competitors
    .slice(0, 5)
    .filter((c) => c.busyTimes && c.busyTimes.days.length > 0)
    .map((c) => `${c.name} — ${c.busyTimes!.days.map(busyDayLine).join("; ")}`)

  return {
    // The grounded layer: one line per signal — "[severity|family] type :: title
    // :: summary" — interleaved by family (strongest rows first) so the cap never
    // silently drops a family. severity + family are VISIBLE — v1 hid severity
    // from the model, which made "say which thread is load-bearing" impossible
    // to ground.
    allSignals: interleaveByFamily(d.ruleOutputs, SIGNAL_CAP).map(
      (i) =>
        `[${i.severity}|${signalFamily(i.insight_type)}] ${i.insight_type} :: ${i.title} :: ${
          i.summary.length > SUMMARY_CAP ? i.summary.slice(0, SUMMARY_CAP) : i.summary
        }`,
    ),
    // Demand calendar context, one line per event/day.
    events: d.demandCalendar.events
      .slice(0, 6)
      .map(
        (e) =>
          `${e.title ?? "Untitled event"} | ${e.displayedDates ?? e.startDatetime ?? "date unknown"} | ${
            e.venue?.name ?? "venue unknown"
          } | ${e.distanceMiles != null ? `${e.distanceMiles} mi` : "distance unknown"} | ${e.magnitude ?? "?"}/${
            e.role ?? "?"
          }${e.capacityLow != null && e.capacityHigh != null ? ` | capacity ${e.capacityLow}-${e.capacityHigh}` : ""}`,
      ),
    weather: d.demandCalendar.weather
      .slice(0, 4)
      .map(
        (w) =>
          `${w.date}: ${w.weather_condition}, high ${w.temp_high_f}F low ${w.temp_low_f}F, precip ${w.precipitation_in}in${
            w.is_severe ? " (SEVERE)" : ""
          }`,
      ),
    // Guest-voice context: top themes, one truncated example each (the presenter
    // attaches verbatim quotes later; the model needs the shape, not the corpus).
    reviewThemes:
      d.location.reviews?.themes
        .slice(0, 5)
        .map(
          (t) =>
            `${t.theme} (${t.sentiment}, ${t.mentions} mentions)${
              t.examples[0] ? `: "${t.examples[0].slice(0, 100)}"` : ""
            }`,
        ) ?? null,
    // Own rhythm context (window grain — same trim as the rival curves).
    ownBusyTimes: d.location.busyTimes?.days.map(busyDayLine) ?? null,
    // Own posted dayparts — claim_the_dead_zone anchors INSIDE these (HOURS_GATE).
    ownHours: d.profile.hours ?? null,
    ...(competitorBusyTimes.length ? { competitorBusyTimes } : {}),
    profileAttributes: d.profile.attributes,
  }
}

// ── Template kill-list — the CUSTOMER-WRITING backstop (founder mandate 2026-07-03,
//    the ALC Dance Studios postmortem). The named anti-pattern: "ALC Dance Studios
//    is 0.2 miles away, carries a medium enrollment band (40-60 families), and is
//    typed as a school/PTA anchor, so the spirit night vocabulary and mechanics
//    apply directly." — one system module justifying itself to another, in front
//    of a customer. The REAL fix is the playbook's audience doctrine + contrast
//    pairs; this regex set is the minimal deterministic net for the egregious
//    leaks (the founder explicitly rejected deny-listing as the primary fix), so
//    keep it SHORT and PRECISE — every pattern here is a phrase no owner-facing
//    sentence ever needs. Scanned over title + rationale + recipe prose;
//    leverage.basisInternal is INTERNAL (presenter-stripped) and deliberately
//    NOT scanned — sizing math belongs there. ──
const TEMPLATE_PENALTY_PATTERNS = [
  // (1) internal-dialogue / meta-justification (the ALC class)
  /\btyped as\b/i,
  /\b(?:classified|categori[sz]ed|tagged|labeled) as an?\b/i,
  /\barchetype\b/i,
  /\b(?:vocabulary|mechanics)(?: and \w+)? appl(?:y|ies)\b/i,
  /\bqualifies (?:as|for)\b/i,
  /\bthis (?:play|insight|recommendation|move) (?:was|is) (?:selected|generated|chosen|scored)\b/i,
  // (2) internal taxonomy / field names — the engine's vocabulary, never the owner's
  /\bevidence ?refs?\b/i,
  /\binsight[_ ]types?\b/i,
  /\brule outputs?\b/i,
  /\bdossier\b/i,
  /\bcross[- ](?:domain|signal|family)\b/i,
  /\bconvergence\b/i, // the skill's own name must never leak into a customer sentence
  /\bseverity\b/i,
  /\b(?:info|warning|critical)[- ]grade\b/i,
  // (3) score / confidence talk — SHOW the move, never grade it to the customer
  /\b(?:impact|confidence|leverage|combined|novelty|priority) score\b/i,
  /\b(?:high|medium|low|directional)[- ]confidence\b/i,
  /\bconfidence (?:score|level|rating|band)\b/i,
  // (4) the "band" misuse — a size bracket or a non-musical group is NEVER a band
  //     (a dance studio has dancers and families; a gym has members; a church has a
  //     congregation). "book a live band Friday" survives — these target the
  //     bracket usage only.
  /\b(?:enrollment|congregation|membership|attendance|audience|size|customer|headcount) band\b/i,
  /\bcarries an? (?:\w+ ){0,2}band\b/i,
  /\b(?:small|medium|large|mid|larger|smaller) band\b/i,
  // (5) v1's canned floor title — the model must never parrot the legacy template
  /\bline up the threads\b/i,
]

/** True when a play's customer-facing text reads as internal dialogue, taxonomy/
 *  score leakage, the band misuse, or the legacy canned template. */
export function isTemplateAdvice(text: string): boolean {
  return TEMPLATE_PENALTY_PATTERNS.some((re) => re.test(text))
}

// ── Parse: shared coercion + the convergence quality gates ────────────────────
//  (1) FAMILY GATE: every play cites >=3 refs from >=3 distinct signal FAMILIES
//      (run.ts also ground-filters against allowedEvidenceRefs; this enforces the
//      cross-domain bar the "Cross-domain" tag promises — P5 finding D, with the
//      v1 first-token hole closed). Emitting NOTHING when the model found no real
//      combination is correct; the fallback only runs on model FAILURE, so an
//      honest empty result stays empty.
//  (2) KILL-LIST: internal-dialogue / taxonomy / score-talk / band-misuse output
//      is suppressed (the customer-writing backstop above).
//  (3) CAP: at most 2 plays, model's own order kept — one genuine convergence
//      play beats three forced ones (the playbook's quality-over-quantity rule,
//      now enforced rather than asked).
//  (4) STANCE BACKSTOP: the model's deliberate stance wins; unset -> "fix" when
//      any cited base resolves to a warning/critical rule output, else "capture".
//      "maintain" is only ever model-chosen (a convergence play is a move, not a
//      habit) — the five mastered siblings' exact convention.
function parse(raw: unknown, d: Dossier): EnrichedRecommendation[] | null {
  const coerced = coerceEnrichedPlays(raw, {
    skillId: "convergence",
    knowledgeVersion: KNOWLEDGE_VERSION,
    defaultKind: "capitalize",
    defaultOwner: "owner",
  })
  if (coerced === null) return null // unparseable -> deterministic fallback
  const severityByType = new Map(d.ruleOutputs.map((i) => [i.insight_type, i.severity] as const))
  return coerced
    .filter((p) => {
      if (distinctFamilies(p.evidenceRefs).length < REQUIRED_FAMILIES) return false // (1)
      const text = `${p.title} ${p.rationale} ${p.recipe
        .map((s) => `${s.audience} ${s.channel} ${s.offer ?? ""} ${s.copy ?? ""} ${s.creativeDirection ?? ""}`)
        .join(" ")}`
      if (isTemplateAdvice(text)) return false // (2)
      return true
    })
    .slice(0, 2) // (3)
    .map((p) => {
      if (p.stance) return p // the model's deliberate stance wins
      const citesFailure = p.evidenceRefs.some((r) => {
        const sev = severityByType.get(r.split(":")[0])
        return sev === "warning" || sev === "critical"
      })
      return { ...p, stance: citesFailure ? ("fix" as const) : ("capture" as const) } // (4)
    })
}

// ── Deterministic, grounded, NUMBER-FREE fallback (the honest floor) ──────────
//
// Runs ONLY on model failure (timeout / junk output — the deep pass's known
// failure mode is the 120s abort). v1 fired whenever 3 first-token domains
// existed, at ANY severity — so three info-grade rows with zero interaction
// manufactured a canned card, the exact failure the playbook forbids the model.
// v2 is severity-gated and family-honest:
//   - requires >=3 distinct signal FAMILIES (the same gate parse enforces — the
//     floor can never ship a play parse would reject);
//   - picks the STRONGEST signal per family (critical > warning > info,
//     first-seen tiebreak) and leads with the strongest family;
//   - fires ONLY when that lead pick is warning/critical — a calm all-info week
//     yields NOTHING (quality over quantity is self-consistent now);
//   - emits at most ONE play, number-free, stance "fix" (it cites a live
//     warning-grade thread by construction — the sibling backstop convention).
// The copy names the load-bearing thread first — the weakest honest version of
// "say which thread is load-bearing" — and survives the kill-list + lintVoice
// (self-consistency pinned in the tests).
function fallback(d: Dossier): EnrichedRecommendation[] {
  // Strongest signal per family, first-seen tiebreak (Map preserves family
  // first-seen order; set-on-upgrade keeps the slot's position).
  const strongestByFamily = new Map<string, GeneratedInsight>()
  for (const ins of d.ruleOutputs) {
    const fam = signalFamily(ins.insight_type)
    if (!fam) continue
    const cur = strongestByFamily.get(fam)
    if (!cur || (SEV_RANK[ins.severity] ?? 0) > (SEV_RANK[cur.severity] ?? 0)) strongestByFamily.set(fam, ins)
  }
  if (strongestByFamily.size < REQUIRED_FAMILIES) return [] // not enough independent channels for a real combination

  // Strongest families first; JS sort is stable, so equal severities keep
  // family first-seen order. Lead = the load-bearing thread.
  const ranked = [...strongestByFamily.values()].sort(
    (a, b) => (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0),
  )
  const picks = ranked.slice(0, REQUIRED_FAMILIES)
  if ((SEV_RANK[picks[0].severity] ?? 0) < 1) return [] // all info-grade -> an honest quiet floor (the v2 gate)

  const [lead, second, third] = picks
  return [
    {
      title: "Handle the three things moving this week as one plan",
      rationale: `Three different parts of your business are moving at once. The one that carries the most weight: ${lead.title}. Alongside it: ${second.title}; and ${third.title}. Each is easy to shrug off on its own. Together they land on the same few days, so make one plan that answers all three at the same time instead of reacting to each separately.`,
      skillId: "convergence",
      ownerRole: "owner" as const,
      kind: "capitalize" as const,
      category: "convergence" as const,
      // The floor cites a live warning/critical thread by construction -> the
      // sibling stance convention stamps fix (get ahead of it, one plan).
      stance: "fix" as const,
      recipe: [
        {
          channel: "start where the biggest piece lives, then fold the other two into the same plan",
          platforms: [],
          audience: "the customers all three of these point to",
          window: { note: "this week, while the three line up" },
          dependencies: ["confirm each piece is still true before you commit the plan"],
        },
      ],
      // v1 stamped medium here; a canned floor that cannot verify the threads
      // actually interact has NOT earned medium — directional is the honest label.
      confidence: "directional" as const,
      leverage: {
        label: "medium" as const,
        basisInternal:
          "deterministic floor: strongest thread from each of three signal families, at least one warning-grade; sized ordinally, no figure available on this path",
      },
      evidenceRefs: picks.map((p) => p.insight_type),
      knowledgeVersion: KNOWLEDGE_VERSION,
    },
  ]
}

export const convergenceSkill: ProducerSkill = {
  id: "convergence",
  displayName: "Cross-domain convergence strategist",
  ownerRole: "owner",
  kind: "capitalize",
  category: "convergence", // neutral 1.0 prior (scoring-config) — earns rank from evidence, never from the tag
  tier: "reasoning",
  // KEPT deliberately (see the header): the whole-dossier deep pass is this
  // skill's entire mechanism, the registry/plan treat Opus-for-convergence as
  // standing cost policy, and effort is forced "high" by run.ts on this path
  // (a skill-level `effort` override would be dead code here — leave it unset).
  deep: true,
  temperature: 0.5, // ignored on the deep path (Opus + adaptive thinking rejects temperature); kept for the type
  knowledgeVersion: KNOWLEDGE_VERSION,
  knowledge: CONVERGENCE_KNOWLEDGE,
  buildPrompt: (d, k) => buildSkillPrompt(convergenceSkill, d, selectInput(d), k),
  parse,
  fallback,
  // P14 learning hook (new in v2 — v1 was the only skill without one): click
  // feedback learns which COMBINATION SHAPES operators act on (the archetype
  // keys above are the play_type sub-domain); ask routing catches the questions
  // that span domains ("should I stay open later when the arena has a game?").
  // No external stream: there is no benchmark feed for combination judgment —
  // editorial curation is the only accepted injection kind.
  learning: {
    streams: ["click", "ask"],
    playTypeLeadDomain: "convergence",
    acceptedLearningKinds: ["editorial"],
  },
}
