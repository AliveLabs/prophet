// ---------------------------------------------------------------------------
// Local-Demand skill — REWRITTEN (local-demand@v2, 2026-07-02) from a thin
// "events + weather → prepare + capitalize pair" interpreter into the master of
// the DATED DEMAND WINDOW. Fourth skill in the one-at-a-time mastery program;
// marketing@v2 (lib/skills/marketing/), reputation@v2 (feat/reputation-skill-v2)
// and operations@v2 (feat/operations-skill-v2) are the proven templates.
//
// WHY: v1's playbook was 30 lines and its floor emitted TWO canned plays per
// demand signal — "Prepare for the demand this signal points to" AND "Capture
// the crowd this signal brings" (with the paste-anywhere copy "Right by the
// action tonight") — the third founder-flagged sameness class ("event
// heads-up"). Worse, v1's floor fired that pair off ANY demand signal
// regardless of severity, doubling every signal into two near-identical cards.
// The template class AND the two-per-signal doubling die here.
//
// VERIFIED SIGNAL REALITY (read from lib/events/insights.ts,
// lib/insights/weather-context.ts, lib/jobs/pipelines/{events,weather,insights}.ts
// — not assumed from the type names):
//   events.major_lobby_surge        own    warning/critical  fires (impact model; daypart-gated)
//   events.access_suppression       own    warning           fires (impact model; incl. route events)
//   events.weekend_density_spike    area   info/warning(≥50%) fires once snapshot history exists
//   events.upcoming_dense_day       area   info/warning(≥12)  fires (needs a major/high-signal anchor)
//   events.new_high_signal_event    area   info ALWAYS        fires (keyword/ticket-source rule)
//   events.competitor_hosting_event COMP   warning            fires — CEDED to marketing (conquest)
//   events.competitor_event_cadence COMP   info/warning(≥4)   fires — CEDED to marketing (conquest)
//   visual.weather_patio            area*  info ALWAYS        fires (weather pipeline; notability-gated;
//                                                             *patio-photo proxy is COMPETITOR photos)
//   traffic.weather_suppression     ctx    info ALWAYS        fires on severe days (v1 NEVER saw it:
//                                                             its "weather" prefix matched nothing)
//   cross_event_seo_opportunity     own    info ALWAYS        fires (insights pipeline cross-correlation)
// There is NO rule output whose type starts with a bare "weather" — v1's
// "weather" intake prefix matched nothing in prod (verified). The storm signal
// is traffic.weather_suppression; v2 claims it explicitly (overlap with
// operations is deliberate: they read it as "don't restructure on storm data",
// we read it as the storm-day channel shift — different play per expert, the
// program's standing pattern).
//
// QUALITY MECHANISM (mirrors the three exemplars):
//  (1) parse() SUPPRESSES any play that doesn't ground on a demand-family
//      signal (and the ceded competitor-event types are OUTSIDE that family, so
//      a play riding only on a rival's event dies at the gate);
//  (2) a template kill-list drops the prepare-for-demand / get-ready class, the
//      canned capture class (v1's literal titles + copy), AND the generic
//      phrasings the event rules embed in their own canned recommendations
//      ("Capture the crowd before it arrives", "Adjust staffing", "Run a
//      weekend special") so the model can never parrot them;
//  (3) confidence is calibrated in the playbook, never hardcoded (the
//      menu-price postmortem: hardcoded confidence is banned);
//  (4) stance is stamped DELIBERATELY: the model is instructed per archetype
//      (access suppression and the storm shift are FIX-shaped: protecting
//      demand you'd otherwise lose), and parse() backstops an unset stance from
//      the cited signals' severity (fix on warning/critical, capture otherwise;
//      maintain only ever model-chosen — a dated window can't be a habit).
//
// HONEST FLOOR (severity-gated, at most 2 plays TOTAL, never two per signal):
//  - ONE window play on the strongest warning/critical SURGE-class signal
//    (major_lobby_surge > upcoming_dense_day > weekend_density_spike) — the
//    dated-window class whose generator verified the venue/date/count. A
//    warning-grade dated local event IS an unambiguous demand signal (unlike
//    operations' rival-curve case), so the floor speaks — but info-grade
//    keyword events (new_high_signal is ALWAYS info by construction) never
//    manufacture a floor play; the impact model is the rule that decides when
//    an event is big enough to be warning-grade.
//  - ONE fix-stance access play on events.access_suppression (warning) — the
//    order-ahead/delivery pivot; a road closure is a demand RISK.
//  - The patio window play on visual.weather_patio, gated on the profile's OWN
//    hasPatio flag (the signal's patio-photo evidence is a competitor-photo
//    proxy — verified in lib/jobs/pipelines/weather.ts). This family's
//    generator structurally caps severity at info (verified), so severity
//    cannot be its floor gate; the generator's own notability gate (a pleasant
//    break vs the recent stretch, never routine heat) plus the concept-fit
//    gate carry the honesty instead.
//  Competitor event signals never trigger the floor (ceded). Cross-demand and
//  keyword-only signals never trigger the floor. A quiet week stays quiet.
//
// TOKEN BUDGET: every input family is hard-capped and event/weather objects are
// TRIMMED to reasoning-relevant fields (guerrilla precedent: a ~40k-char prompt
// at medium effort silently timed out into the fallback). Effort stays at the
// default (medium); if p95 nears the 120s abort, flip `effort: "low"`.
// ---------------------------------------------------------------------------

