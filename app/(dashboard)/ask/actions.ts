"use server"

// Standing-question persistence (complete-picture · Batch 2). RLS via the
// user-scoped client enforces org membership on the update (voice-tone pattern).
// Loose-typed until locations.standing_question lands in the generated DB types.

import { revalidatePath } from "next/cache"
import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { MAX_QUESTION_LEN } from "@/lib/ask/answer"

type LooseUpdate = {
  from: (t: string) => {
    update: (v: Record<string, unknown>) => {
      eq: (c: string, v: string) => Promise<{ error: { message: string } | null }>
    }
  }
}

/** Pin (or clear, with an empty string) the question re-run each morning. */
export async function setStandingQuestion(
  locationId: string,
  question: string
): Promise<{ ok: boolean; error?: string }> {
  await requireUser()
  const q = question.trim().slice(0, MAX_QUESTION_LEN)
  const supabase = await createServerSupabaseClient()
  const { error } = await (supabase as unknown as LooseUpdate)
    .from("locations")
    .update({ standing_question: q || null })
    .eq("id", locationId)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/ask")
  revalidatePath("/home")
  return { ok: true }
}
