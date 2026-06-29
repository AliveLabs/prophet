// Ask Ticket — the HOW-TO answering path (ALT-203).
//
// Platform / "how do I use the site" questions are answered FROM the curated how-to
// knowledge base (lib/ask/how-to-kb.ts), NOT from market data and NOT from the open
// web. This sits ALONGSIDE the market-data answerer (lib/ask/answer.ts): the route
// classifies the question, sends platform questions here and market questions there.
//
// Pure logic (classifier + prompt build + answerHowTo over an injected transport) so
// it's unit-testable without live calls, mirroring answer.ts. The classifier is a
// cheap keyword/shape heuristic; the answer is grounded in the matched KB entries via
// the same generateStructured contract, so it degrades honestly when there's no match.

import { generateStructured, type Transport } from "@/lib/ai/provider"
import { HOW_TO_KB, type HowToEntry } from "./how-to-kb"
import type { AskAnswer } from "./answer"
import { MAX_QUESTION_LEN } from "./answer"

// Question shapes that signal a "how do I use the product" ask rather than a market
// question. Kept conservative: a market question like "how is my rating trending" must
// NOT be hijacked, so we require BOTH an instructional shape AND a platform-task match.
const HOWTO_SHAPE = [
  /\bhow (do|can|would|should) i\b/i,
  /\bhow (to|do you)\b/i,
  /\bwhere (do|can|is|are) (i|the|my)\b/i,
  /\bcan i\b/i,
  /\bhow does (this|the site|ticket|the app|the platform)\b/i,
]

// Words that, on their own, push toward a how-to read even without a full shape match
// (e.g. "add a competitor", "invite my manager"). Verb-y, action-on-the-product terms.
const ACTION_HINTS = [
  "add", "remove", "swap", "delete", "invite", "manage", "set up", "setup",
  "pin", "unpin", "connect", "link", "change", "switch", "update", "refresh",
  "enable", "turn on", "turn off", "cancel", "upgrade", "downgrade",
]

function norm(s: string): string {
  // drop apostrophes (so "competitor's" → "competitors"), punctuation → space, collapse.
  return s.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
}

/** Score one KB entry against a normalized question by keyword overlap. */
function scoreEntry(entry: HowToEntry, q: string): number {
  let score = 0
  for (const kw of entry.keywords) {
    if (q.includes(kw)) {
      // longer keyword phrases are stronger signals than single words
      score += kw.includes(" ") ? 3 : 1
    }
  }
  return score
}

export type HowToMatch = { entry: HowToEntry; score: number }

/** Rank KB entries for a question, best first; empties below the floor. */
export function matchHowTo(question: string, limit = 3): HowToMatch[] {
  const q = norm(question)
  if (!q) return []
  return HOW_TO_KB.map((entry) => ({ entry, score: scoreEntry(entry, q) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/**
 * Decide whether a question is a platform/how-to question (vs a market question).
 * Conservative on purpose: returns true only when there's a real KB match AND the
 * question reads instructional (a how-to shape, or an action hint on a strong match).
 * Market questions ("who's undercutting me", "how's my rating") fall through to false.
 */
export function isHowToQuestion(question: string): boolean {
  const raw = question.trim()
  if (!raw) return false
  const q = norm(raw)
  const matches = matchHowTo(raw, 1)
  if (!matches.length) return false

  const hasShape = HOWTO_SHAPE.some((re) => re.test(raw))
  // Word-boundary match so "change" doesn't fire on "changed", "add" not on "address", etc.
  const hasAction = ACTION_HINTS.some((a) => new RegExp(`\\b${a}\\b`, "i").test(q))

  // A strong, multi-word KB hit plus an instructional shape OR an action verb is a how-to.
  // A weak (single-word) hit needs an explicit how-to shape to qualify.
  const top = matches[0]
  if (top.score >= 3) return hasShape || hasAction
  return hasShape
}

const SYSTEM = [
  "You are Ticket's product guide. Answer the operator's question about HOW TO USE the Ticket platform, using ONLY the HELP ENTRIES provided in the user message.",
  "RULES:",
  "- Use ONLY the provided help entries. If they do not cover the question, say plainly you don't have a guide for that yet and suggest reaching out. NEVER invent menus, buttons, or steps that aren't in the entries.",
  "- Give the operator the concrete steps. Reference the on-screen labels exactly as written in the entries.",
  "- Voice: direct and plain, for a busy owner. No em dashes. No jargon. Keep it to a short paragraph or a few quick steps.",
  "- Cite the section(s) you used in `sources` (e.g. \"Competitors\", \"Settings · Billing\").",
  'Return ONLY JSON: { "answer": string, "confidence": "high"|"medium"|"low", "sources": string[], "grounded": boolean }. Set grounded=false only when the entries do not cover the question.',
].join("\n")

export function buildHowToPrompt(question: string, matches: HowToMatch[]): { system: string; prompt: string } {
  const lines: string[] = []
  lines.push(`QUESTION: ${question.trim().slice(0, MAX_QUESTION_LEN)}`)
  lines.push("")
  lines.push("HELP ENTRIES:")
  for (const { entry } of matches) {
    lines.push(`- ${entry.title}`)
    lines.push(`  Where: ${entry.where}`)
    lines.push(`  Summary: ${entry.answer}`)
    lines.push(`  Steps: ${entry.steps.join(" → ")}`)
  }
  return { system: SYSTEM, prompt: lines.join("\n") }
}

const CONF = new Set(["high", "medium", "low"])

function validateAnswer(raw: unknown): AskAnswer | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const answer = typeof r.answer === "string" ? r.answer.trim() : ""
  if (!answer) return null
  return {
    answer,
    confidence: (CONF.has(String(r.confidence)) ? r.confidence : "high") as AskAnswer["confidence"],
    sources: Array.isArray(r.sources) ? (r.sources as unknown[]).map(String).filter(Boolean).slice(0, 8) : [],
    grounded: r.grounded !== false,
  }
}

/**
 * Answer a platform/how-to question from the KB. Caller should gate on isHowToQuestion
 * first; if there's somehow no match we degrade to an honest "no guide yet" answer
 * WITHOUT calling the model. Transport injectable for tests.
 */
export async function answerHowTo(
  question: string,
  opts: { transport?: Transport } = {},
): Promise<AskAnswer> {
  const matches = matchHowTo(question, 3)
  if (!matches.length) {
    return {
      answer:
        "I don't have a step-by-step for that one yet. For account or setup help, reach out and we'll walk you through it.",
      confidence: "low",
      sources: [],
      grounded: false,
    }
  }
  const { system, prompt } = buildHowToPrompt(question, matches)
  return generateStructured<AskAnswer>(
    { tier: "reasoning", system, prompt, temperature: 0.2, maxOutputTokens: 768 },
    {
      transport: opts.transport,
      validate: validateAnswer,
      fallback: () => {
        // Deterministic fallback straight from the top KB entry — never the open web.
        const top = matches[0].entry
        return {
          answer: `${top.answer} Steps: ${top.steps.join("; ")}.`,
          confidence: "medium",
          sources: [top.where],
          grounded: true,
        }
      },
    },
  )
}