import type { Dossier } from "@/lib/insights/dossier/types"
import type { ProducerSkill } from "@/lib/skills/skill-types"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import { buildSkillPrompt, coerceEnrichedPlays } from "@/lib/skills/prompt-kit"
import { selectAdjacentSignals } from "@/lib/skills/domain-map"
import { LOCAL_DEMAND_KNOWLEDGE } from "@/lib/skills/local-demand/knowledge"

const KNOWLEDGE_VERSION = "local-demand@v2"

// ── The local-demand archetypes (stable keys — the click-feedback sub-domain the
//    rollup can learn by, mirroring MARKETING/REPUTATION/OPERATIONS_ARCHETYPES).
//    Defined in the knowledge playbook. ──
export const LOCAL_DEMAND_ARCHETYPES = [
  "event_window_playbook",
  "access_suppression_pivot",
  "dense_day_orchestration",
  "weather_window_move",
  "storm_channel_shift",
  "surge_service_guard",
  "crowd_to_regulars",
] as const
export type LocalDemandArchetype = (typeof LOCAL_DEMAND_ARCHETYPES)[number]

// ── Signal families (redesigned from the verified table above). Prefix-matched
//    against insight_type; the same predicates gate parse(), so intake and
//    grounding stay in lockstep.
//    THE CESSION: events.competitor_* is EXCLUDED — a rival hosting an event or
//    ramping cadence carries THEIR exposure, not a demand window for this
//    operator; marketing@v2's competitor-move family already claims the
//    events.competitor_ prefix (conquest/counter-programming) and the social
//    counter-strategist reads the same field. v1 claimed them via the bare
//    "events." prefix; v2 cedes them deliberately (see WHAT YOU ARE NOT).
//    OVERLAP IS DELIBERATE where it exists: traffic.weather_suppression is also
//    operations' turf (their read: never restructure a schedule on storm-day
//    data; ours: the storm-day channel shift) — same evidence, different play
//    per expert, the program's standing pattern. ──
function isLocalEventSignal(t: string): boolean {
  return t.startsWith("events.") && !t.startsWith("events.competitor_")
}
function isWeatherDemandSignal(t: string): boolean {
  // visual.weather_patio (the patio-day signal) + traffic.weather_suppression
  // (the storm signal v1's intake never matched) + the bare "weather" prefix,
  // which matches NOTHING in prod today (verified) and is kept only so a future
  // weather.* rule family lands in the demand lane by default.
  return t.startsWith("visual.weather") || t.startsWith("traffic.weather_suppression") || t.startsWith("weather")
}
function isCrossDemandSignal(t: string): boolean {
  // cross_event_seo_opportunity (live generator in the insights pipeline,
  // verified): search interest climbing while local events stack up.
  // Corroboration-grade — citable, never a primary trigger, never a floor play.
  return t.startsWith("cross_event")
}
export function isLocalDemandSignal(t: string): boolean {
  return isLocalEventSignal(t) || isWeatherDemandSignal(t) || isCrossDemandSignal(t)
}

