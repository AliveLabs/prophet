// ---------------------------------------------------------------------------
// Lightweight Gemini endpoint – generates a single actionable tip
// Called by the RefreshOverlay while the user waits for a long-running action
// ---------------------------------------------------------------------------

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const context = String(body.context ?? "").trim()

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
