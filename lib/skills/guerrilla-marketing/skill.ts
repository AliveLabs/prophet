// ---------------------------------------------------------------------------
// Guerrilla / Grassroots Marketing skill — UPGRADED (P16 §3.2) from a generic-advice
// emitter into an ENTITY-GROUNDED play generator. Its OWN category "grassroots"
// (neutral 1.0 prior). Runs on the standard reasoning tier (NOT the Opus deep pass).
//
// THE UPGRADE: the skill now reads dossier.partnerEntities (§4.1 partner catalog) +
// demandCalendar.events and EMITS named-anchor archetypes — spirit_night, workplace_lunch,
// reciprocal_partner, event_activation, sponsorship, general_outreach, earned_media_stunt.
// Each archetype REQUIRES a concrete named partner OR a dated event window, or it does
// NOT fire (the core upgrade: SUPPRESS any play that can't name an anchor; penalize
// generic chamber/flyer). Benchmark economics are PRIORS scaled by the location's own
// check-average and the partner's coarse size band — never a fabricated dollar figure.
//
// GROUNDING REALITY (unchanged contract): the only CITABLE evidence is the dossier's
// rule outputs (the closed allowedEvidenceRefs set; run.ts drops any play that cites
// anything else). The partner catalog + the demand calendar are passed as reasoning
// CONTEXT (which named entity to anchor on); a partner NAME is not itself a citable
// figure. So every play still rests on a real events.* / traffic.* / community-social.*
// rule output AND names a real partner entity or dated event — both, or it's suppressed.
//
// FAIL-SOFT: with an EMPTY/absent partner catalog (dossier.partnerEntities empty) AND no
// dated events, the new archetypes can't name an anchor, so they don't fire — the skill
// degrades to its number-free deterministic fallback (today's behavior). The migration is
// pure upside; nothing here throws if partner_catalog is absent.
// ---------------------------------------------------------------------------

import type { Dossier, EntitySignals, PartnerEntitySummary } from "@/lib/insights/dossier/types"
import type { ProducerSkill } from "@/lib/skills/skill-types"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import { buildSkillPrompt, coerceEnrichedPlays } from "@/lib/skills/prompt-kit"
import { GUERRILLA_KNOWLEDGE } from "@/lib/skills/guerrilla-marketing/knowledge"

const KNOWLEDGE_VERSION = "guerrilla@v2"

// ── The named-anchor archetypes (the upgrade). Stable keys: also the click-feedback
//    sub-domain the rollup learns by (which archetype lands per scope). ─────────────────
export const GRASSROOTS_ARCHETYPES = [
  "spirit_night",
  "workplace_lunch",
  "reciprocal_partner",
  "event_activation",
  "sponsorship",
  "general_outreach",
  "earned_media_stunt",
] as const
export type GrassrootsArchetype = (typeof GRASSROOTS_ARCHETYPES)[number]

// Which partner TYPES each entity-anchored archetype may anchor on (the EXPERTISE decides this,
// not the founder's guess). event_activation anchors on a dated event, not a partner type.
const ARCHETYPE_PARTNER_TYPES: Record<Exclude<GrassrootsArchetype, "event_activation" | "earned_media_stunt">, Set<string>> = {
  spirit_night: new Set(["school", "youth_sports", "church"]),
  workplace_lunch: new Set(["office", "hospital", "dealership"]),
  reciprocal_partner: new Set(["gym", "brewery", "bakery", "theater", "hotel", "farmers_market"]),
  // Sponsorship: a team/booster/charity you GIVE to for brand presence (NOT a donation-night like
  // spirit_night). Anchors on the youth-sports / booster / church orgs.
  sponsorship: new Set(["youth_sports", "school", "church"]),
  // General outreach: drop free trial cards to employers / clinics / dealerships / gym (clubs). Broader,
  // lower-commitment than the workplace_lunch standing order; not a mutual swap like reciprocal_partner.
  general_outreach: new Set(["office", "hospital", "dealership", "gym"]),
}