// ── Template kill-list (the analogue of the exemplars' TEMPLATE_PENALTY_PATTERNS).
//    Three classes die here:
//    (1) v1's literal floor output — both titles and the paste-anywhere copy;
//    (2) the prepare-for-demand / get-ready / brace-for class (the "event
//        heads-up" sameness the founder flagged) and the bare capture class —
//        a legitimate v2 play names the WINDOW, the MECHANISM, and the TIMING
//        ("the arena empties at nine forty; hold four tables and run the short
//        menu from nine thirty" is the bar);
//    (3) the canned phrasings the event rules embed in their own
//        recommendations, which the model reads in its input and must never
//        parrot ("Capture the crowd before it arrives" is buildSurgeInsight's
//        literal rec title; "Adjust staffing" / "Run a weekend special" /
//        "themed promotion" / "counter-promotion" are the density and
//        competitor rules' canned recs — the last also being marketing's lane). ──
const TEMPLATE_PENALTY_PATTERNS = [
  /prepare for the demand this signal points to/i, // v1's literal floor title #1
  /capture the crowd this signal brings/i, // v1's literal floor title #2
  /right by the action tonight/i, // v1's literal paste-anywhere copy
  /\bcome in before or after\b/i, // the rest of that canned line
  /\bprepare for (?:the )?(?:demand|crowd|crowds|rush|surge|influx|traffic)\b/i,
  /\bget (?:your |the )?(?:team|staff|kitchen) ready\b/i,
  /\bbe (?:ready|prepared) for (?:the )?(?:event|crowd|rush|surge|game|show|weekend)\b/i,
  /\bbrace (?:yourself |your team )?for\b/i,
  /\bcapture the crowd\b/i, // also buildSurgeInsight's canned rec ("Capture the crowd before it arrives")
  /\bcapture (?:the )?(?:foot traffic|overflow|spillover)\b/i,
  /\bconvert foot traffic\b/i, // weekend-spike rule's canned rec phrasing
  /\bstaff up\b/i, // bare staffing is operations' failure mode too — never lead with it
  /\badjust (?:your )?staffing\b/i, // dense-day rule's canned rec — never parrot it
  /\breview scheduling\b/i, // same source
  /\brun a weekend special\b/i, // weekend-spike rule's canned rec
  /\bpost on social media before\b/i, // same source
  /\bpost your proximity\b/i, // surge rule's canned rec phrasing
  /\bthemed promotion\b/i, // new-high-signal rule's canned rec
  /\bcounter[- ]?promotion\b/i, // competitor-hosting rule's canned rec — marketing's lane anyway
  /\bas an alternative to (?:the )?(?:event|competitor)\b/i,
]

/** True when a play's user-facing text reads as the event-heads-up template class,
 *  the bare capture class, or a parroted canned rule recommendation. */
export function isTemplateAdvice(text: string): boolean {
  return TEMPLATE_PENALTY_PATTERNS.some((re) => re.test(text))
}

/** Capped, prefix-filtered slice of grounded rule outputs (token-budget discipline). */
function take(d: Dossier, pred: (t: string) => boolean, cap: number) {
  return d.ruleOutputs.filter((i) => pred(i.insight_type)).slice(0, cap)
}

