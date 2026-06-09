// Ask Ticket — the bounded, answer-first query (the long-promised "Ask Prophet" V1).
// DOMAIN-LOCKED + GROUNDED: answers ONLY from the location's own market/competitor/brief
// data, never the open web or outside knowledge. Per the Chris+Bryan review: "domain-locked
// + cost-controlled, or don't ship it." Pure logic here (prompt build + validation +
// answerQuestion over an injected transport) so it's unit-tested without live calls; the
// Supabase read that assembles the context lives in lib/ask/gather.ts.

import { generateStructured, type Transport } from "@/lib/ai/provider"
import { humanizeRef } from "@/lib/skills/evidence-format"

export type AskInsight = { type: string; title: string; summary: string; dateKey: string }
export type AskContext = {
  restaurantName: string
  competitors: string[]
  insights: AskInsight[]
  brief: { headline: string; deck: string; plays: string[] } | null
}

export type AskAnswer = {
  answer: string
  confidence: "high" | "medium" | "low"
  sources: string[]
  grounded: boolean // false when the data didn't contain the answer
}

export const MAX_QUESTION_LEN = 280

const SYSTEM = (name: string) =>
  [
    `You are Ticket's market analyst for ${name}. Answer the operator's question using ONLY the DATA provided in the user message — their own market, competitor, and brief signals.`,
    "RULES:",
    "- Use ONLY the provided data. If it does not contain the answer, say plainly you do not have that yet (and, if useful, which signal would answer it). NEVER use outside knowledge, NEVER guess, NEVER invent numbers, prices, or competitor facts.",
    "- Stay on this restaurant's market, competitors, demand, reviews, and operations. If asked something off-topic (general knowledge, other businesses, the open web), briefly decline.",
    "- Cite the specific signals you used in `sources` (short labels, e.g. \"Reviews\", \"Competitor: O-Ku\", \"This week's brief\").",
    "- Voice: direct and plain, for a busy owner skimming. No em dashes. No chef jargon. 2 to 4 sentences.",
    'Return ONLY JSON: { "answer": string, "confidence": "high"|"medium"|"low", "sources": string[], "grounded": boolean }. Set grounded=false when the data did not contain the answer.',
  ].join("\n")

export function buildAskPrompt(ctx: AskContext, question: string): { system: string; prompt: string } {
  const lines: string[] = []
  lines.push(`QUESTION: ${question.trim().slice(0, MAX_QUESTION_LEN)}`)
  lines.push("")
  lines.push(`DATA for ${ctx.restaurantName}:`)
  lines.push(`Competitors watched: ${ctx.competitors.length ? ctx.competitors.join(", ") : "(none on file)"}`)
  if (ctx.brief) {
    lines.push(`Latest brief: ${ctx.brief.headline} — ${ctx.brief.deck}`)
    if (ctx.brief.plays.length) lines.push(`Current recommendations: ${ctx.brief.plays.join("; ")}`)
  } else {
    lines.push("Latest brief: (none yet)")
  }
  lines.push("")
  lines.push(ctx.insights.length ? "Recent signals:" : "Recent signals: (none on file)")
  for (const s of ctx.insights) {
    const date = s.dateKey ? ` (${s.dateKey.slice(0, 10)})` : ""
    // humanize the signal label so the model cites readable sources, not raw insight_type keys
    lines.push(`- [${humanizeRef(s.type)}] ${s.title}${s.summary ? ` — ${s.summary}` : ""}${date}`)
  }
  return { system: SYSTEM(ctx.restaurantName), prompt: lines.join("\n") }
}

const CONF = new Set(["high", "medium", "low"])

export function validateAnswer(raw: unknown): AskAnswer | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const answer = typeof r.answer === "string" ? r.answer.trim() : ""
  if (!answer) return null
  return {
    answer,
    confidence: (CONF.has(String(r.confidence)) ? r.confidence : "medium") as AskAnswer["confidence"],
    sources: Array.isArray(r.sources) ? (r.sources as unknown[]).map(String).filter(Boolean).slice(0, 8) : [],
    grounded: r.grounded !== false,
  }
}

/** Answer a bounded question over the location's own data. Transport injectable for tests. */
export async function answerQuestion(
  ctx: AskContext,
  question: string,
  opts: { transport?: Transport } = {},
): Promise<AskAnswer> {
  const { system, prompt } = buildAskPrompt(ctx, question)
  return generateStructured<AskAnswer>(
    { tier: "reasoning", system, prompt, temperature: 0.2, maxOutputTokens: 1024 },
    {
      transport: opts.transport,
      validate: validateAnswer,
      fallback: () => ({
        answer: "I could not put that together from your data just now. Try asking again in a moment.",
        confidence: "low",
        sources: [],
        grounded: false,
      }),
    },
  )
}