// ── Citable grassroots signals (the closed set this skill may ground a play ON). These are
//    REAL rule outputs that pass run.ts's ground-filter; the partner NAME rides as context. ──
const COMMUNITY_SOCIAL_TYPES = new Set([
  "social.ugc_dominance",
  "social.crowd_perception_gap",
  "social.behind_scenes_opportunity",
])

function isGrassrootsSignal(t: string): boolean {
  return t.startsWith("events.") || t.startsWith("traffic.") || COMMUNITY_SOCIAL_TYPES.has(t)
}

// ── Check-average extraction (the scaling input for economics) ────────────────────────────
// The own dine-in check-average is carried on a menu.price_positioning_shift rule output. Prod
// emits `locationAvgPrice`; older/fixture rows use `your_avg`. Read either; absent → null (the
// economics then fall back to an ordinal, band-only range — never a fabricated number).
export function ownCheckAverage(d: Dossier): number | null {
  for (const ins of d.ruleOutputs) {
    if (ins.insight_type !== "menu.price_positioning_shift") continue
    const ev = (ins.evidence ?? {}) as Record<string, unknown>
    const v = ev.locationAvgPrice ?? ev.your_avg ?? ev.locationAvgCheck
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v
  }
  return null
}

// ── Spirit-night economics: a PRIOR scaled by inputs, never a fabricated figure ─────────────
// Benchmark priors (grounded in LSM/fundraiser practice, see knowledge.ts): a local school/PTA
// night turns roughly 40-60 participating families, 75-90% of those covers are INCREMENTAL
// (new/lapsed). The donation share is 15-20% for a local indie. We SCALE the family count by the
// partner's size band and the restaurant's take by ITS OWN check-average — so every number traces
// to (check-avg × incremental covers × share). With NO check-average we return a band-only ordinal
// result (NO dollar figure) so a play can still fire without ever fabricating money.
const FAMILIES_BY_BAND: Record<string, { low: number; high: number }> = {
  small: { low: 20, high: 40 },
  medium: { low: 40, high: 60 },
  large: { low: 60, high: 120 },
}
const INCREMENTAL_LOW = 0.75
const INCREMENTAL_HIGH = 0.9
const DONATION_SHARE_LOW = 0.15
const DONATION_SHARE_HIGH = 0.2

export type SpiritNightEconomics = {
  /** ordinal upside when no check-average is available (never a fabricated dollar figure). */
  sizing: "ordinal" | "scaled"
  /** participating-family range from the partner's size band (a prior, not a measured count). */
  familiesLow: number
  familiesHigh: number
  donationSharePct: { low: number; high: number }
  /** present ONLY when a real check-average grounds it: incremental-sales + group-donation ranges,
   *  each = check-avg × incremental covers (× share for the donation). Rounded to whole dollars. */
  incrementalSales?: { low: number; high: number }
  groupDonation?: { low: number; high: number }
  /** the inputs every number traces to (anti-fabrication audit trail). */
  basis: { checkAverage: number | null; sizeBand: string }
}

/** Pure + testable. Derives the spirit-night economics for a partner from PRIORS scaled by the
 *  restaurant's own check-average + the partner's size band. NEVER returns a hard-coded dollar
 *  figure: every dollar value is a function of `checkAverage`, so if you change the check-average
 *  the dollars move — the test asserts exactly that (no fabricated absolute). */
