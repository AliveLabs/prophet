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

const KNOWLEDGE_VERSION = "guerrilla@v2.2"

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

/** The partner TYPE(s) this play names from THIS dossier's catalog (a play can mention more than
 *  one). Used by the spirit-night naming rule below; pure + case-insensitive substring match on the
 *  same user-facing text fields the anchor gate reads. */
function namedPartnerTypes(play: EnrichedRecommendation, d: Dossier): Set<string> {
  const hay = [
    play.title,
    play.rationale,
    ...play.recipe.flatMap((s) => [s.audience, s.channel, s.offer ?? "", s.copy ?? "", s.window?.note ?? ""]),
    play.leverage?.basisInternal ?? "",
  ]
    .join("  ")
    .toLowerCase()
  const types = new Set<string>()
  for (const p of d.partnerEntities ?? []) {
    if (p.name && hay.includes(p.name.toLowerCase())) types.add(p.partnerType)
  }
  return types
}

// ── ALT-239: "Spirit Night" is a SCHOOL term — anything else is a "Fundraising Night" ───────────
// The spirit_night archetype can anchor on a school, a youth-sports team/league, OR a church/booster
// (ARCHETYPE_PARTNER_TYPES.spirit_night). "Spirit night" is school vocabulary, though — for a church,
// band, nonprofit, or sports league it reads wrong. So we POST-PROCESS the generated copy: the phrase
// "spirit night" survives ONLY when the play names a school partner; for any non-school anchor it
// becomes "fundraising night". This renames, it does NOT change which play fires or its economics.
const SPIRIT_NIGHT_RE = /\bspirit night(s?)\b/gi
// A separate non-global copy for stateless .test() checks (a /g regex's .test() is stateful —
// it advances lastIndex between calls — so never share one instance across both .test() and .replace()).
const SPIRIT_NIGHT_TEST = /\bspirit nights?\b/i

/** Case-preserving rename of "spirit night" → "fundraising night" (keeps the trailing plural).
 *  "Spirit Night" → "Fundraising Night"; "spirit night" → "fundraising night"; "SPIRIT NIGHT" → "FUNDRAISING NIGHT". */
function renameSpiritNight(text: string): string {
  return text.replace(SPIRIT_NIGHT_RE, (match, plural: string) => {
    const replacement = `fundraising night${plural ?? ""}`
    if (match === match.toUpperCase()) return replacement.toUpperCase()
    if (match[0] === match[0].toUpperCase()) {
      // Title-case each word (the source phrase is title-cased, e.g. "Spirit Night").
      return replacement.replace(/\b\w/g, (c) => c.toUpperCase())
    }
    return replacement
  })
}

/** Apply the school-only "Spirit Night" rule to one play (ALT-239). When the play names a NON-school
 *  partner (or names no school at all), every "spirit night" in its user-facing copy becomes
 *  "fundraising night". A play that names a school keeps "spirit night" untouched. Pure; returns a
 *  new play object (the original is not mutated). */
export function applySpiritNightNaming(play: EnrichedRecommendation, d: Dossier): EnrichedRecommendation {
  const mentionsSpiritNight =
    SPIRIT_NIGHT_TEST.test(play.title) ||
    SPIRIT_NIGHT_TEST.test(play.rationale) ||
    play.recipe.some((s) =>
      SPIRIT_NIGHT_TEST.test(`${s.audience} ${s.channel} ${s.offer ?? ""} ${s.copy ?? ""} ${s.window?.note ?? ""}`),
    ) ||
    SPIRIT_NIGHT_TEST.test(play.leverage?.basisInternal ?? "")
  if (!mentionsSpiritNight) return play // no "spirit night" anywhere — nothing to do (cheap fast path)
  const types = namedPartnerTypes(play, d)
  // Keep "spirit night" ONLY when the play names a literal school partner. Otherwise rename.
  if (types.has("school")) return play
  return {
    ...play,
    title: renameSpiritNight(play.title),
    rationale: renameSpiritNight(play.rationale),
    recipe: play.recipe.map((s) => ({
      ...s,
      channel: renameSpiritNight(s.channel),
      audience: renameSpiritNight(s.audience),
      offer: s.offer != null ? renameSpiritNight(s.offer) : s.offer,
      copy: s.copy != null ? renameSpiritNight(s.copy) : s.copy,
      window: s.window ? { ...s.window, note: renameSpiritNight(s.window.note) } : s.window,
    })),
    leverage: play.leverage
      ? { ...play.leverage, basisInternal: renameSpiritNight(play.leverage.basisInternal) }
      : play.leverage,
  }
}

/** Does this play NAME a real partner entity or a dated event from THIS dossier? The core gate. */
export function namesAnAnchor(play: EnrichedRecommendation, d: Dossier): boolean {
  const hay = [
    play.title,
    play.rationale,
    ...play.recipe.flatMap((s) => [s.audience, s.channel, s.offer ?? "", s.copy ?? "", s.window?.note ?? ""]),
    play.leverage?.basisInternal ?? "",
  ]
    .join("  ")
    .toLowerCase()
  const partnerNamed = (d.partnerEntities ?? []).some((p) => p.name && hay.includes(p.name.toLowerCase()))
  const eventNamed = d.demandCalendar.events.some((e) => {
    const t = (e.validatedVenueName ?? e.venue?.name ?? e.title ?? "").toLowerCase()
    return t.length > 2 && hay.includes(t)
  })
  return partnerNamed || eventNamed
}

