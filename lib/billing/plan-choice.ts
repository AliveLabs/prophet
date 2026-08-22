// ---------------------------------------------------------------------------
// ALT-645 — carrying the visitor's plan choice from the marketing site into onboarding.
//
// THE DEFECT. The marketing pricing page is careful and correct: the Starter tile says "Get
// started" (Starter has no trial, ALT-709) and the Standard tile says "Start free trial". Both then
// linked to the same bare `app.getticket.ai/signup`, so the choice a visitor had just made was
// dropped on the floor. They arrive at the in-app picker with Standard-annual preselected whichever
// tile they clicked, and a Starter clicker is looking at a $249 plan.
//
// WHY IT IS NOT AS SIMPLE AS A REDIRECT. Signup is passwordless, so the plan has to survive
// signup -> magic-link email -> auth callback -> /onboarding -> /onboarding/trial. Threading a query
// param through five hops means five places to drop it. A cookie set once at /signup and read once
// at the picker is two places.
//
// THE COOKIE IS AN INTENT HINT AND NOTHING ELSE. It preselects a cadence and marks a tile. It never
// picks a price, never starts a checkout, and is not read by any billing decision: `/api/stripe/
// checkout` takes its tier and cadence from the request body, which comes from what the operator
// actually clicked in the picker. So a stale, forged or hand-edited cookie can change which tile
// looks highlighted and cannot change what anybody is charged. That is deliberate, and it is why
// this is allowed to be a plain readable cookie rather than something signed.
//
// It degrades to nothing: open the magic link on a different device and the cookie is absent, so
// the picker shows its normal defaults. That is a worse experience than carrying the choice and a
// perfectly correct one, which is the right way round for a hint.
// ---------------------------------------------------------------------------

import { SELF_SERVE_TIERS, type Cadence, type SubscriptionTier } from "@/lib/billing/tiers"

/**
 * The only tiers this module can ever yield: the two with a self-serve checkout.
 *
 * Narrowed deliberately rather than reusing `SubscriptionTier`. The wide type includes `top`
 * (contact-us, no checkout) and `suspended`, neither of which appears in `TIER_PRICING`, so a
 * `SubscriptionTier` here would let a caller write `TIER_PRICING[choice.tier]` and render
 * `$undefined`. Making the type carry the guarantee means the compiler enforces what the runtime
 * validation already does, instead of the two agreeing by convention.
 */
export type SelfServePlanTier = Extract<SubscriptionTier, "entry" | "mid">

export const PLAN_CHOICE_COOKIE = "tk_plan_choice"

/** How long the hint outlives the click. Long enough to read the email tomorrow morning, short
 *  enough that a choice made a fortnight ago does not resurface as though it were current. */
export const PLAN_CHOICE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60

export type PlanChoice = {
  tier?: SelfServePlanTier
  cadence?: Cadence
}

/**
 * The buyer-facing plan names the marketing site uses, mapped to internal tier ids.
 *
 * The marketing site must NOT send `entry`/`mid`: those are internal names that have already been
 * renamed once (ALT-657/ALT-764) and a public URL parameter that leaks them becomes a thing we
 * cannot change. Only the two self-serve plans are accepted. Multi-Location is a contact-us flow
 * with no checkout, so a link claiming to preselect it would be promising something that does not
 * exist.
 */
const PUBLIC_PLAN_NAMES: Record<string, SelfServePlanTier> = {
  starter: "entry",
  standard: "mid",
}

/** Accepted `billing=` values, matching the pricing page's own toggle. */
const PUBLIC_CADENCES: Record<string, Cadence> = {
  monthly: "monthly",
  annual: "annual",
}

/**
 * Parse a plan choice out of untrusted URL parameters.
 *
 * Returns only the fields it recognised, so a garbage `plan` with a valid `billing` still carries
 * the cadence through. Anything unrecognised is dropped silently rather than defaulted: guessing
 * that `plan=pro` meant Standard is how a visitor ends up on a plan they did not pick.
 */
export function parsePlanChoice(params: {
  plan?: string | string[] | null
  billing?: string | string[] | null
}): PlanChoice {
  const one = (v: string | string[] | null | undefined): string | null =>
    typeof v === "string" ? v.trim().toLowerCase() : null

  const planRaw = one(params.plan)
  const billingRaw = one(params.billing)

  const tier = planRaw ? PUBLIC_PLAN_NAMES[planRaw] : undefined
  const cadence = billingRaw ? PUBLIC_CADENCES[billingRaw] : undefined

  const choice: PlanChoice = {}
  // Belt and braces on top of the lookup table: even if someone adds a non-self-serve entry to
  // PUBLIC_PLAN_NAMES later, a tier with no checkout must never arrive here.
  if (tier && (SELF_SERVE_TIERS as readonly SubscriptionTier[]).includes(tier)) choice.tier = tier
  if (cadence) choice.cadence = cadence
  return choice
}

export function isEmptyPlanChoice(choice: PlanChoice): boolean {
  return choice.tier === undefined && choice.cadence === undefined
}

/** Serialise for the cookie. Compact and human-readable, e.g. `entry:annual` or `:annual`. */
export function serialisePlanChoice(choice: PlanChoice): string {
  return `${choice.tier ?? ""}:${choice.cadence ?? ""}`
}

/**
 * Read a plan choice back out of the cookie value.
 *
 * Validated exactly as strictly as the URL parse, because a cookie is no more trustworthy than a
 * query string: it is client-writable, and this one is deliberately unsigned.
 */
export function deserialisePlanChoice(value: string | null | undefined): PlanChoice {
  if (!value) return {}
  const [tierRaw = "", cadenceRaw = ""] = value.split(":")
  const tier = (SELF_SERVE_TIERS as readonly string[]).includes(tierRaw)
    ? (tierRaw as SelfServePlanTier)
    : undefined
  const cadence = PUBLIC_CADENCES[cadenceRaw]
  const choice: PlanChoice = {}
  if (tier) choice.tier = tier
  if (cadence) choice.cadence = cadence
  return choice
}
