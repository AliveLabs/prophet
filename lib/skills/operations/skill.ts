// ---------------------------------------------------------------------------
// Operations skill — REWRITTEN (operations@v2, 2026-07-02) from a thin
// "staffing/hours/throughput from traffic patterns" advisor into the master of
// the STANDING WEEKLY RHYTHM. Third skill in the one-at-a-time mastery program;
// marketing@v2 (lib/skills/marketing/skill.ts) and reputation@v2
// (feat/reputation-skill-v2) are the proven templates.
//
// WHY: v1's playbook was 25 lines and its fallback shipped the literal template
// "Staff to the demand this pattern shows" — the second of the three
// complained-of sameness templates. Worse, v1's floor fired that advice off ANY
// traffic./hours signal regardless of severity or entity, and EVERY traffic.*
// rule output is COMPETITOR-scoped (verified against the generating code, see
// the table below) — so v1 told the operator to staff THEIR restaurant to a
// RIVAL's curve, off info-grade baseline captures. The template AND the
// misattribution die here.
//
// VERIFIED SIGNAL REALITY (read from lib/insights/traffic-insights.ts,
// lib/insights/rules.ts, lib/insights/weather-context.ts and the pipelines that
// call them — not assumed from the type names):
//   traffic.baseline                competitor   info      fires today (first capture)
//   traffic.surge                   competitor   warning   DORMANT (traffic pipeline passes previous:null)
//   traffic.peak_shift              competitor   info      dormant (same)
//   traffic.extended_busy           competitor   info      dormant (same)
//   traffic.new_slow_period         competitor   info      dormant (same)
//   traffic.competitive_opportunity whole set    info      fires today (competitor_id null)
//   traffic.weather_suppression     weather ctx  info      fires on severe-weather days
//   hours_changed                   competitor   info      fires today (competitor diff loop; no detail fields)
// There is NO own-scoped traffic/hours rule output today. The operator's own
// demand evidence is d.location.busyTimes (populated at dossier build) and
// profile.hours — dossier CONTEXT, not citable refs. The playbook carries the
// entity-attribution doctrine for the model path; the canned floor is gated to
// the one signal class it can frame honestly (see fallback below).
//
// QUALITY MECHANISM (mirrors marketing@v2/reputation@v2, the proven pattern):
//  (1) parse() SUPPRESSES any play that doesn't ground on an operations-family
//      signal (traffic./hours prefixes — in lockstep with domain-map);
//  (2) a template kill-list drops the bare-staffing class (v1's literal fallback
//      title included) AND the sell-the-window class that belongs to marketing
//      (including the canned "targeted promotion"/"competing offer" phrasings
//      embedded in the traffic rules' own recommendations, so the model can
//      never parrot them);
//  (3) confidence is calibrated in the playbook, never hardcoded (the menu-price
//      postmortem: hardcoded confidence is banned);
//  (4) stance is stamped DELIBERATELY: the model is instructed per archetype,
//      and parse() backstops an unset stance from the cited signals' severity
//      (fix on a warning/critical ref, capture otherwise; maintain only ever
//      model-chosen).
//
// HONEST FLOOR: the deterministic fallback fires ONLY on a warning/critical
// rival-shift traffic signal (surge / peak_shift / extended_busy — the class
// whose competitor attribution is explicit in the signal itself), emits at most
// ONE number-free, window-anchored play that attributes the move to the rival
// and prescribes the own-curve verification before any schedule change. It
// never emits bare staffing advice. Info-grade signals (baseline captures,
// set-wide gaps, weather notes, a rival's hours change) never manufacture a
// floor play — a quiet week stays an honest quiet brief. NOTE: because the
// traffic pipeline currently diffs against previous:null, the qualifying types
// are dormant in prod — the floor is correctly silent until snapshot history
// lands, where v1 was loudly wrong today.
//
// TOKEN BUDGET: every input family is hard-capped (guerrilla precedent: a
// ~40k-char prompt at medium effort silently timed out into the fallback).
// competitorBusyTimes rides null today (buildDossier's competitor path doesn't
// populate it — same fail-soft note as marketing@v2); if p95 latency nears the
// 120s abort once that plumbing lands, flip `effort: "low"` (the proven lever).
// ---------------------------------------------------------------------------

import type { Dossier } from "@/lib/insights/dossier/types"
import type { ProducerSkill } from "@/lib/skills/skill-types"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import { buildSkillPrompt, coerceEnrichedPlays } from "@/lib/skills/prompt-kit"
import { selectAdjacentSignals } from "@/lib/skills/domain-map"
import { OPERATIONS_KNOWLEDGE } from "@/lib/skills/operations/knowledge"

