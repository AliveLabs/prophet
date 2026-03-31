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

  const { data: authData } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, current_organization_id")

  const { data: memberships } = await supabase
    .from("organization_members")
    .select("user_id")

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]))
  const orgCountMap = new Map<string, number>()
  for (const m of memberships ?? []) {
    orgCountMap.set(m.user_id, (orgCountMap.get(m.user_id) ?? 0) + 1)
  }

  const header = "Email,Name,Created,Last Sign In,Org Count,Status"
  const rows = (authData?.users ?? []).map((u) => {
    const profile = profileMap.get(u.id)
    const name = profile?.full_name ?? (u.user_metadata?.full_name as string) ?? ""
    const isBanned =
      !!u.banned_until && new Date(u.banned_until) > new Date()
    return [
      csvEscape(u.email ?? ""),
      csvEscape(name),
      u.created_at ?? "",
      u.last_sign_in_at ?? "",
      orgCountMap.get(u.id) ?? 0,
      isBanned ? "deactivated" : "active",
    ].join(",")
  })

  const csv = [header, ...rows].join("\n")

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="users-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
