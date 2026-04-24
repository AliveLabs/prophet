import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { upsertMarketingContact } from "@/lib/marketing/contacts"

// Client-side bridge: posthog's distinct_id only exists in the browser, so the
// browser POSTs it here after auth resolves and we mirror it into
// marketing.contacts. Gated internally by MARKETING_CONTACTS_ENABLED so this
// no-ops until Chris's schema is live.

export async function POST(request: Request) {
  let body: { distinct_id?: unknown } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 })
  }

  const distinctId = typeof body.distinct_id === "string" ? body.distinct_id : null
  if (!distinctId) {
    return NextResponse.json({ ok: false, error: "distinct_id_required" }, { status: 400 })
  }

  const supabase = await createServerSupabaseClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user?.email) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 })
  }

  // Always return 200 to the browser regardless of marketing-side success —
  // the helper already logs failures and the flag may intentionally be off.
  await upsertMarketingContact({
    email: userData.user.email,
    posthogDistinctId: distinctId,
  })

  return NextResponse.json({ ok: true })
}