const KNOWLEDGE_VERSION = "operations@v2"

// ── The operations archetypes (stable keys — the click-feedback sub-domain the
//    rollup can learn by, mirroring MARKETING_ARCHETYPES / REPUTATION_ARCHETYPES).
//    Defined in the knowledge playbook. ──
export const OPERATIONS_ARCHETYPES = [
  "deploy_to_the_curve",
  "daypart_surgery",
  "throughput_unlock",
  "prep_leveling",
  "peak_drift_watch",
  "quiet_window_cost_down",
] as const
export type OperationsArchetype = (typeof OPERATIONS_ARCHETYPES)[number]

// ── Signal families (v1's prefixes, kept — the verified reality is that these two
//    prefixes cover every operations-family rule output; the widening is in the
//    CONTEXT the model reasons over, not the citable universe). Prefix-matched
//    against insight_type; the same predicates gate parse(), so intake and
//    grounding stay in lockstep, and they stay in lockstep with
//    DOMAIN_PREFIXES.operations in domain-map.ts.
//    OVERLAP IS DELIBERATE: marketing@v2's rhythm family also reads traffic./hours
//    — the same evidence carries a different play per expert (they sell the quiet
//    window; we make it cheap or cut it). The knowledge playbook's WHAT YOU ARE
//    NOT block keeps the OUTPUT lanes separate. ──
function isTrafficSignal(t: string): boolean {
  // All seven traffic.* types (see the verified table above). Includes
  // traffic.weather_suppression — the "don't misread a storm dip" discipline.
  return t.startsWith("traffic.")
}
function isHoursSignal(t: string): boolean {
  // hours_changed — a competitor's posted-hours change (competitor diff loop).
  return t.startsWith("hours")
}
export function isOperationsSignal(t: string): boolean {
  return isTrafficSignal(t) || isHoursSignal(t)
}

