"use server"

// Settings persistence (Stage A): voice tone — used by the engine's dual-voice pass
// when drafting customer-facing copy in the restaurant's name. RLS via the user-scoped
// client enforces org membership on the update.

import { revalidatePath } from "next/cache"
import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { isSocialPlatform } from "@/lib/billing/tiers"
import { enqueueAdhocPlatform } from "@/lib/jobs/queue"

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

// Communications prefs (complete-picture · Batch 4) — persisted under
// locations.settings.communications; the weekly-digest cron and the new-brief
// notice respect them. Defaults: digest + notifications on, product news on.
const VALID_COMMS = new Set(["weekly_digest", "browser_notifications", "product_updates"])

export type CommsSettings = Record<string, boolean>

// Tier-1 own-network-of-choice (trial-tier v2 · Batch 4): which ONE network we
// collect for the customer's own account on paid Tier 1. Persisted under
// locations.settings.ownSocialNetwork; the social pipeline and dossier build
// resolve it via resolveOwnSocialNetworks. Changing it enqueues an ad-hoc pull
// for the new network — history there starts fresh, which the UI says honestly.
export async function setOwnSocialNetwork(
  locationId: string,
  network: string
): Promise<{ ok: boolean; error?: string }> {
  await requireUser()
  if (!isSocialPlatform(network)) return { ok: false, error: "Unknown network" }
  const supabase = await createServerSupabaseClient()
  // RLS-guarded read = membership check; also gives us org id for the enqueue.
  const { data: loc, error: readErr } = await supabase
    .from("locations")
    .select("settings, organization_id")
    .eq("id", locationId)
    .maybeSingle()
  if (readErr || !loc) return { ok: false, error: readErr?.message ?? "Location not found" }
  const settings = (loc.settings as Record<string, unknown> | null) ?? {}
  if (settings.ownSocialNetwork === network) return { ok: true }
  const { error } = await supabase
    .from("locations")
    .update({ settings: { ...settings, ownSocialNetwork: network } })
    .eq("id", locationId)
  if (error) return { ok: false, error: error.message }

  // Kick a pull for the newly chosen network so the next brief isn't empty there.
  try {
    const admin = createAdminSupabaseClient()
    await enqueueAdhocPlatform(admin, {
      organizationId: loc.organization_id,
      locationId,
      platforms: [network],
    })
  } catch (err) {
    console.warn("setOwnSocialNetwork: adhoc enqueue failed", err)
  }

  revalidatePath("/settings")
  return { ok: true }
}

export async function setCommsPref(
  locationId: string,
  key: string,
  on: boolean
): Promise<{ ok: boolean; error?: string }> {
  await requireUser()
  if (!VALID_COMMS.has(key)) return { ok: false, error: "Unknown preference" }
  const supabase = await createServerSupabaseClient()
  const { data: loc, error: readErr } = await supabase
    .from("locations")
    .select("settings")
    .eq("id", locationId)
    .maybeSingle()
  if (readErr || !loc) return { ok: false, error: readErr?.message ?? "Location not found" }
  const settings = (loc.settings as Record<string, unknown> | null) ?? {}
  const communications = { ...((settings.communications as CommsSettings | undefined) ?? {}), [key]: on }
  const { error } = await supabase
    .from("locations")
    .update({ settings: { ...settings, communications } })
    .eq("id", locationId)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/settings")
  return { ok: true }
}