// ── Input selection (what the model reasons over) ──────────────────────────────────
function selectInput(d: Dossier) {
  // P5 adjacency unchanged: operations + reputation neighbors decide whether a
  // demand spike is opportunity or risk (own throughput limits; "slow when busy"
  // review themes → the surge-service-guard trigger). Omitted when none.
  const adjacentSignals = selectAdjacentSignals(d, "local-demand")
  return {
    // THE DEMAND CALENDAR (context; TRIMMED to reasoning-relevant fields — v1
    // passed whole NormalizedEvent objects). Local events only; metroHooks are
    // structurally marketing's lane and never enter this input.
    calendarEvents: d.demandCalendar.events.slice(0, 6).map((e) => ({
      title: e.title ?? null,
      when: e.authoritativeLocalStart ?? e.startDatetime ?? null,
      venue: e.validatedVenueName ?? e.venue?.name ?? null,
      distanceMiles: e.distanceMiles ?? null,
      magnitude: e.magnitude ?? null,
      role: e.role ?? null,
      capacityHigh: e.capacityHigh ?? null,
      capacityConfidence: e.capacityConfidence ?? null,
      isRouteEvent: e.isRouteEvent ?? false,
      ticketSourceCount: e.ticketsAndInfo?.length ?? 0,
      leagueValidated: e.leagueValidated ?? false,
    })),
    // Forward forecast (live at dossier build) — the weather-window raw material.
    forecast: d.demandCalendar.weather.slice(0, 5).map((w) => ({
      date: w.date,
      highF: w.temp_high_f,
      lowF: w.temp_low_f,
      precipitationIn: w.precipitation_in,
      windMaxMph: w.wind_speed_max_mph,
      condition: w.weather_condition,
      isSevere: w.is_severe,
    })),
    // HOME-TURF GROUNDED SIGNALS by family (each capped; these are the citable refs).
    localEventSignals: take(d, isLocalEventSignal, 6),
    weatherSignals: take(d, isWeatherDemandSignal, 3),
    crossDemandSignals: take(d, isCrossDemandSignal, 1),
    // OWN RHYTHM GROUND TRUTH (context): the capacity-state check — is the
    // window already full? Trimmed to window grain (day + peak + slow hours).
    ownBusyTimes:
      d.location.busyTimes?.days.map((day) => ({
        day_of_week: day.day_of_week,
        day_name: day.day_name,
        peak_hour: day.peak_hour,
        peak_score: day.peak_score,
        slow_hours: day.slow_hours,
      })) ?? null,
    // Segment read (drives concept-fit + how many moves this operator can run —
    // see SEGMENT AWARENESS in the playbook). hasPatio rides here explicitly:
    // every patio play gates on it (the weather signal's patio-photo evidence is
    // a competitor-photo proxy, verified in the weather pipeline).
    segment: {
      tier: d.tier.tier,
      maxLocations: d.tier.maxLocations,
      seats: d.profile.capability.seats ?? null,
      serviceModel: d.profile.attributes.serviceModel ?? null,
      hasPatio: d.profile.attributes.hasPatio ?? null,
      nearVenues: d.profile.attributes.nearVenues ?? [],
    },
    ...(adjacentSignals.length ? { adjacentSignals } : {}),
  }
}

