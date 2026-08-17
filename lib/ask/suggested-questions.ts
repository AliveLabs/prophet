// ---------------------------------------------------------------------------
// The questions we offer to ask (ALT-634).
//
// Every Ask surface carried its own hardcoded chip list, and the first chip on all of them was
// "Who's undercutting me?". Ask cannot answer it. `gatherAskContext` assembles the location name,
// the watched competitors, busy-times curves, recent insights and the latest brief; there is no
// menu or pricing data in it at all, and menu insights are themselves default-off (ALT-363, menus
// are scraped partially often enough that claims built on them are not trustworthy). So the
// answer prompt does the right thing and says it does not have that yet, which means the most
// prominent invitation on the dashboard leads straight to a dead end.
//
// Chris hit it during his walkthrough and read it as a recommendation rendering before its data
// had landed. It is worse than that: under today's configuration the data never lands.
//
// So the chips are DERIVED from what Ask can answer rather than written next to it and hoped
// about. Pure, so the rule is unit-testable and one list serves every surface.
// ---------------------------------------------------------------------------

/**
 * What Ask can currently ground an answer in. Each flag maps to something `gatherAskContext`
 * actually puts in the context, so a chip cannot outlive its data.
 */
export type AskCapability = {
  /** Recent insights for this location. */
  insights: boolean
  /** A brief has been built, so "before the weekend" has something to read from. */
  brief: boolean
  /** Own and rival busy-times curves. */
  busyTimes: boolean
  /** Watched competitors with ratings. */
  competitors: boolean
  /**
   * Competitor menu and pricing. FALSE today: no menu data reaches the Ask context, and menu
   * insights are behind MENU_INSIGHTS. When that changes, flip this and the chip returns on its
   * own.
   */
  menuPricing: boolean
}

/** What Ask can ground an answer in with nothing loaded. Everything false is a safe floor. */
export const NO_ASK_CAPABILITY: AskCapability = {
  insights: false,
  brief: false,
  busyTimes: false,
  competitors: false,
  menuPricing: false,
}

type Suggestion = { question: string; needs: keyof AskCapability }

/**
 * Ordered best-first. The list is longer than any surface shows so that a location missing one
 * kind of data still gets a full set of chips rather than a gap.
 */
const CATALOGUE: readonly Suggestion[] = [
  { question: "What changed this week?", needs: "insights" },
  { question: "What should I prep before the weekend?", needs: "brief" },
  { question: "Who is busiest on a Friday night?", needs: "busyTimes" },
  { question: "How does my rating compare to the set?", needs: "competitors" },
  { question: "Which competitor moved the most this month?", needs: "insights" },
  // Kept in the catalogue, not deleted: the day menu data is trustworthy this earns its place
  // back automatically. It is last so it never displaces a question we can answer today.
  { question: "Who is undercutting me?", needs: "menuPricing" },
]

/**
 * The questions worth offering, best first.
 *
 * Returns fewer than `limit` (including none) rather than filling the row with questions we
 * cannot answer. An offered question is a promise, and three chips that work beat four where one
 * dead-ends.
 */
export function suggestedAskQuestions(capability: AskCapability, limit = 3): string[] {
  const out: string[] = []
  for (const s of CATALOGUE) {
    if (out.length >= limit) break
    if (!capability[s.needs]) continue
    if (out.includes(s.question)) continue
    out.push(s.question)
  }
  return out
}

/**
 * Capability from what a location actually holds.
 *
 * `menuPricing` is hard-wired false and takes an explicit override, so re-enabling it is a
 * deliberate edit by someone who has read why it is off, not a flag that quietly flips.
 */
export function askCapabilityFrom(input: {
  insightCount: number
  hasBrief: boolean
  hasBusyTimes: boolean
  competitorCount: number
  menuPricingReady?: boolean
}): AskCapability {
  return {
    insights: input.insightCount > 0,
    brief: input.hasBrief,
    busyTimes: input.hasBusyTimes,
    competitors: input.competitorCount > 0,
    menuPricing: input.menuPricingReady === true,
  }
}