export function projectSpiritNightEconomics(
  checkAverage: number | null,
  sizeBand: string,
): SpiritNightEconomics {
  const fam = FAMILIES_BY_BAND[sizeBand] ?? FAMILIES_BY_BAND.medium
  // A non-positive / missing check-average is NOT a real number to scale on — stay ordinal (no $).
  const hasCheck = checkAverage != null && Number.isFinite(checkAverage) && checkAverage > 0
  const base: SpiritNightEconomics = {
    sizing: hasCheck ? "scaled" : "ordinal",
    familiesLow: fam.low,
    familiesHigh: fam.high,
    donationSharePct: { low: Math.round(DONATION_SHARE_LOW * 100), high: Math.round(DONATION_SHARE_HIGH * 100) },
    basis: { checkAverage: hasCheck ? checkAverage : null, sizeBand },
  }
  if (!hasCheck) return base
  // Incremental covers = families × an avg party size of ~2.5 × the incremental fraction.
  // Keep the UNROUNDED sales to derive the donation, then round once — so every output stays
  // EXACTLY proportional to the check-average (doubling the check doubles every dollar; the test
  // asserts this, which is the anti-fabrication guarantee: no hard-coded absolute can sneak in).
  const PARTY = 2.5
  const check = checkAverage as number // narrowed by the hasCheck guard above
  const incLowRaw = fam.low * PARTY * INCREMENTAL_LOW * check
  const incHighRaw = fam.high * PARTY * INCREMENTAL_HIGH * check
  return {
    ...base,
    incrementalSales: { low: Math.round(incLowRaw), high: Math.round(incHighRaw) },
    groupDonation: {
      low: Math.round(incLowRaw * DONATION_SHARE_LOW),
      high: Math.round(incHighRaw * DONATION_SHARE_HIGH),
    },
  }
}

// ── Daypart gate for the lunch driver (don't pitch lunch a spot doesn't serve) ──────────────
function servesLunch(d: Dossier): boolean {
  const h = d.profile.hours
  // Unknown (undefined) → allow (conservative, matches HOURS_GATE); explicit false → block.
  return h?.servesLunch !== false
}

// ── Partner selection per archetype (closest qualifying partner anchors the play) ───────────
function partnersFor(d: Dossier, types: Set<string>): PartnerEntitySummary[] {
  return (d.partnerEntities ?? [])
    .filter((p) => types.has(p.partnerType))
    .sort((a, b) => (a.distanceMi ?? Infinity) - (b.distanceMi ?? Infinity))
}

/** True when the dossier carries ANY nameable grassroots anchor — a partner entity OR a dated
 *  event. When false, NO entity-grounded archetype can fire and the skill falls back to today's
 *  number-free behavior. This is the fail-soft gate the empty-catalog test asserts. */
export function hasNameableAnchor(d: Dossier): boolean {
  const hasPartner = (d.partnerEntities ?? []).length > 0
  const hasDatedEvent = d.demandCalendar.events.some((e) => !!(e.startDatetime ?? e.endDatetime))
  return hasPartner || hasDatedEvent
}

// ── Generic / low-leverage advice the upgrade exists to KILL (penalized + suppressed) ───────
const GENERIC_PENALTY_PATTERNS = [
  /chamber of commerce/i,
  /\bflyer(s|ing)?\b/i,
  /hand[- ]?out/i,
  /\bnetworking (event|mixer)\b/i,
  /partner with local businesses/i, // the old generic line
  /zero-budget move/i, // the old fallback title
]

/** True when a play's user-facing text reads as generic, un-anchored advice (no specific partner). */
export function isGenericAdvice(text: string): boolean {
  return GENERIC_PENALTY_PATTERNS.some((re) => re.test(text))
}

/** Does this play NAME a real partner entity or a dated event from THIS dossier? The core gate. */
export function namesAnAnchor(play: EnrichedRecommendation, d: Dossier): boolean {
  const hay = [
    play.title,
    play.rationale,
    ...play.recipe.flatMap((s) => [s.audience, s.channel, s.offer ?? "", s.copy ?? "", s.window?.note ?? ""]),
    play.leverage?.basisInternal ?? "",
  ]
    .join("  ")
    .toLowerCase()
  const partnerNamed = (d.partnerEntities ?? []).some((p) => p.name && hay.includes(p.name.toLowerCase()))
  const eventNamed = d.demandCalendar.events.some((e) => {
    const t = (e.validatedVenueName ?? e.venue?.name ?? e.title ?? "").toLowerCase()
    return t.length > 2 && hay.includes(t)
  })
  return partnerNamed || eventNamed
}

