// ---------------------------------------------------------------------------
// Shared prompt scaffolding for producer skills (Phase 3).
// Every skill composes: expert persona + operator-capability constraints +
// its domain playbook + the no-execution + grounding + dual-voice rules +
// the EnrichedRecommendation schema + the CLOSED set of citable evidence refs.
// ---------------------------------------------------------------------------

import { buildRefIndex, type Dossier } from "@/lib/insights/dossier/types"
import type { ProducerSkill } from "@/lib/skills/skill-types"

const NO_EXEC = [
  "Spell out the complete plan the operator could hand to staff. Stop before executing.",
  "Never claim to have posted, scheduled, sent, or booked anything. You are the briefing, not the hands.",
].join(" ")

const GROUNDING = [
  "Ground every play in the provided evidence. Each play's evidenceRefs MUST be chosen ONLY from the allowedEvidenceRefs list below.",
  "Never invent a number. Every figure you state (offer price, reach, window) must appear in the provided data.",
  "If you cannot ground a play, do not make it.",
].join(" ")

// Event geography (pretest 2026-06-09: the model does NOT self-gate on a distance
// field — it staffed a "pre-game rush" for a game 22 miles away; these rules are the
// prompt-side backstop, and the structural gate is that far events never reach the
// demand calendar at all).
const EVENT_GEOGRAPHY = [
  "EVENT GEOGRAPHY: events carry distanceMiles (straight-line to this restaurant), magnitude, and role.",
  "Walk-in / foot-traffic claims require distanceMiles <= 0.5 (blocks away). Local traffic, prep, or staffing claims require distanceMiles <= 3.",
  "An event beyond ~3 miles NEVER creates local walk-in, drive-thru, or staffing demand for this restaurant. Do not 'prepare' or 'staff up' for it.",
  "Far-away MAJOR events (role metro_hook, e.g. a pro playoff game across the metro) are MARKETING TIE-IN material only: a themed or conditional promo ('home team wins = free appetizer'), or a watch-party angle if the concept fits. Propose one ONLY with a concrete action; score its impact low; never frame it as nearby or as expected traffic.",
  "Respect the service model in profile.attributes.serviceModel. A 'drive-thru or takeout' quick-service spot has no dining room — don't frame demand as walk-ins; think drive-by, carry-out, and order-ahead. But a 'drive-thru + dine-in' quick-service spot (a QSR WITH a lobby) DOES get foot traffic: model its own surge shape — a post-event lobby can flood (standing room, expo from the window) WHILE the drive-thru wraps then stalls as the lot grids up — so both lobby/walk-in AND drive-thru/order-ahead plays are valid; lean on whichever the evidence points to. A bar or dine-in restaurant uses normal walk-in/seating framing.",
].join(" ")

// Daypart gate (P1): a play must not target a daypart the restaurant doesn't serve.
const HOURS_GATE = [
  "DAYPARTS: respect profile.hours (Google 'serves' flags). If servesLunch is false, do NOT propose a lunch play, lunch special, or midday daypart move; same for breakfast/dinner/brunch.",
  "A flag that is absent/unknown means we don't know — do not assert the daypart is closed, but don't build the play's whole premise on an unconfirmed daypart either. When hours are known, anchor windows to dayparts the restaurant actually serves.",
].join(" ")

const CREATIVE_AND_CHANNEL = [
  "Creative direction must be PHONE-FIRST: describe a photo or short video the owner can capture on their own phone, in plain words (what to point the camera at, when, what to show).",
  "Assume NO special equipment or skills. Do not use photography jargon ('golden hour', 'side light', 'tight crop', 'no text overlay', 'plating') or assume a camera, lighting, or an editor.",
  "If a more produced shot would genuinely help, add it as an explicitly OPTIONAL extra (\"optional: if you have someone who shoots video, ...\"), never as the baseline ask.",
  "When a play is social, give guidance for the operator's live platforms BY NAME and tailor it to each (e.g. Instagram and TikTok favor a short vertical video or Reel; the feed favors one strong photo). Never just say 'post it'.",
].join(" ")

