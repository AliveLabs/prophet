// ---------------------------------------------------------------------------
// GET /api/jobs/ambient-feed?location_id=xxx
// SSE stream of ambient insight cards for the loading feed
// ---------------------------------------------------------------------------

import { getJobAuthContext } from "@/lib/jobs/auth"
import { createSSEStream, sseResponse } from "@/lib/jobs/sse"
import { loadAmbientCards } from "@/lib/jobs/ambient-data"

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const locationId = url.searchParams.get("location_id")

  const auth = await getJobAuthContext()
  if (!auth || !locationId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { stream, controller } = createSSEStream()

  ;(async () => {
    try {
      // Phase 1: Send pre-loaded cards from DB
      const cards = await loadAmbientCards(auth.supabase, locationId)
      for (const card of cards) {
        controller.send("card", card)
        await new Promise((r) => setTimeout(r, 200))
      }

      // Phase 2: Generate live tips from Gemini
      const key = process.env.GOOGLE_AI_API_KEY
      if (key) {
        try {
          const { data: location } = await auth.supabase
            .from("locations")
            .select("name, city, region")
            .eq("id", locationId)
            .maybeSingle()

          const locationName = location?.name ?? "a local business"
          const area = [location?.city, location?.region]
            .filter(Boolean)
            .join(", ")

          const prompt = [
            "You are a local business intelligence assistant.",
            `Generate 5 brief, specific, actionable tips for a restaurant/business called "${locationName}" in ${area || "their area"}.`,
            "Each tip should be 1-2 sentences. Be concrete and data-driven.",
            "Return as JSON array of strings: [\"tip1\", \"tip2\", ...]",
          ].join("\n")

          const res = await fetch(`${GEMINI_URL}?key=${key}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: 500, temperature: 0.8 },
            }),
          })

          if (res.ok) {
            const data = await res.json()
            const text =
              data.candidates?.[0]?.content?.parts
                ?.map((p: { text?: string }) => p.text ?? "")
                .join("") ?? ""

            try {
              const jsonMatch = text.match(/\[[\s\S]*\]/)
              if (jsonMatch) {
                const tips = JSON.parse(jsonMatch[0]) as string[]
                let tipIdx = 0
                for (const tip of tips.slice(0, 5)) {
                  controller.send("card", {
                    id: `gemini-tip-${tipIdx++}`,
                    category: "did_you_know",
                    text: tip,
                  })
                  await new Promise((r) => setTimeout(r, 3000))
                }
              }
            } catch {
              /* parse error – ignore */
            }
          }
        } catch {
          /* non-fatal */
        }
      }

      controller.send("done", {})
    } catch {
      /* ignore */
    }

    controller.close()
  })()

  return sseResponse(stream)
}
