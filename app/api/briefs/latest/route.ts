// ---------------------------------------------------------------------------
// GET /api/briefs/latest?location_id=xxx
// Returns the latest brief's generated_at stamp for a location the caller can see.
// Powers the in-app "new brief ready" notice (ALT-229b): the client polls this so the
// popover fires when a brief lands WHILE the operator is sitting on a page — not only
// after a manual navigation/refresh (which is all the server-rendered stamp could catch).
// Auth: the user-scoped Supabase client + RLS enforce org membership; we also confirm the
// location belongs to the caller's current org so a foreign id 404s rather than leaking.
// ---------------------------------------------------------------------------

import { createServerSupabaseClient } from "@/lib/supabase/server"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const locationId = url.searchParams.get("location_id")
  if (!locationId) {
    return Response.json({ error: "Missing location_id" }, { status: 400 })
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  // RLS already scopes this to orgs the user belongs to; the explicit id match makes the
  // tenant boundary auditable (same defense-in-depth pattern as the ambient-feed route).
  const { data: loc } = await supabase
    .from("locations")
    .select("id")
    .eq("id", locationId)
    .maybeSingle()
  if (!loc) return Response.json({ error: "Not found" }, { status: 404 })

  const { data: latest } = await supabase
    .from("daily_briefs")
    .select("generated_at")
    .eq("location_id", locationId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  return Response.json(
    { generatedAt: latest?.generated_at ?? null },
    { headers: { "Cache-Control": "no-store" } }
  )
}