function capabilityLine(d: Dossier): string {
  const c = d.profile.capability
  const parts = [
    c.marketingBudgetBand ? `budget ${c.marketingBudgetBand}` : null,
    c.whoRunsMarketing ? `marketing run by ${c.whoRunsMarketing}` : null,
    c.liveChannels?.length ? `channels live: ${c.liveChannels.join(", ")}` : null,
    c.posCapabilities?.length ? `POS can: ${c.posCapabilities.join(", ")}` : null,
    c.seats != null ? `${c.seats} seats` : null,
  ].filter(Boolean)
  return parts.length
    ? `This operator can realistically execute: ${parts.join("; ")}. Recommend ONLY what THIS operator can do; never assume an ad team or budget they lack.`
    : "Operator capability is unknown; bias toward low-budget, owner-executable plays."
}

function voiceLine(d: Dossier): string {
  return [
    "Two voices: the narrative fields (title, rationale) are Ticket's voice — direct, plain, no em dashes, no chef jargon, written for a busy owner skimming at 6am.",
    `The recipe 'copy' field is CUSTOMER-FACING and must be written in the restaurant's OWN voice as captured during onboarding (tone: ${d.profile.voiceTone}${d.profile.voiceSample ? `; a sample of how they speak: "${d.profile.voiceSample}"` : ""}). Match that tone exactly; do not write customer copy in Ticket's voice.`,
  ].join(" ")
}

const SCHEMA_INSTRUCTION = [
  "Return ONLY a JSON array of plays. Each play:",
  '{ "title": string (the action, plain), "rationale": string (why, cites the evidence in words),',
  '"kind": one of prepare|capitalize|positioning|reputation|ops,',
  '"ownerRole": one of owner|gm|marketing|kitchen|foh,',
  '"confidence": one of high|medium|directional,',
  '"recipe": [ { "channel": string, "platforms": string[], "audience": string, "window": {"note": string, "start"?: string, "end"?: string}, "offer"?: string, "copy"?: string, "creativeDirection"?: string, "dependencies"?: string[] } ],',
  '"leverage"?: { "label": high|medium|low, "reach"?: string (ONLY if grounded in real data), "basisInternal": string },',
  '"evidenceRefs": string[] (chosen ONLY from allowedEvidenceRefs) }',
  "No prose outside the JSON array.",
].join("\n")

/** Compose the system + user prompt for a skill, given the dossier slice it selected.
 *
 *  CACHE-AWARE SPLIT (prompt caching is a prefix match): `systemCached` holds
 *  everything byte-identical across locations and days — persona, domain playbook,
 *  rules, schema — so sequential brief builds (13 locations each morning) reuse it
 *  at ~0.1x input price. The per-location context (name, capability, voice) comes
 *  AFTER the cache breakpoint in `system`; the dossier stays in the user prompt. */
export function buildSkillPrompt(
  skill: ProducerSkill,
  d: Dossier,
  selectedInput: unknown,
): { systemCached: string; system: string; prompt: string } {
  const systemCached = [
    `You are the ${skill.displayName} for Ticket, the expert advisor to a single restaurant. The specific restaurant you are advising is described after these standing instructions.`,
    "",
    "DOMAIN PLAYBOOK:",
    skill.knowledge,
    "",
    "RULES:",
    NO_EXEC,
    GROUNDING,
    EVENT_GEOGRAPHY,
    HOURS_GATE,
    CREATIVE_AND_CHANNEL,
    "",
    SCHEMA_INSTRUCTION,
  ].join("\n")

  const locale = [d.profile.attributes.cuisine, d.profile.attributes.priceTier].filter(Boolean).join(" ")
  const system = [
    `THE RESTAURANT: you are advising ${d.profile.name}${locale ? `, a ${locale} restaurant` : ""}.`,
    capabilityLine(d),
    voiceLine(d),
  ].join("\n")

  const allowedEvidenceRefs = [...buildRefIndex(d).allowedRefs].sort()
  const prompt = JSON.stringify(
    {
      tier: d.tier.tier,
      profile: d.profile,
      input: selectedInput,
      allowedEvidenceRefs,
    },
    null,
    2,
  )
  return { systemCached, system, prompt }
}

