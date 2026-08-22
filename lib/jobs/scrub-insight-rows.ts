// ALT-765: brand-voice compliance for the NIGHTLY insights path.
//
// The asymmetry this fixes: `app/api/ai/insights/generate/route.ts` (the on-demand surface) has
// always called `scrubTicket` on its model-written fields. The nightly pipelines never called it at
// all. Same content type, same customer, two code paths, one guarded.
//
// And `scrubTicket` does two things, so the gap was wider than punctuation: it drops dashes AND
// de-jargons against CHEF_LINGO. So the unguarded path could ship "covers", "front of house" and
// "in the weeds" straight to an operator, which is a rule Bryan has repeated many times, and the
// nightly path is the higher-volume one.
//
// ── Scrubbed at the WRITE boundary, not at each producer ─────────────────────────────────────
//
// Both pipelines accumulate rows and then upsert once (insights.ts and photos.ts). Scrubbing there
// covers every producer, including the twelve or so hardcoded pushes and any added later, and it
// cannot be forgotten by whoever writes the thirteenth. Doing it per-producer is how the on-demand
// route and the pipeline drifted apart in the first place.
//
// It also cleans OUR deterministic copy for free: several hardcoded summaries in the pipelines carry
// an em dash ("First snapshot — future runs will compare against this baseline."), and those land in
// the same customer-visible column. The app-copy dash guard does not reach lib/jobs, deliberately:
// that tree is mostly log lines and pipeline_runs reasons, which are sanitised at the display
// boundary instead and would be 250-odd false positives.

import { scrubTicket } from "@/lib/skills/voice"

/**
 * `evidence` is NEVER touched, and this is the load-bearing exception.
 *
 * It carries `reviewThemes[].examples`, which are verbatim snippets of real customer reviews, plus
 * raw numbers and provider fields. Scrubbing it would silently edit what a customer actually wrote,
 * which is both a trust problem and an accuracy one: the brief cites that text as proof. Same
 * exception the brief pipeline holds for `breakoutQuotes` and `evidence[].quote`.
 */
const NEVER_SCRUB = new Set(["evidence"])

// ⚠️ NEVER_SCRUB is belt-and-braces, NOT the operative guard, and an adversarial probe proved it:
// adding "evidence" to NARRATIVE_KEYS changed nothing even with this set emptied.
//
// The guard that actually protects verbatim review text is that `scrubIfString` touches STRINGS and
// DOES NOT RECURSE. `evidence` is always an object, so it passes through untouched whatever the key
// lists say. Making that function "thorough" by walking nested objects and arrays is the change that
// would silently start editing what customers wrote, it compiles cleanly, and it is the single most
// dangerous edit available in this file. A test pins it.

/** The narrative fields an operator reads on an insight row. */
const NARRATIVE_KEYS = ["title", "summary"] as const

function scrubIfString(value: unknown): unknown {
  return typeof value === "string" ? scrubTicket(value) : value
}

/** A recommendation as the pipelines write it: `{ title, rationale }`. */
function scrubRecommendation(rec: unknown): unknown {
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) return rec
  const r = rec as Record<string, unknown>
  return { ...r, title: scrubIfString(r.title), rationale: scrubIfString(r.rationale) }
}

/**
 * Brand-voice scrub over insight rows, applied immediately before the upsert.
 *
 * Returns new objects; the input is not mutated. Unknown keys pass through untouched, so this stays
 * correct as the row shape grows: a new field is simply not scrubbed until it is listed here, which
 * is the safe direction (an unscrubbed field is a copy nit, a wrongly scrubbed one is edited
 * customer data).
 */
export function scrubInsightRows<T extends Record<string, unknown>>(rows: readonly T[]): T[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row }
    for (const key of NARRATIVE_KEYS) {
      if (key in out && !NEVER_SCRUB.has(key)) out[key] = scrubIfString(out[key])
    }
    if (Array.isArray(out.recommendations)) {
      out.recommendations = out.recommendations.map(scrubRecommendation)
    }
    return out as T
  })
}