// ── Input selection (what the model reasons over) ───────────────────────────────────────────
function selectInput(d: Dossier) {
  const check = ownCheckAverage(d)
  // Build the partner anchor set per archetype, each pre-loaded with its scaled economics where
  // relevant — so the model writes the play around REAL numbers it cannot fabricate.
  const spiritPartners = partnersFor(d, ARCHETYPE_PARTNER_TYPES.spirit_night).slice(0, 4)
  return {
    ownCheckAverage: check, // the scaling input; null → economics stay ordinal
    spiritNightAnchors: spiritPartners.map((p) => ({
      name: p.name,
      type: p.partnerLabel,
      distanceMi: p.distanceMi,
      sizeBand: p.sizeBand,
      sizeProxyKind: p.sizeProxyKind,
      // economics are PRIORS scaled by check-avg + size band; the model must use these, not invent.
      projectedEconomics: projectSpiritNightEconomics(check, p.sizeBand),
    })),
    workplaceLunchAnchors: servesLunch(d)
      ? partnersFor(d, ARCHETYPE_PARTNER_TYPES.workplace_lunch)
          .slice(0, 4)
          .map((p) => ({ name: p.name, type: p.partnerLabel, distanceMi: p.distanceMi, sizeBand: p.sizeBand, sizeProxyKind: p.sizeProxyKind }))
      : [],
    reciprocalAnchors: partnersFor(d, ARCHETYPE_PARTNER_TYPES.reciprocal_partner)
      .slice(0, 4)
      .map((p) => ({ name: p.name, type: p.partnerLabel, distanceMi: p.distanceMi })),
    // Sponsorship anchors: teams/boosters/charities you give to for brand presence (qualitative — no
    // scaled $ economics; the win is exposure + goodwill, not a tracked sales return).
    sponsorshipAnchors: partnersFor(d, ARCHETYPE_PARTNER_TYPES.sponsorship)
      .slice(0, 4)
      .map((p) => ({ name: p.name, type: p.partnerLabel, distanceMi: p.distanceMi, sizeBand: p.sizeBand })),
    // General-outreach anchors: employers/clinics/dealerships/gyms to drop free trial cards to.
    generalOutreachAnchors: partnersFor(d, ARCHETYPE_PARTNER_TYPES.general_outreach)
      .slice(0, 4)
      .map((p) => ({ name: p.name, type: p.partnerLabel, distanceMi: p.distanceMi, sizeBand: p.sizeBand })),
    // Dated local events — the event_activation anchor (the demand calendar only carries LOCAL roles).
    datedEvents: d.demandCalendar.events.slice(0, 6).map((e) => ({
      name: e.validatedVenueName ?? e.venue?.name ?? e.title,
      when: e.authoritativeLocalStart ?? e.startDatetime,
      distanceMiles: e.distanceMiles,
      magnitude: e.magnitude,
    })),
    // CITABLE grounding signals (the closed set every play must rest on).
    eventSignals: d.ruleOutputs.filter((i) => i.insight_type.startsWith("events.")),
    trafficSignals: d.ruleOutputs.filter((i) => i.insight_type.startsWith("traffic.")),
    communitySignals: d.ruleOutputs.filter((i) => COMMUNITY_SOCIAL_TYPES.has(i.insight_type)),
    serviceModel: d.profile.attributes.serviceModel ?? null,
    servesLunch: servesLunch(d),
  }
}

