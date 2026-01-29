"use server"

import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"

export async function markInsightReadAction(formData: FormData) {
  await requireUser()
  const insightId = String(formData.get("insight_id") ?? "")
  if (!insightId) {
    redirect("/insights?error=Missing%20insight")
  }

  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from("insights")
    .update({ status: "read" })
    .eq("id", insightId)

  if (error) {
    redirect(`/insights?error=${encodeURIComponent(error.message)}`)
  }

  redirect("/insights")
}

export async function dismissInsightAction(formData: FormData) {
  await requireUser()
  const insightId = String(formData.get("insight_id") ?? "")
  if (!insightId) {
    redirect("/insights?error=Missing%20insight")
  }

  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from("insights")
    .update({ status: "dismissed" })
    .eq("id", insightId)

  if (error) {
    redirect(`/insights?error=${encodeURIComponent(error.message)}`)
  }

  redirect("/insights")
}