// ── Parse: shared coercion + the local-demand quality gates ─────────────────────────
//  (1) every play grounds on ≥1 demand-family signal (run.ts also ground-filters
//      against allowedEvidenceRefs; this enforces the DOMAIN so a play can't ride
//      solely on a borrowed adjacent ref — or on a ceded events.competitor_* ref);
//  (2) the event-heads-up template class and parroted canned recs are SUPPRESSED
//      (the kill-list above) — the founder-flagged class cannot survive parse;
//  (3) stance backstop: keep the model's deliberate stance; when unset, stamp "fix"
//      if any cited demand ref resolves to a warning/critical rule output (access
//      suppression is warning by construction — a FIX-shaped risk play), else
//      "capture". "maintain" is only ever model-chosen (scoring caps its impact —
//      never weaken that by inferring it; a dated window can't be a habit anyway).
function parse(raw: unknown, d: Dossier): EnrichedRecommendation[] | null {
  const coerced = coerceEnrichedPlays(raw, {
    skillId: "local-demand",
    knowledgeVersion: KNOWLEDGE_VERSION,
    defaultKind: "capitalize",
    defaultOwner: "marketing",
  })
  if (coerced === null) return null // unparseable -> deterministic fallback
  const severityByType = new Map(d.ruleOutputs.map((i) => [i.insight_type, i.severity] as const))
  return coerced
    .filter((p) => {
      if (!p.evidenceRefs.some(isLocalDemandSignal)) return false // (1) domain grounding
      const text = `${p.title} ${p.rationale} ${p.recipe
        .map((s) => `${s.audience} ${s.channel} ${s.offer ?? ""} ${s.copy ?? ""} ${s.creativeDirection ?? ""}`)
        .join(" ")}`
      if (isTemplateAdvice(text)) return false // (2) kill the event-heads-up class
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
// AT MOST 2 PLAYS TOTAL, never two per signal (v1 emitted two per signal — the
// founder-flagged doubling). Three candidate slots in priority order, take two:
//  (a) the strongest warning/critical SURGE-class signal → one window play;
//  (b) events.access_suppression (warning) → one fix-stance access-risk play;
//  (c) visual.weather_patio + the profile's OWN hasPatio → one patio-window play
//      (this family's generator caps severity at info BY CONSTRUCTION — verified —
//      so its honesty gates are the generator's own notability gate + concept fit,
//      not severity).
// Info-grade keyword events (new_high_signal is always info), density days below
// warning, competitor event signals (ceded), storm notes, and cross-demand signals
// never manufacture a floor play — the model path handles their nuance, and a
// quiet week stays an honest quiet brief.
const SURGE_CLASS_PRIORITY = ["events.major_lobby_surge", "events.upcoming_dense_day", "events.weekend_density_spike"] as const

function isSurgeClassSignal(t: string): boolean {
  return SURGE_CLASS_PRIORITY.some((p) => t.startsWith(p))
}

function fallback(d: Dossier): EnrichedRecommendation[] {
  const actionable = (sev: string) => sev === "warning" || sev === "critical"

  // (a) strongest surge-class signal: critical beats warning; type priority breaks ties.
  const surgeCandidates = d.ruleOutputs.filter((i) => isSurgeClassSignal(i.insight_type) && actionable(i.severity))
  const surge = surgeCandidates.sort((a, b) => {
    const sev = (x: (typeof a)) => (x.severity === "critical" ? 0 : 1)
    if (sev(a) !== sev(b)) return sev(a) - sev(b)
    const pri = (x: (typeof a)) => SURGE_CLASS_PRIORITY.findIndex((p) => x.insight_type.startsWith(p))
    return pri(a) - pri(b)
  })[0]

  // (b) the access-risk signal (warning by construction; gate anyway).
  const access = d.ruleOutputs.find((i) => i.insight_type.startsWith("events.access_suppression") && actionable(i.severity))

  // (c) the patio window — concept-gated on the profile's OWN patio flag.
  const patio = d.profile.attributes.hasPatio
    ? d.ruleOutputs.find((i) => i.insight_type.startsWith("visual.weather_patio"))
    : undefined

  const out: EnrichedRecommendation[] = []

  if (surge) {
    out.push({
      // Window-anchored (the cited signal names the event/venue/date; the rationale
      // quotes it), mechanism-specific, and it prescribes the measurement — the
      // opposite of v1's "Prepare for the demand this signal points to".
      title: "Run the event window as its own shift",
      rationale: `Grounded in ${surge.title}. That window has a clock: an arrival wave before it starts and a bigger one after it lets out. Plan that stretch on its own: your fastest reliable dishes up front, a few seats or the order-ahead link held for the wave that fits your setup, and one person owning the door or the phones with honest waits. Afterward, compare that stretch to the same weekday in recent weeks so the next one is a plan, not a guess.`,
      skillId: "local-demand",
      ownerRole: "gm" as const,
      kind: "prepare" as const,
      stance: "capture" as const, // a warning-grade dated demand window is upside to seize
      recipe: [
        {
          channel: "in-store service plan + your order-ahead surface",
          platforms: [],
          audience: "the crowd the signal names, in the window it names",
          window: { note: "the event window in the signal, from just before it opens through the stretch after it lets out" },
          dependencies: [
            "a short list of your fastest reliable dishes",
            "that day's schedule, checked against the window",
          ],
        },
      ],
      confidence: "medium" as const,
      leverage: {
        label: "medium" as const,
        basisInternal: "fallback play; window sized ordinally from a warning-grade dated event signal, no attendance figure asserted",
      },
      evidenceRefs: [surge.insight_type],
      knowledgeVersion: KNOWLEDGE_VERSION,
    })
  }

  if (access) {
    out.push({
      title: "Move that window to order-ahead before the streets decide for you",
      rationale: `Grounded in ${access.title}. When the way to your door clogs, demand reroutes instead of vanishing, and the winners told people how to reach them before it started. Post how to get to you and where to park on your Google profile and your live channels the day before, steer that window to order-ahead and delivery, and stage handoffs out front so nobody circles the lot. If the event is called off or scaled down, drop the plan the same day.`,
      skillId: "local-demand",
      ownerRole: "gm" as const,
      kind: "prepare" as const,
      stance: "fix" as const, // an access closure is demand at risk — protect it, don't chase it
      recipe: [
        {
          channel: "Google Business post + your live channels + order-ahead/delivery",
          platforms: [],
          audience: "regulars and nearby guests who would drive or park during that window",
          window: { note: "posted the day before; in effect for the access window the signal names" },
          dependencies: [
            "a one-line access note (how to reach you, where to park)",
            "order-ahead or delivery switched on for that window",
          ],
        },
      ],
      confidence: "medium" as const,
      leverage: {
        label: "medium" as const,
        basisInternal: "fallback play; loss-avoidance sized ordinally from the access-risk signal, no traffic figure asserted",
      },
      evidenceRefs: [access.insight_type],
      knowledgeVersion: KNOWLEDGE_VERSION,
    })
  }

  if (patio && out.length < 2) {
    out.push({
      title: "Give the patio its own plan while this weather holds",
      rationale: `Grounded in ${patio.title}. A pleasant window after a stretch that was not is when outdoor seats fill first and fastest. Set the patio before the window opens, keep it walk-in friendly instead of holding it back, and post one real phone photo of it set and ready the same day. Weather like this is a short window; treat it like one.`,
      skillId: "local-demand",
      ownerRole: "marketing" as const,
      kind: "capitalize" as const,
      stance: "capture" as const,
      recipe: [
        {
          channel: "the patio itself + Google Business post + your live channels",
          platforms: [],
          audience: "locals deciding today where to sit outside while the weather holds",
          window: { note: "the pleasant days the forecast shows, starting with the first one" },
          creativeDirection: "on your phone, one photo of the patio fully set just before you open, taken from the entrance so the whole space shows",
          dependencies: ["the patio set and ready before the window", "your phone"],
        },
      ],
      confidence: "medium" as const,
      leverage: {
        label: "medium" as const,
        basisInternal: "fallback play; patio window sized ordinally from the notability-gated weather signal plus the profile's own patio flag",
      },
      evidenceRefs: [patio.insight_type],
      knowledgeVersion: KNOWLEDGE_VERSION,
    })
  }

  return out.slice(0, 2)
}

export const localDemandSkill: ProducerSkill = {
  id: "local-demand",
  displayName: "Local-Demand interpreter (events + weather)",
  ownerRole: "marketing",
  kind: "capitalize",
  category: "demand",
  tier: "reasoning",
  // effort left at the default (medium): the input is hard-capped per family and
  // the event/weather objects are trimmed, so the prompt stays well under the
  // ~40k-char size that forced guerrilla to "low". WATCH ITEM: if p95 nears the
  // 120s abort, flip to `effort: "low"` (the proven lever) rather than letting
  // the skill silently degrade to the fallback.
  //
  // temperature stays at v1's 0.5 ON PURPOSE (between marketing's 0.6 and
  // operations' 0.4): window plays need creative mechanism-picking, but they sit
  // against real clocks, dates, and service constraints where drift is costly;
  // boldness comes from the playbook, not heat.
  temperature: 0.5,
  knowledgeVersion: KNOWLEDGE_VERSION,
  knowledge: LOCAL_DEMAND_KNOWLEDGE,
  buildPrompt: (d, k) => buildSkillPrompt(localDemandSkill, d, selectInput(d), k),
  parse,
  fallback,
  // P14 learning hook (new in v2, mirrors the exemplars): click feedback becomes
  // learnable per-archetype via LOCAL_DEMAND_ARCHETYPES keys; external trend/
  // editorial snippets (e.g. event-season patterns, venue calendar changes) may
  // inform the prompt but never add citable refs.
  learning: {
    streams: ["external", "click", "ask"],
    playTypeLeadDomain: "demand",
    acceptedLearningKinds: ["external_trend", "editorial"],
  },
}
