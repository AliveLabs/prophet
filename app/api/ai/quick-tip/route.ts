// ---------------------------------------------------------------------------
// Lightweight Gemini endpoint – generates a single actionable tip
// Called by the RefreshOverlay while the user waits for a long-running action.
// SEC-H2: requires an authenticated session (it spends GOOGLE_AI_API_KEY) and
// length-caps the caller-supplied context (cost + prompt-injection surface).
// ---------------------------------------------------------------------------

import { getUser } from "@/lib/auth/server"
import { clampQuickTipContext } from "@/lib/ai/quick-tip"
import { rateLimit, retryAfterSeconds } from "@/lib/http/rate-limit"
import { recordSpendEvent } from "@/lib/ai/spend-events"

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

export async function POST(req: Request) {
  try {
    const user = await getUser()
    if (!user) {
      return Response.json({ tip: null }, { status: 401 })
    }
    // Per-user rate limit: this spends GOOGLE_AI_API_KEY, so cap burst abuse even for a signed-in
    // caller. Fail-open when Upstash is unconfigured (see lib/http/rate-limit).
    const rl = await rateLimit(user.id, { prefix: "quick-tip", limit: 20, windowSeconds: 60 })
    if (!rl.ok) {
      return Response.json({ tip: null }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } })
    }
    const body = await req.json().catch(() => ({}))
    const context = clampQuickTipContext(body.context)

    const key = process.env.GOOGLE_AI_API_KEY
    if (!key || !context) {
      return Response.json({ tip: null })
    }

    const prompt = [
      "You are a local business intelligence assistant.",
      "Given the following context about a local business, generate ONE brief, specific, actionable insight or tip (max 2 sentences).",
      "Be concrete and data-driven. Do not be generic.",
      "Return only the tip text, no JSON, no markdown.",
      "",
      `Context: ${context}`,
    ].join("\n")

    const res = await fetch(`${GEMINI_URL}?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 120,
          temperature: 0.7,
        },
      }),
    })

    if (!res.ok) {
      return Response.json({ tip: null })
    }

    const data = await res.json()
    const tip =
      data.candidates?.[0]?.content?.parts
        ?.map((p: { text?: string }) => p.text ?? "")
        .join("")
        .trim() ?? null

    // Spend telemetry (beta rescue 2.3): fire-and-forget, never awaited so it can't add latency
    // to this latency-sensitive overlay call. No location on this endpoint (context is a caller-
    // supplied string, not a location id).
    const um = data.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } | undefined
    if (um) {
      void recordSpendEvent({
        surface: "quick_tip",
        provider: "gemini",
        model: "gemini-2.5-flash",
        inputTokens: um.promptTokenCount ?? 0,
        outputTokens: (um.candidatesTokenCount ?? 0) + (um.thoughtsTokenCount ?? 0),
      })
    }

    return Response.json({ tip })
  } catch {
    return Response.json({ tip: null })
  }
}