// ── Parse: shared coercion + the named-anchor domain gate (THE CORE UPGRADE) ────────────────
// On top of the shared coercion, enforce the upgrade's invariants:
//  (1) every play grounds on ≥1 real grassroots signal (events.*/traffic.*/community-social.*) —
//      run.ts also ground-filters, but this enforces the DOMAIN (don't borrow another skill's ref);
//  (2) the play NAMES a real partner entity OR a dated event — an entity-LESS play is SUPPRESSED;
//  (3) generic chamber/flyer/"partner with local businesses" advice is DROPPED (penalize + suppress).
function parse(raw: unknown, d: Dossier): EnrichedRecommendation[] | null {
  const coerced = coerceEnrichedPlays(raw, {
    skillId: "guerrilla-marketing",
    knowledgeVersion: KNOWLEDGE_VERSION,
    defaultKind: "capitalize",
    defaultOwner: "marketing",
  })
  if (coerced === null) return null // unparseable -> deterministic fallback
  return coerced.filter((p) => {
    if (!p.evidenceRefs.some(isGrassrootsSignal)) return false // (1) domain grounding
    const text = `${p.title} ${p.rationale} ${p.recipe.map((s) => `${s.audience} ${s.channel} ${s.offer ?? ""} ${s.copy ?? ""}`).join(" ")}`
    if (isGenericAdvice(text)) return false // (3) kill generic/chamber/flyer
    if (!namesAnAnchor(p, d)) return false // (2) SUPPRESS the entity-less play (the core upgrade)
    return true
  })
}

// ── Deterministic, grounded, NUMBER-FREE fallback (TODAY's behavior, preserved) ─────────────
// Emits a grassroots play ONLY when a grassroots signal exists to ground it; otherwise nothing.
// This is intentionally the SAME number-free fallback as before the upgrade — the new archetypes
// only fire on the MODEL path (where a populated catalog gives them an anchor). So with an empty
// catalog + a model failure, the brief is byte-identical to today (the fail-soft floor).
function fallback(d: Dossier): EnrichedRecommendation[] {
  const signals = d.ruleOutputs.filter((i) => isGrassrootsSignal(i.insight_type)).slice(0, 2)
  return signals.map((ins) => ({
    title: "Make one move in the neighborhood this week",
    rationale: `Grounded in ${ins.title}. Put yourself in people's path this week with hustle, not spend.`,
    skillId: "guerrilla-marketing",
    ownerRole: "marketing" as const,
    kind: "capitalize" as const,
    category: "grassroots" as const,
    stance: "capture" as const,
    recipe: [
      {
        channel: "the sidewalk / a nearby partner",
        platforms: [],
        audience: "people already passing by or part of a nearby group",
        window: { note: "this week, tied to the moment in the signal" },
        dependencies: ["about an hour of the owner's time", "a marker and paper (no print budget needed)"],
      },
    ],
    confidence: "directional" as const,
    leverage: { label: "medium" as const, basisInternal: "grassroots reach sized ordinally; no turnout figure available" },
    evidenceRefs: [ins.insight_type],
    knowledgeVersion: KNOWLEDGE_VERSION,
  }))
}

export const guerrillaMarketingSkill: ProducerSkill = {
  id: "guerrilla-marketing",
  displayName: "Guerrilla & grassroots marketing expert",
  ownerRole: "marketing",
  kind: "capitalize",
  category: "grassroots",
  tier: "reasoning",
  temperature: 0.6,
  knowledgeVersion: KNOWLEDGE_VERSION,
  knowledge: GUERRILLA_KNOWLEDGE,
  buildPrompt: (d, k) => buildSkillPrompt(guerrillaMarketingSkill, d, selectInput(d), k),
  parse,
  fallback,
  // P14 learning hook: grassroots consumes LSM / fundraiser-econ sources → external_trend priors
  // (e.g. "spirit-night incremental ~75-90% within 60d" as a PRIOR, never a fabricated figure for
  // this restaurant). CLICK feedback by archetype (lead-domain `grassroots`); ASK partnership/event
  // questions route here. Opt-in metadata; injection still gated to ACTIVE rows.
  learning: {
    streams: ["external", "click", "ask"],
    playTypeLeadDomain: "grassroots",
    acceptedLearningKinds: ["external_trend", "editorial"],
  },
}

// Re-exported for the archetype tests + any sibling that needs the gate.
export { isGrassrootsSignal }
