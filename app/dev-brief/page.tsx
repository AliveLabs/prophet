// DEV-ONLY viewing route — renders the persisted Wagyu House brief through BriefView
// without auth, so the real V5 home can be looked at locally without logging in.
// Guarded to non-production (notFound in prod) so it never exposes on the Vercel preview.

import { notFound } from "next/navigation"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { getBrief } from "@/lib/insights/daily-brief"
import BriefView from "../(dashboard)/home/brief-view"
import "../(dashboard)/home/brief.css"

const WAGYU = "d06eec94-baf7-4f80-920a-0886a35fad90"

export default async function DevBrief() {
  if (process.env.NODE_ENV === "production") notFound()
  const sb = createAdminSupabaseClient()
  const { data: loc } = await sb.from("locations").select("id, name").eq("id", WAGYU).maybeSingle()
  const brief = await getBrief(WAGYU)
  if (!brief) return <div style={{ padding: 40, fontFamily: "monospace" }}>No persisted brief for {WAGYU}</div>
  const { data: comps } = await sb.from("competitors").select("name, metadata").eq("location_id", WAGYU).eq("is_active", true)
  const competitors = (comps ?? [])
    .filter((c) => (c.metadata as Record<string, unknown> | null)?.status === "approved")
    .map((c) => (c.name as string) ?? "Competitor")
    .slice(0, 6)

  // Dark wrapper simulates the (current) dashboard shell so the editorial surface shows in context.
  return (
    <div style={{ background: "#1a1d21", minHeight: "100vh", padding: 24 }}>
      <BriefView
        brief={brief}
        locationId={WAGYU}
        locationName={loc?.name ?? "Wagyu House Atlanta"}
        competitors={competitors}
        readOnly
      />
    </div>
  )
}