// ── T6: pre-translate the internal partner taxonomy into plain owner prose ──────────────────
// The dossier carries INTERNAL taxonomy fields on every partner — `partnerLabel` (e.g. "school /
// PTA"), `sizeBand` ("small|medium|large"), and `sizeProxyKind` ("enrollment band", "congregation
// band", "membership band", "staff headcount", "rooms", …). Those are OUR scaffolding, not the
// restaurant owner's language. When they entered a prompt raw the model echoed them straight into
// customer copy ("carries a medium enrollment band … typed as a school/PTA anchor") — one module
// justifying itself to another, not a friend telling an owner what to do. So we NEVER send the raw
// taxonomy to the model. `describePartnerForPrompt` renders each partner as one plain sentence a
// stranger to this software understands on first read, translating the size proxy into the audience
// the owner actually pictures (a school = students/families, a gym = members, a church = the
// congregation) and turning the coarse band + numeric range into "roughly N-M families/members".
//
// THE "BAND" RULE (Bryan, 2026-07-03): the word "band" belongs ONLY to a literal musical band. A
// dance studio is its dancers and their families, a gym is its members, a church is its congregation.
// We never say "enrollment band" / "membership band" / "size band"; we say "roughly 40-60 families".
// This is the PRIMARY fix — audience-aware writing at the source — not the voice-rules deny-list
// (that stays a backstop for anything a future edit lets slip through).

/** What audience a partner TYPE actually hands the restaurant, in the owner's own words. The KEY
 *  translation: it converts the internal `sizeProxyKind` (which carries the "…band" jargon) into a
 *  plain noun the owner pictures. Keyed by partnerType so it never depends on the raw proxy string. */
function audienceNounForPartner(p: PartnerEntitySummary): { singular: string; plural: string; place: string } {
  switch (p.partnerType) {
    case "school":
      return { singular: "family", plural: "families", place: "a nearby school" }
    case "youth_sports":
      return { singular: "family", plural: "families", place: "a nearby youth sports team or league" }
    case "church":
      return { singular: "member", plural: "members of the congregation", place: "a nearby church" }
    case "gym":
      return { singular: "member", plural: "members", place: "a nearby gym or fitness studio" }
    case "office":
      return { singular: "employee", plural: "employees", place: "a nearby office" }
    case "hospital":
      return { singular: "staff member", plural: "staff", place: "a nearby hospital or clinic" }
    case "hotel":
      return { singular: "room", plural: "rooms of guests", place: "a nearby hotel" }
    case "dealership":
      return { singular: "employee", plural: "staff", place: "a nearby car dealership" }
    case "theater":
      return { singular: "seat", plural: "seats of moviegoers", place: "a nearby theater" }
    case "brewery":
      return { singular: "guest", plural: "taproom guests", place: "a nearby brewery or taproom" }
    case "bakery":
      return { singular: "customer", plural: "regular customers", place: "a nearby bakery or cafe" }
    case "farmers_market":
      return { singular: "shopper", plural: "weekend shoppers", place: "a nearby farmers market" }
    default:
      return { singular: "person", plural: "people", place: "a nearby spot" }
  }
}

/** Plain-English size phrase for a partner — NEVER the word "band". Uses the numeric proxy range when
 *  present ("roughly 40-60 families"), otherwise the ordinal word rendered as plain sizing ("a smaller
 *  / mid-sized / larger" audience). The numbers are the SAME priors as before; only the WORDS change. */
function sizePhraseForPartner(p: PartnerEntitySummary): string {
  const { plural } = audienceNounForPartner(p)
  const low = p.sizeProxyLow
  const high = p.sizeProxyHigh
  if (low != null && high != null && low > 0 && high > 0) {
    return low === high ? `roughly ${low} ${plural}` : `roughly ${low}-${high} ${plural}`
  }
  const ordinal = p.sizeBand === "small" ? "a smaller group of" : p.sizeBand === "large" ? "a large group of" : "a mid-sized group of"
  return `${ordinal} ${plural}`
}

/** Render ONE partner as a single plain sentence for the prompt — the owner-facing description that
 *  REPLACES the raw taxonomy fields (`partnerLabel` / `sizeBand` / `sizeProxyKind`) in selectInput.
 *  Example (the ALC Dance Studios defect): instead of `{ type: "school / PTA", sizeBand: "medium",
 *  sizeProxyKind: "enrollment band" }` the model now sees:
 *    "ALC Dance Studios, a nearby school about 0.2 miles away, with roughly 40-60 families."
 *  No taxonomy names, no "band", no ordinal codes — just the audience the owner pictures. Pure. */
