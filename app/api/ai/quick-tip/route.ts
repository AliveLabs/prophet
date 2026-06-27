// ---------------------------------------------------------------------------
// Lightweight Gemini endpoint – generates a single actionable tip
// Called by the RefreshOverlay while the user waits for a long-running action.
// SEC-H2: requires an authenticated session (it spends GOOGLE_AI_API_KEY) and
// length-caps the caller-supplied context (cost + prompt-injection surface).
// ---------------------------------------------------------------------------

import { getUser } from "@/lib/auth/server"
import { clampQuickTipContext } from "@/lib/ai/quick-tip"

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

export async function POST(req: Request) {
  try {
    if (!(await getUser())) {
      return Response.json({ tip: null }, { status: 401 })
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

    return Response.json({ tip })
  } catch {
    return Response.json({ tip: null })
  }
}
