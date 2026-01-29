export function buildProphetPrompt(input: {
  question: string
  insights: Array<Record<string, unknown>>
  snapshots: Array<Record<string, unknown>>
}) {
  return [
    {
      role: "system",
      content:
        "You are Prophet, a competitive intelligence assistant. Answer only using provided data. Do not infer causality.",
    },
    {
      role: "user",
      content: JSON.stringify(input),
    },
  ]
}
