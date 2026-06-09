// Ask Ticket — bounded NL query over the location's own data. Server-side (key private),
// prod-guarded, cost-bounded (question length capped, short max_tokens in answerQuestion).

import { gatherAskContext } from "@/lib/ask/gather"
import { answerQuestion, MAX_QUESTION_LEN } from "@/lib/ask/answer"
import { WAGYU_LOCATION_ID } from "@/app/preview/preview-data"

export async function POST(req: Request) {
  if (process.env.VERCEL_ENV === "production") return new Response("Not found", { status: 404 })

  let question = ""
  try {
    const body = (await req.json()) as { question?: unknown }
    if (typeof body?.question === "string") question = body.question
  } catch {
    /* bad/empty body handled below */
  }
  question = question.trim().slice(0, MAX_QUESTION_LEN)
  if (!question) return Response.json({ error: "question required" }, { status: 400 })

  try {
    const ctx = await gatherAskContext(WAGYU_LOCATION_ID)
    const answer = await answerQuestion(ctx, question)
    return Response.json(answer)
  } catch {
    return Response.json({ answer: "Something went wrong answering that. Try again in a moment.", confidence: "low", sources: [], grounded: false })
  }
}
