import { connection } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { WaitlistStatsCards } from "./components/stats-cards"
import { WaitlistTable } from "./components/waitlist-table"

export default async function AdminWaitlistPage() {
  await connection()
  const supabase = createAdminSupabaseClient()

  const { data: signups } = await supabase
    .from("waitlist_signups")
    .select("*")
    .order("created_at", { ascending: false })

  const allSignups = signups ?? []

  const stats = {
    total: allSignups.length,
    pending: allSignups.filter((s) => s.status === "pending").length,
    approved: allSignups.filter((s) => s.status === "approved").length,
    declined: allSignups.filter((s) => s.status === "declined").length,
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Waitlist Management
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review, approve, or decline waitlist signups.
        </p>
      </div>

      <WaitlistStatsCards stats={stats} />
      <WaitlistTable signups={allSignups} />
    </div>
  )
}
