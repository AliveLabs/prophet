"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"

export async function signOutAction() {
  const supabase = await createServerSupabaseClient()
  await supabase.auth.signOut()
  redirect("/login")
}

/**
 * Point the user's profile at a different organization. Every caller is a CLIENT component
 * that awaits this directly (not a `<form action>`), so it deliberately does NOT redirect.
 *
 * WHY THAT MATTERS — the bug this shape fixes: `redirect()` in a server action works by
 * THROWING a NEXT_REDIRECT signal. When a client component does
 * `startTransition(async () => { await switchOrganizationAction(id); ... })`, that throw
 * rejects the awaited promise, so
 *   1. every line after the await never runs (the router.push/refresh was dead code), and
 *   2. the rejection escapes an async transition callback nobody catches, so `isPending`
 *      never clears — the spinner spins forever and the buttons stay disabled.
 * `revalidatePath` had already run server-side, which is exactly why a hard refresh showed
 * the new location "already there".
 *
 * So: this returns normally, and each caller owns its own navigation. Keep it that way. If
 * you ever need a redirecting variant, add a separate action for `<form action>` use rather
 * than reintroducing a throw into this one's callers.
 */
export async function switchOrganizationAction(orgId: string) {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const { data: membership } = await supabase
    .from("organization_members")
    .select("id")
    .eq("organization_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!membership) {
    throw new Error("You are not a member of this organization.")
  }

  const { error } = await supabase
    .from("profiles")
    .update({ current_organization_id: orgId })
    .eq("id", user.id)

  if (error) {
    throw new Error("Failed to switch organization.")
  }

  // The whole shell is org-scoped (nav, brief, competitors), so the layout cache goes too.
  revalidatePath("/", "layout")
}
