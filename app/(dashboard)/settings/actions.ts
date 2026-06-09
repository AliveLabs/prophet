"use server"

// Settings persistence (Stage A): voice tone — used by the engine's dual-voice pass
// when drafting customer-facing copy in the restaurant's name. RLS via the user-scoped
// client enforces org membership on the update.

import { revalidatePath } from "next/cache"
import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"

const VALID_TONES = new Set(["warm_personal", "professional", "casual", "playful", "upscale"])

export async function setVoiceTone(
  locationId: string,
  tone: string
): Promise<{ ok: boolean; error?: string }> {
  await requireUser()
  if (!VALID_TONES.has(tone)) return { ok: false, error: "Invalid voice" }
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from("locations")
    .update({ voice_tone: tone })
    .eq("id", locationId)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/settings")
  return { ok: true }
}
