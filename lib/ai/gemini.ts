const GEMINI_INSIGHTS_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent"

type GeminiCandidate = {
  content?: {
    parts?: Array<{
      text?: string
    }>
  }
}

type GeminiResponse = {
  candidates?: GeminiCandidate[]
}

function getGeminiKey() {
  const key = process.env.GOOGLE_AI_API_KEY
  if (!key) {
    throw new Error("GOOGLE_AI_API_KEY is not configured")
  }
  return key
}

function parseJson(text: string) {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf("{")
    const end = trimmed.lastIndexOf("}")
    if (start === -1 || end === -1 || end <= start) {
      return null
    }
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

export async function generateGeminiJson(prompt: string) {
  const response = await fetch(`${GEMINI_INSIGHTS_URL}?key=${getGeminiKey()}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.3,
      },
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Gemini error: ${response.status} ${text}`)
  }

  const data = (await response.json()) as GeminiResponse
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? ""
  return parseJson(text)
}