// ── Template kill-list (the analogue of marketing's TEMPLATE_PENALTY_PATTERNS).
//    Two classes die here:
//    (1) bare staffing advice — v1's literal fallback title and every "staff up /
//        add more staff / be ready" phrasing the founder review flagged. A
//        legitimate v2 staffing play names the WINDOW, the POSITION or move, and
//        the operational reason; the playbook teaches that bar and this list
//        enforces it.
//    (2) the sell-the-window class — offers/specials/promotions are marketing's
//        lane, including the literal "targeted promotion" / "competing offer"
//        phrasings the traffic rules embed in their own canned recommendations
//        (the model reads those in its input and must never parrot them). ──
const TEMPLATE_PENALTY_PATTERNS = [
  /staff to the demand/i, // v1's literal fallback title — never let the model echo it
  /\bstaff to the (?:curve|pattern|rush|surge)\b/i, // the slogan without a window+position is the same template
  /\bstaff up\b/i,
  /\bstaff (?:accordingly|appropriately|adequately)\b/i,
  /\b(?:add|schedule|bring in|get) (?:more|extra|additional) (?:staff|people|servers|employees|help|hands|bodies)\b/i,
  /\bmore staff on hand\b/i,
  /\bmake sure you(?:'re| are)(?: fully| properly| adequately)? staffed\b/i,
  /\b(?:ensure|maintain) (?:adequate|proper|sufficient|enough|full) (?:staffing|coverage)\b/i,
  /\b(?:adjust|increase|beef up) (?:your )?staffing(?: levels)?\b/i,
  /\bmatch (?:labor|staffing) to (?:the )?demand\b/i, // v1's fallback rationale class
  /\bprepare for (?:the )?(?:increased|higher|extra|more|rising) (?:demand|traffic|volume)\b/i,
  /\bbe (?:ready|prepared) for the (?:rush|surge|crowd|wave)\b/i,
  // marketing's lane — an operations play never sells the window:
  /\b(?:run|launch|offer) an? .{0,24}(?:special|promotion|promo|discount)\b/i,
  /\btargeted promotion\b/i, // the traffic rules' canned rec phrasing — never parrot it
  /\bcompeting offer\b/i, // same source (traffic.surge's embedded recommendation)
]

/** True when a play's user-facing text reads as bare staffing advice or as the
 *  sell-the-window move that belongs to the marketing expert. */
export function isTemplateAdvice(text: string): boolean {
  return TEMPLATE_PENALTY_PATTERNS.some((re) => re.test(text))
}

/** Capped, prefix-filtered slice of grounded rule outputs (token-budget discipline). */
function take(d: Dossier, pred: (t: string) => boolean, cap: number) {
  return d.ruleOutputs.filter((i) => pred(i.insight_type)).slice(0, cap)
}

// ── Input selection (what the model reasons over) ──────────────────────────────────
function selectInput(d: Dossier) {
  // P5 adjacency unchanged: local-demand neighbors (a demand spike explains a blip
  // the schedule should NOT be rebuilt around). Omitted when none.
  const adjacentSignals = selectAdjacentSignals(d, "operations")
  return {
    // HOME-TURF GROUNDED SIGNALS by family (each capped; these are the citable refs).
    trafficSignals: take(d, isTrafficSignal, 8),
    hoursSignals: take(d, isHoursSignal, 2),
    // OWN DEMAND GROUND TRUTH (context; the entity-attribution doctrine keys off it):
    // the operator's own busy curve (populated at dossier build) + posted hours/
    // dayparts (v1 never passed hours — daypart surgery is impossible without them).
    ownBusyTimes: d.location.busyTimes ?? null,
    ownHours: d.profile.hours ?? null,
    // Rival curves — the trade area's rhythm, trimmed to WINDOW grain (day name +
    // peak hour/level + slow hours; the drift and gap reads happen at window grain,
    // and 5 rivals x 7 days x 24 hourly scores would blow the token budget the day
    // the plumbing lands). competitorBusyTimes rides with days:null today
    // (buildDossier's competitor path doesn't populate busyTimes yet — same plumbing
    // gap marketing@v2 documents); fail-soft by design.
    competitorBusyTimes: d.competitors.slice(0, 5).map((c) => ({
      name: c.name,
      days:
        c.busyTimes?.days.map((day) => ({
          day_of_week: day.day_of_week,
          day_name: day.day_name,
          peak_hour: day.peak_hour,
          peak_score: day.peak_score,
          slow_hours: day.slow_hours,
        })) ?? null,
    })),
    // Segment read (drives ONE-change-for-a-solo-operator vs manager-runnable
    // systems for a chain store — see SEGMENT AWARENESS in the playbook).
    segment: {
      tier: d.tier.tier,
      maxLocations: d.tier.maxLocations,
      seats: d.profile.capability.seats ?? null,
      serviceModel: d.profile.attributes.serviceModel ?? null,
    },
    ...(adjacentSignals.length ? { adjacentSignals } : {}),
  }
}

// ── Parse: shared coercion + the operations quality gates ────────────────────────────
//  (1) every play grounds on ≥1 operations-family signal (run.ts also ground-filters
//      against allowedEvidenceRefs; this enforces the DOMAIN so a play can't ride
//      solely on a borrowed local-demand ref);
//  (2) bare-staffing templates and sell-the-window advice are SUPPRESSED (the
//      kill-list above) — the complained-of template class cannot survive parse;
//  (3) stance backstop: keep the model's deliberate stance; when unset, stamp "fix"
//      if any cited operations ref resolves to a warning/critical rule output, else
//      "capture". "maintain" is only ever model-chosen (scoring caps its impact —
//      never weaken that by inferring it).
function parse(raw: unknown, d: Dossier): EnrichedRecommendation[] | null {
  const coerced = coerceEnrichedPlays(raw, {
    skillId: "operations",
    knowledgeVersion: KNOWLEDGE_VERSION,
    defaultKind: "ops",
    defaultOwner: "gm",
  })
  if (coerced === null) return null // unparseable -> deterministic fallback
  const severityByType = new Map(d.ruleOutputs.map((i) => [i.insight_type, i.severity] as const))
  return coerced
    .filter((p) => {
      if (!p.evidenceRefs.some(isOperationsSignal)) return false // (1) domain grounding
      const text = `${p.title} ${p.rationale} ${p.recipe
        .map((s) => `${s.audience} ${s.channel} ${s.offer ?? ""} ${s.copy ?? ""} ${s.creativeDirection ?? ""}`)
        .join(" ")}`
      if (isTemplateAdvice(text)) return false // (2) kill the bare-staffing / sell-the-window classes
      return true
    })
    .map((p) => {
      if (p.stance) return p // the model's deliberate stance wins
      const citesFailure = p.evidenceRefs.some((r) => {
        const sev = severityByType.get(r.split(":")[0])
        return sev === "warning" || sev === "critical"
      })
      return { ...p, stance: citesFailure ? ("fix" as const) : ("capture" as const) } // (3)
    })
}

// ── Deterministic, grounded, NUMBER-FREE fallback ───────────────────────────────────
// NARROW BY DESIGN. Verified attribution reality: every traffic/hours rule output is
// competitor-scoped, so there is NO own-scoped floor trigger to use. The one class a
// canned play can frame honestly is the rival-shift class (surge / peak_shift /
// extended_busy): the signal names the competitor and the window in its own title, so
// the floor can attribute the move to the rival and prescribe the own-curve check
// before any schedule change — never claiming "your traffic" anything (v1's floor did
// exactly that, off info-grade baselines; that defect dies here). Severity-gated to
// warning/critical: baseline captures, set-wide gaps (marketing's window to sell, not
// an ops re-point), a rival going quiet, weather notes, and a rival's hours change
// are all info-grade and/or need the model's nuance — none of them ever manufactures
// a floor play. The quiet-week golden contract holds.
function isRivalShiftSignal(t: string): boolean {
  return t.startsWith("traffic.surge") || t.startsWith("traffic.peak_shift") || t.startsWith("traffic.extended_busy")
}

function fallback(d: Dossier): EnrichedRecommendation[] {
  const ins = d.ruleOutputs.find(
    (i) => isRivalShiftSignal(i.insight_type) && (i.severity === "warning" || i.severity === "critical"),
  )
  if (!ins) return []
  return [
    {
      // Window-anchored (the cited signal names the rival, weekday, and hour; the
      // rationale quotes it), position-aware, and it prescribes verification before
      // action — the opposite of v1's "Staff to the demand this pattern shows".
      title: "Re-point your strongest coverage at the window that moved",
      rationale: `Grounded in ${ins.title}. A rival's busy window moved, and your guests may be moving with it. Before touching anyone's hours, pull your own sales by hour for that same weekday over the last few weeks. If your rush moved with theirs, shift your strongest coverage into the new window and trim the hour it left behind. If your pattern held, change nothing and check again next week.`,
      skillId: "operations",
      ownerRole: "gm" as const,
      kind: "ops" as const,
      stance: "fix" as const, // a warning-grade window shift is a schedule-vs-reality mismatch to correct
      recipe: [
        {
          channel: "scheduling",
          platforms: [],
          audience: "your team working that weekday's shifts",
          window: { note: "the weekday and hour the signal names, checked against your last few weeks" },
          dependencies: [
            "your register's sales-by-hour report for the last few weeks",
            "that weekday's current schedule",
          ],
        },
      ],
      confidence: "medium" as const,
      leverage: {
        label: "medium" as const,
        basisInternal:
          "fallback play; schedule realignment sized ordinally from a rival's verified window shift, no own-curve figure available",
      },
      evidenceRefs: [ins.insight_type],
      knowledgeVersion: KNOWLEDGE_VERSION,
    },
  ]
}

export const operationsSkill: ProducerSkill = {
  id: "operations",
  displayName: "Operations expert (staffing, hours, throughput)",
  ownerRole: "gm",
  kind: "ops",
  category: "operations",
  tier: "reasoning",
  // effort left at the default (medium): the input is hard-capped per family, so the
  // prompt stays well under the ~40k-char size that forced guerrilla to "low".
  // WATCH ITEM: if p95 nears the 120s abort once competitor busy-times plumbing
  // lands (5 rivals x 7 days x 24 hourly scores is real weight), flip to
  // `effort: "low"` (the proven lever) rather than degrading to the fallback.
  //
  // temperature stays at v1's 0.4 ON PURPOSE (vs marketing's 0.6): this is a
  // precision domain — schedules, hours, and people's take-home pay — where
  // discipline beats spread; boldness comes from the playbook, not heat.
  temperature: 0.4,
  knowledgeVersion: KNOWLEDGE_VERSION,
  knowledge: OPERATIONS_KNOWLEDGE,
  selectInput,
  buildPrompt: (d, k) => buildSkillPrompt(operationsSkill, d, selectInput(d), k),
  parse,
  fallback,
  // P14 learning hook (new in v2, mirrors marketing/reputation): click feedback
  // becomes learnable per-archetype via OPERATIONS_ARCHETYPES keys; external trend/
  // editorial snippets (e.g. scheduling-law changes, labor-market shifts) may inform
  // the prompt but never add citable refs.
  learning: {
    streams: ["external", "click", "ask"],
    playTypeLeadDomain: "operations",
    acceptedLearningKinds: ["external_trend", "editorial"],
  },
}
