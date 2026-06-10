// Ask Ticket persistence (complete-picture · Batch 2). Every Q/A lands in
// ask_history — user asks from the route, the pinned standing question from the
// morning brief cron. Writes are server-side only (service_role, mirrors
// daily_briefs); reads scope by location. Loose-typed until ask_history /
// locations.standing_question land in the generated DB types (brand_tolerance
// pattern). Every helper degrades to a no-op/empty result pre-migration.

import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { gatherAskContext } from "@/lib/ask/gather"
import { answerQuestion, type AskAnswer } from "@/lib/ask/answer"

export type AskRecord = {
  id: string
  question: string
  answer: string
  confidence: "high" | "medium" | "low"
  sources: string[]
  grounded: boolean
  source: "user" | "standing"
  createdAt: string
}

// Minimal query surface over the not-yet-generated table types.
type LooseClient = {
  from: (t: string) => {
    insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>
    select: (c: string) => {
      eq: (c: string, v: string) => {
        order: (
          c: string,
          o: { ascending: boolean }
        ) => { limit: (n: number) => Promise<{ data: Record<string, unknown>[] | null; error: unknown }> }
        eq: (c2: string, v2: string) => {
          order: (
            c: string,
            o: { ascending: boolean }
          ) => { limit: (n: number) => Promise<{ data: Record<string, unknown>[] | null; error: unknown }> }
        }
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>
      }
    }
  }
}

function admin(): LooseClient {
  return createAdminSupabaseClient() as unknown as LooseClient
}

/** Persist one Q/A. Failure is never fatal to the ask itself (e.g. pre-migration). */
export async function saveAsk(
  locationId: string,
  question: string,
  answer: AskAnswer,
  source: "user" | "standing",
  askedBy?: string
): Promise<boolean> {
  try {
    const { error } = await admin().from("ask_history").insert({
      location_id: locationId,
      question,
      answer: answer.answer,
      confidence: answer.confidence,
      sources: answer.sources,
      grounded: answer.grounded,
      source,
      asked_by: askedBy ?? null,
    })
    if (error) {
      console.warn("[ask] history save failed:", error.message)
      return false
    }
    return true
  } catch {
    return false
  }
}

function toRecord(r: Record<string, unknown>): AskRecord {
  return {
    id: String(r.id),
    question: String(r.question ?? ""),
    answer: String(r.answer ?? ""),
    confidence: (r.confidence as AskRecord["confidence"]) ?? "low",
    sources: Array.isArray(r.sources) ? (r.sources as string[]) : [],
    grounded: Boolean(r.grounded),
    source: (r.source as AskRecord["source"]) ?? "user",
    createdAt: String(r.created_at ?? ""),
  }
}

/** Recent asks for a location, newest first. Empty pre-migration. */
export async function loadRecentAsks(locationId: string, limit = 10): Promise<AskRecord[]> {
  try {
    const { data } = await admin()
      .from("ask_history")
      .select("id, question, answer, confidence, sources, grounded, source, created_at")
      .eq("location_id", locationId)
      .order("created_at", { ascending: false })
      .limit(limit)
    return (data ?? []).map(toRecord)
  } catch {
    return []
  }
}

/** The latest standing-question answer (the morning re-run), if any. */
export async function loadStandingAnswer(locationId: string): Promise<AskRecord | null> {
  try {
    const { data } = await admin()
      .from("ask_history")
      .select("id, question, answer, confidence, sources, grounded, source, created_at")
      .eq("location_id", locationId)
      .eq("source", "standing")
      .order("created_at", { ascending: false })
      .limit(1)
    return data?.[0] ? toRecord(data[0]) : null
  } catch {
    return null
  }
}

/** The location's pinned standing question (null = none / pre-migration). */
export async function getStandingQuestion(locationId: string): Promise<string | null> {
  try {
    const { data } = await admin()
      .from("locations")
      .select("standing_question")
      .eq("id", locationId)
      .maybeSingle()
    const q = data?.standing_question
    return typeof q === "string" && q.trim() ? q : null
  } catch {
    return null
  }
}

/** Morning re-run: answer the pinned question from today's (just-precomputed) signals
 *  and persist it as the standing answer. Called by the build-brief cron per location. */
export async function runStandingQuestion(locationId: string): Promise<boolean> {
  const question = await getStandingQuestion(locationId)
  if (!question) return false
  try {
    const ctx = await gatherAskContext(locationId)
    const answer = await answerQuestion(ctx, question)
    return await saveAsk(locationId, question, answer, "standing")
  } catch (err) {
    console.warn(`[ask] standing question failed for ${locationId}:`, err instanceof Error ? err.message : err)
    return false
  }
}