/** Defensive coercion of model JSON into a plays array (skills call this in parse). */
export function coercePlays(raw: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[]
  if (raw && typeof raw === "object" && Array.isArray((raw as { plays?: unknown }).plays)) {
    return (raw as { plays: Record<string, unknown>[] }).plays
  }
  return null
}

// ── Shared coercion of raw model JSON into validated EnrichedRecommendation[] ──

const KINDS = new Set(["prepare", "capitalize", "positioning", "reputation", "ops"])
const ROLES = new Set(["owner", "gm", "marketing", "kitchen", "foh"])
const CONF = new Set(["high", "medium", "directional"])

function str(v: unknown): string {
  return typeof v === "string" ? v : ""
}

function coerceStep(raw: unknown): import("@/lib/skills/types").RecipeStep {
  const s = (raw ?? {}) as Record<string, unknown>
  const win = (s.window ?? {}) as Record<string, unknown>
  return {
    channel: str(s.channel) || "the operator's live channels",
    platforms: Array.isArray(s.platforms) ? (s.platforms as unknown[]).map(str).filter(Boolean) : [],
    audience: str(s.audience) || "nearby guests this week",
    window: { note: str(win.note) || "this week", start: str(win.start) || undefined, end: str(win.end) || undefined },
    offer: str(s.offer) || undefined,
    copy: str(s.copy) || undefined,
    creativeDirection: str(s.creativeDirection) || undefined,
    dependencies: Array.isArray(s.dependencies) ? (s.dependencies as unknown[]).map(str).filter(Boolean) : undefined,
  }
}

export type CoerceOpts = {
  skillId: string
  knowledgeVersion: string
  defaultKind: import("@/lib/skills/types").RecKind
  defaultOwner: import("@/lib/skills/types").OwnerRole
}

/** Coerce model JSON into validated plays. Returns null if not an array (-> caller falls back). */
export function coerceEnrichedPlays(
  raw: unknown,
  opts: CoerceOpts,
): import("@/lib/skills/types").EnrichedRecommendation[] | null {
  const arr = coercePlays(raw)
  if (!arr) return null
  const out: import("@/lib/skills/types").EnrichedRecommendation[] = []
  for (const p of arr) {
    const title = str(p.title)
    const recipe = (Array.isArray(p.recipe) ? p.recipe : []).map(coerceStep)
    if (!title || recipe.length === 0) continue
    const lev = p.leverage as Record<string, unknown> | undefined
    out.push({
      title,
      rationale: str(p.rationale),
      skillId: opts.skillId,
      ownerRole: (ROLES.has(str(p.ownerRole)) ? p.ownerRole : opts.defaultOwner) as import("@/lib/skills/types").OwnerRole,
      kind: (KINDS.has(str(p.kind)) ? p.kind : opts.defaultKind) as import("@/lib/skills/types").RecKind,
      recipe,
      confidence: (CONF.has(str(p.confidence)) ? p.confidence : "directional") as import("@/lib/skills/types").Confidence,
      leverage:
        lev && typeof lev === "object"
          ? {
              label: (["high", "medium", "low"].includes(str(lev.label)) ? str(lev.label) : "medium") as "high" | "medium" | "low",
              reach: str(lev.reach) || undefined,
              basisInternal: str(lev.basisInternal),
            }
          : undefined,
      evidenceRefs: Array.isArray(p.evidenceRefs) ? (p.evidenceRefs as unknown[]).map(str).filter(Boolean) : [],
      knowledgeVersion: opts.knowledgeVersion,
    })
  }
  return out
}
