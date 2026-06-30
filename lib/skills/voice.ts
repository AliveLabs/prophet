// ---------------------------------------------------------------------------
// Voice pass (Phase 4) — the final brand layer. Two voices:
//   - Ticket voice for narrative (headline, deck, play title/rationale): plain,
//     no em dashes, no chef jargon, for a busy owner at 6am.
//   - the RESTAURANT's voice for customer-facing recipe.copy (em dashes still banned).
//
// The deterministic scrub GUARANTEES brand compliance (the eval voice checks always
// pass after it). An optional model pass can improve tone first, but the scrub runs
// last so compliance never depends on the model.
// ---------------------------------------------------------------------------

import { EM_DASH, CHEF_LINGO } from "@/lib/eval/voice-rules"
import type { Brief } from "@/lib/skills/types"

function dedash(s: string): string {
  return s.replace(/[—–]/g, ", ").replace(/\s+,/g, ",").replace(/\s{2,}/g, " ").trim()
}

/** Ticket-voice scrub: drop em dashes AND de-jargon. Exported so on-demand LLM
 *  surfaces (e.g. ALT-230 generated insights) can guarantee the same compliance
 *  the brief pipeline gets, without routing through the full skills pipeline. */
export function scrubTicket(s: string): string {
  let t = dedash(s)
  for (const { term, suggest } of CHEF_LINGO) {
    // Single GLOBAL replace — never a `while (term.test) replace` loop: that hangs forever if a
    // replacement ever re-matches its own term (latent infinite-loop landmine). Force the global
    // flag so one pass replaces every occurrence.
    const g = term.flags.includes("g") ? term : new RegExp(term.source, term.flags + "g")
    t = t.replace(g, suggest)
  }
  return t
}

/** Customer-voice scrub: keep the restaurant's tone, just drop em dashes (brand canon). */
function scrubCustomer(s: string): string {
  return dedash(s)
}

/** Deterministic voice compliance over a brief. Always safe to ship. */
export function scrubBrief(brief: Brief): Brief {
  return {
    ...brief,
    headline: scrubTicket(brief.headline),
    deck: scrubTicket(brief.deck),
    plays: brief.plays.map((p) => ({
      ...p,
      title: scrubTicket(p.title),
      rationale: scrubTicket(p.rationale),
      recipe: p.recipe.map((step) => ({
        ...step,
        copy: step.copy ? scrubCustomer(step.copy) : step.copy,
        offer: step.offer ? dedash(step.offer) : step.offer,
        window: { ...step.window, note: dedash(step.window.note) },
      })),
    })),
  }
}

/**
 * The voice pass used by the pipeline. (A model tone-enhancement step can be added
 * here later via the provider; the deterministic scrub below is the compliance floor
 * and the real product behavior today.)
 */
export async function voicePass(brief: Brief): Promise<Brief> {
  return scrubBrief(brief)
}

/** Quick check used by tests/CI: is every narrative field free of em dashes + chef jargon? */
export function isVoiceClean(brief: Brief): boolean {
  const narrative = [brief.headline, brief.deck, ...brief.plays.flatMap((p) => [p.title, p.rationale])]
  if (narrative.some((t) => EM_DASH.test(t))) return false
  if (narrative.some((t) => CHEF_LINGO.some(({ term }) => term.test(t)))) return false
  return true
}
