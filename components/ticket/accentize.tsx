// The two-color headline treatment (ALT-266) — key words accented in rust.
//
// HYBRID picker, decided 2026-07-01:
//   1. MODEL MARKUP: generators may wrap 1-2 pivotal words in [[double brackets]]
//      ("[[Saturday]] looks big"). When markup is present it wins verbatim.
//      Fail-soft: stray/unbalanced brackets are stripped, never rendered raw.
//   2. DETERMINISTIC FALLBACK: content generated before the markup existed (or
//      any unmarked headline) gets an honest rule-based pass — numerals, $ amounts,
//      %/x multipliers, weekday names, and known platform/competitor proper nouns.
// SCOPE: hero + page/section-level headlines ONLY. Small card titles stay
// single-color — accenting every 13px title reads as noise (decision, do not
// extend without Bryan). Static headlines hand-author <em className="tk-em">.
//
// Server-safe: pure string → ReactNode, no hooks.

import type { ReactNode } from "react"
export { stripAccents } from "@/lib/text/accents"

const MARKUP = /\[\[(.+?)\]\]/g

// $ amounts · numbers (opt. %, x, °) · weekdays/weekend · platforms.
// Competitor names ride in via `names` (page data), escaped before use.
const FALLBACK_CORE =
  "\\$[\\d,]+(?:\\.\\d+)?|\\b\\d+(?:[.,]\\d+)?(?:%|x|°F?)?\\b|\\b(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\\b|\\bweekends?\\b|\\bInstagram\\b|\\bFacebook\\b|\\bTikTok\\b|\\bGoogle\\b"

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const MAX_ACCENTS = 3

function em(children: ReactNode, key: number): ReactNode {
  return (
    <em className="tk-em" key={key}>
      {children}
    </em>
  )
}

/** Render a headline with rust-accented key words. `names` = page-known proper
 *  nouns (e.g. competitor names) the fallback should also accent. */
export function accentize(text: string, names: string[] = []): ReactNode {
  if (!text) return text

  // 1 — model markup wins when present
  if (MARKUP.test(text)) {
    MARKUP.lastIndex = 0
    const parts: ReactNode[] = []
    let last = 0
    let n = 0
    for (const m of text.matchAll(MARKUP)) {
      parts.push(text.slice(last, m.index).replace(/\[\[|\]\]/g, ""))
      parts.push(em(m[1], n++))
      last = (m.index ?? 0) + m[0].length
    }
    parts.push(text.slice(last).replace(/\[\[|\]\]/g, ""))
    return <>{parts}</>
  }

  // 2 — deterministic fallback
  const namePart = names.filter(Boolean).map(escapeRe).join("|")
  const re = new RegExp(`(${namePart ? `${namePart}|` : ""}${FALLBACK_CORE})`, "gi")
  const split = text.split(re)
  // nothing to accent, or the accents would swallow most of the line → stay plain
  const matched = split.filter((_, i) => i % 2 === 1)
  if (!matched.length) return text
  const matchedLen = matched.join("").length
  if (matchedLen / text.length > 0.5) return text

  let used = 0
  return (
    <>
      {split.map((part, i) =>
        i % 2 === 1 && used < MAX_ACCENTS ? (used++, em(part, i)) : part,
      )}
    </>
  )
}
