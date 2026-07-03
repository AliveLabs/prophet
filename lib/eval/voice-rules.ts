// ---------------------------------------------------------------------------
// Voice rules — deterministic lint for the Ticket-voice pass (Phase B).
//
// Brand canon: NO em dashes anywhere. Plus a starter chef-lingo deny-list so the
// brief reads for a solo owner at 6am, not for a tasting-menu kitchen. The
// authoritative deny-list ultimately lives in lib/skills/voice/knowledge.md; this
// is the machine-checkable subset the eval/CI gate enforces.
// ---------------------------------------------------------------------------

/** Em dash (U+2014) and en dash (U+2013) — both read as a dash; canon bans the em dash. */
export const EM_DASH = /[—–]/

/**
 * Restaurant/kitchen/ops industry jargon a general audience wouldn't know (ALT-148:
 * ~80% of operators don't use the lingo). Kept conservative to avoid false positives
 * on common words — the plain VERB "covers" ("your plan covers ...") is excluded; only
 * the guest-count NOUN ("incremental covers") is matched via a lookbehind. Matched
 * case-insensitively with word boundaries where sensible.
 */
export const CHEF_LINGO: { term: RegExp; suggest: string }[] = [
  { term: /\bmise en place\b/i, suggest: "prep" },
  { term: /\bà la minute\b/i, suggest: "made to order" },
  { term: /\b86(?:'?d|ed)?\b/i, suggest: "sold out / pulled" },
  { term: /\btwo-?top\b/i, suggest: "table for two" },
  { term: /\bfour-?top\b/i, suggest: "table for four" },
  { term: /\bon the fly\b/i, suggest: "right away" },
  { term: /\bin the weeds\b/i, suggest: "slammed / overwhelmed" },
  { term: /\bback of house\b/i, suggest: "the kitchen" },
  { term: /\bfront of house\b/i, suggest: "the dining room / your servers" },
  // ALT-148: ~80% of operators don't use kitchen/ops lingo. Kill it in generated narrative.
  // "covers" as a guest-count noun — a lookbehind scopes it to count contexts so the plain verb
  // ("the plan covers ...") is never matched. Only "covers" itself is replaced (the qualifier word
  // stays), e.g. "incremental covers" -> "incremental guests".
  { term: /(?<=\b(?:incremental|extra|more|added|weekend|weeknight|lunch|dinner|nightly|daily|those|these|night's|night’s)\s)covers\b/i, suggest: "guests" },
  { term: /\bturn-?and-?burn\b/i, suggest: "fast turns" },
  { term: /\bborrow (?:a|the) crowd\b/i, suggest: "tap into their crowd" },
  // "the floor" / "on the floor" meaning the dining area or staff.
  { term: /\bon the floor\b/i, suggest: "out front" },
  { term: /\bthe floor turns\b/i, suggest: "the dining area turns" },
  { term: /\bget the floor ready\b/i, suggest: "get your team ready" },
  // "knock-on" window and "kickoff" as a time/start window (sports kickoff stays plain English elsewhere).
  // Absorb a leading "the " so "the knock-on window" -> "the rush right after" (no doubled article).
  { term: /\b(?:the\s+)?knock-?on(?:\s+window)?\b/i, suggest: "the rush right after" },
  { term: /\bkickoff window\b/i, suggest: "start window" },
  // ALT-267: "the block" implies literal geographic proximity — a real rival can be miles away.
  { term: /\bthe block'?s\b/i, suggest: "the set's" },
  { term: /\bvs\.? the block\b/i, suggest: "vs the set" },
  { term: /\b(?:on|around)\s+the block\b/i, suggest: "among your competitors" },
  { term: /\bthe block\b/i, suggest: "your competitors / the set" },
  { term: /\byour block\b/i, suggest: "your competitors" },
  // T6 BACKSTOP ONLY (2026-07-03) — the real fix is audience-aware writing at the source (the
  // AUDIENCE_FRAME in prompt-kit.ts + the guerrilla describePartnerForPrompt() + knowledge closer),
  // NOT this deny-list (Bryan was explicit). These catch the specific internal-taxonomy leaks the
  // 2026-07-03 voice audit found in live copy, in case a future prompt edit ever lets one slip past
  // the frame. The "band" rule: "band" is only ever a literal musical band; never a size bracket —
  // a school = families, a gym = members, a church = the congregation.
  { term: /\benrollment band\b/i, suggest: "students and families" },
  { term: /\bcongregation band\b/i, suggest: "members of the congregation" },
  { term: /\bmembership band\b/i, suggest: "members" },
  { term: /\bsize band\b/i, suggest: "size (say the plain count, e.g. roughly 40-60 families)" },
  // "typed as a school/PTA anchor" — the meta-justification leak. Collapse the whole internal phrase.
  { term: /\btyped as (?:an?\s+)?[^.,;]*?\banchor\b/i, suggest: "a good fit" },
]

export type VoiceViolation = { kind: "em_dash" | "chef_lingo"; detail: string }

/** Lint a single string. Returns [] when clean. */
export function lintVoice(text: string | undefined | null): VoiceViolation[] {
  if (!text) return []
  const out: VoiceViolation[] = []
  if (EM_DASH.test(text)) {
    out.push({ kind: "em_dash", detail: "contains an em/en dash; use a period or comma" })
  }
  for (const { term, suggest } of CHEF_LINGO) {
    const m = text.match(term)
    if (m) out.push({ kind: "chef_lingo", detail: `"${m[0]}" -> "${suggest}"` })
  }
  return out
}
