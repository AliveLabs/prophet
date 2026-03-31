import { NextResponse } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { requirePlatformAdmin } from "@/lib/auth/platform-admin"

export async function GET() {
  try {
    await requirePlatformAdmin()
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  const supabase = createAdminSupabaseClient()

  const { data: orgs } = await supabase
    .from("organizations")
    .select(
      "id, name, slug, subscription_tier, trial_started_at, trial_ends_at, billing_email, created_at"
    )
    .order("created_at", { ascending: false })

  const { data: members } = await supabase
    .from("organization_members")
    .select("organization_id")

  const { data: locations } = await supabase
    .from("locations")
    .select("organization_id")

  const memberCounts = new Map<string, number>()
  for (const m of members ?? []) {
    memberCounts.set(
      m.organization_id,
      (memberCounts.get(m.organization_id) ?? 0) + 1
    )
  }

  const locationCounts = new Map<string, number>()
  for (const l of locations ?? []) {
    locationCounts.set(
      l.organization_id,
      (locationCounts.get(l.organization_id) ?? 0) + 1
    )
  }

  const header =
    "Name,Slug,Tier,Trial Start,Trial End,Billing Email,Members,Locations,Created"
  const rows = (orgs ?? []).map((o) =>
    [
      csvEscape(o.name),
      o.slug,
      o.subscription_tier,
      o.trial_started_at ?? "",
      o.trial_ends_at ?? "",
      csvEscape(o.billing_email ?? ""),
      memberCounts.get(o.id) ?? 0,
      locationCounts.get(o.id) ?? 0,
      o.created_at,
    ].join(",")
  )

  const csv = [header, ...rows].join("\n")

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="organizations-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
