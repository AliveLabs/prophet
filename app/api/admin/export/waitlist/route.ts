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

  const { data: signups } = await supabase
    .from("waitlist_signups")
    .select(
      "email, first_name, last_name, status, admin_notes, created_at, reviewed_at"
    )
    .order("created_at", { ascending: false })

  const header =
    "Email,First Name,Last Name,Status,Admin Notes,Signed Up,Reviewed At"
  const rows = (signups ?? []).map((s) =>
    [
      csvEscape(s.email),
      csvEscape(s.first_name ?? ""),
      csvEscape(s.last_name ?? ""),
      s.status,
      csvEscape(s.admin_notes ?? ""),
      s.created_at,
      s.reviewed_at ?? "",
    ].join(",")
  )

  const csv = [header, ...rows].join("\n")

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="waitlist-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
