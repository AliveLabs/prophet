import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"

export async function getUser() {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.auth.getUser()
  if (error) {
    return null
  }
  return data.user
}

export async function requireUser() {
  const user = await getUser()
  if (!user) {
    redirect("/login")
  }
  return user
}