export function describePartnerForPrompt(p: PartnerEntitySummary): string {
  const { place } = audienceNounForPartner(p)
  const dist =
    p.distanceMi != null && Number.isFinite(p.distanceMi)
      ? ` about ${p.distanceMi} ${p.distanceMi === 1 ? "mile" : "miles"} away`
      : " nearby"
  return `${p.name}, ${place}${dist}, with ${sizePhraseForPartner(p)}.`
}

// ── Input selection (what the model reasons over) ───────────────────────────────────────────
// T6: every anchor object now carries a plain-prose `description` (describePartnerForPrompt) and NO
// raw taxonomy fields. The internal ordinals (sizeBand) are kept ONLY where a pure function needs
// them downstream (projectSpiritNightEconomics) — they never ride into the prompt as raw strings.
function selectInput(d: Dossier) {
  const check = ownCheckAverage(d)
  // Build the partner anchor set per archetype, each pre-loaded with its scaled economics where
  // relevant — so the model writes the play around REAL numbers it cannot fabricate.
  const spiritPartners = partnersFor(d, ARCHETYPE_PARTNER_TYPES.spirit_night).slice(0, 4)
  return {
    ownCheckAverage: check, // the scaling input; null → economics stay ordinal
    spiritNightAnchors: spiritPartners.map((p) => {
      // economics are PRIORS scaled by check-avg + size band; the model must use these, not invent.
      // T6: drop the internal `basis` audit trail (it carries the ordinal `sizeBand` field name +
      // value) before it enters the prompt — it exists for the anti-fabrication test, not the model.
      const fullEconomics = projectSpiritNightEconomics(check, p.sizeBand)
      const { basis, ...economicsForPrompt } = fullEconomics
      void basis // internal audit trail; intentionally kept out of the prompt
      return {
        name: p.name,
        // Plain owner-facing description REPLACES raw type/sizeBand/sizeProxyKind (T6). The model
        // writes from this sentence, so no internal taxonomy can leak into customer copy.
        description: describePartnerForPrompt(p),
        distanceMi: p.distanceMi,
        projectedEconomics: economicsForPrompt,
      }
    }),
    workplaceLunchAnchors: servesLunch(d)
      ? partnersFor(d, ARCHETYPE_PARTNER_TYPES.workplace_lunch)
          .slice(0, 4)
          .map((p) => ({ name: p.name, description: describePartnerForPrompt(p), distanceMi: p.distanceMi }))
      : [],
    reciprocalAnchors: partnersFor(d, ARCHETYPE_PARTNER_TYPES.reciprocal_partner)
      .slice(0, 4)
      .map((p) => ({ name: p.name, description: describePartnerForPrompt(p), distanceMi: p.distanceMi })),
    // Sponsorship anchors: teams/boosters/charities you give to for brand presence (qualitative — no
    // scaled $ economics; the win is exposure + goodwill, not a tracked sales return).
    sponsorshipAnchors: partnersFor(d, ARCHETYPE_PARTNER_TYPES.sponsorship)
      .slice(0, 4)
      .map((p) => ({ name: p.name, description: describePartnerForPrompt(p), distanceMi: p.distanceMi })),
    // General-outreach anchors: employers/clinics/dealerships/gyms to drop free trial cards to.
    generalOutreachAnchors: partnersFor(d, ARCHETYPE_PARTNER_TYPES.general_outreach)
      .slice(0, 4)
      .map((p) => ({ name: p.name, description: describePartnerForPrompt(p), distanceMi: p.distanceMi })),
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
  return coerced
    .filter((p) => {
      if (!p.evidenceRefs.some(isGrassrootsSignal)) return false // (1) domain grounding
      const text = `${p.title} ${p.rationale} ${p.recipe.map((s) => `${s.audience} ${s.channel} ${s.offer ?? ""} ${s.copy ?? ""}`).join(" ")}`
      if (isGenericAdvice(text)) return false // (3) kill generic/chamber/flyer
      if (!namesAnAnchor(p, d)) return false // (2) SUPPRESS the entity-less play (the core upgrade)
      return true
    })
    // (4) ALT-239: "Spirit Night" is a school-only term — rename to "Fundraising Night" for any
    //     non-school anchor (church/band/nonprofit/sports league). Naming only; no logic change.
    .map((p) => applySpiritNightNaming(p, d))
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
  // M11 UNTHROTTLE (2026-07-03): restored to "medium". The old "low" pin (2026-06-25) blamed a
  // "~40k-char prompt" timing out >120s → degraded to the number-free fallback. That figure was
  // stale: the P16 refactor already distilled selectInput to slim per-archetype anchor summaries, so
  // the built prompt now measures ~20.9k (bare) / ~26.4k (full partner catalog + dated events) — the
  // SMALLEST of the six producers and BELOW the 25.7-32k band the five mastered siblings run at
  // medium without timing out (measured via the buildPrompt smoke; see rationale.md + M11 diag). A
  // prompt-size regression test guards the ceiling so it can never silently re-bloat past the hazard.
  effort: "medium",
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
