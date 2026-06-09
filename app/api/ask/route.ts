// Ask Ticket — AUTHED bounded NL query over the logged-in operator's own location data
// (Stage A port of /api/preview/ask). The location is resolved server-side from the
// session (never trusted from the client); cost-bounded in answerQuestion.

import { createServerSupabaseClient } from "@/lib/supabase/server"
import { gatherAskContext } from "@/lib/ask/gather"
import { answerQuestion, MAX_QUESTION_LEN } from "@/lib/ask/answer"

export const maxDuration = 60

export async function POST(req: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: auth } = await supabase.auth.getUser()
  const user = auth?.user
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()
  if (!profile?.current_organization_id) {
    return Response.json({ error: "no organization" }, { status: 400 })
  }

  const { data: loc } = await supabase
    .from("locations")
    .select("id")
    .eq("organization_id", profile.current_organization_id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!loc) return Response.json({ error: "no location" }, { status: 400 })

  let question = ""
  try {
    const body = (await req.json()) as { question?: unknown }
    if (typeof body?.question === "string") question = body.question
  } catch {
    /* handled below */
  }
  question = question.trim().slice(0, MAX_QUESTION_LEN)
  if (!question) return Response.json({ error: "question required" }, { status: 400 })

  try {
    const ctx = await gatherAskContext(loc.id)
    const answer = await answerQuestion(ctx, question)
    return Response.json(answer)
  } catch (err) {
    console.error("[ask] failed:", err)
    return Response.json({ answer: "Something went wrong answering that. Try again in a moment.", confidence: "low", sources: [], grounded: false })
  }
}
