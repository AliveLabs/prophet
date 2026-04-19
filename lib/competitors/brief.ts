// ---------------------------------------------------------------------------
// Per-competitor AI intelligence brief — Gemini 2.5 Flash
// ---------------------------------------------------------------------------

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

type BriefInsight = {
  title: string
  summary: string
  severity: string
  insight_type: string
  date_key: string | null
}

export type CompetitorBrief = {
  narrative: string
  suggestedAction: string
}

export async function generateCompetitorBrief(
  competitorName: string,
  insights: BriefInsight[]
): Promise<CompetitorBrief | null> {
  const key = process.env.GOOGLE_AI_API_KEY
  if (!key || insights.length === 0) return null

  const signalSummary = insights
    .slice(0, 15)
    .map(
      (i) =>
        `- [${i.severity.toUpperCase()}] ${i.title}: ${i.summary} (${i.date_key ?? "recent"})`
    )
    .join("\n")

  const prompt = `You are Ticket, a competitive intelligence AI for local businesses.

Given recent signals about a competitor called "${competitorName}", write a brief intelligence summary.

SIGNALS THIS PERIOD:
${signalSummary}

Respond in JSON with exactly two fields:
{
  "narrative": "2-3 sentence analysis of what this competitor is doing and why it matters. Be specific, reference actual data points. Use bold (**text**) for key numbers.",
  "suggestedAction": "1-2 sentence concrete action the business owner should take in response. Be specific and actionable."
}

Only return valid JSON, nothing else.`

  try {
    const res = await fetch(`${GEMINI_URL}?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 400,
          temperature: 0.4,
        },
      }),
    })

    if (!res.ok) return null

    const data = await res.json()
    const text =
      data.candidates?.[0]?.content?.parts
        ?.map((p: { text?: string }) => p.text ?? "")
        .join("")
        .trim() ?? ""

    const jsonStr = text.replace(/```json\n?/g, "").replace(/```\n?/g, "")
    try {
      const parsed = JSON.parse(jsonStr)
      if (parsed.narrative && parsed.suggestedAction) {
        return parsed as CompetitorBrief
      }
    } catch {
      const start = jsonStr.indexOf("{")
      const end = jsonStr.lastIndexOf("}")
      if (start !== -1 && end > start) {
        try {
          const parsed = JSON.parse(jsonStr.slice(start, end + 1))
          if (parsed.narrative && parsed.suggestedAction) {
            return parsed as CompetitorBrief
          }
        } catch {
          // fallthrough
        }
      }
    }
    return null
  } catch {
    return null
  }
}
