import { connection } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { RevealOnView } from "@/components/ticket"
import { WaitlistStatsCards } from "./components/stats-cards"
import { WaitlistTable } from "./components/waitlist-table"
import "./admin-pass.css"

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
    <div className="ticket-chrome tk-kit ap-page">
      <RevealOnView as="header" className="ap-head">
        <div className="ap-head-text">
          <span className="tk-eyebrow">Platform · Pipeline</span>
          <h1 className="ap-title">Waitlist</h1>
          <p className="ap-sub">
            Review, approve, or decline signups. Approving provisions a trial org and sends the invite.
          </p>
        </div>
      </RevealOnView>

      <RevealOnView>
        <WaitlistStatsCards stats={stats} />
      </RevealOnView>

      <RevealOnView>
        <WaitlistTable signups={allSignups} />
      </RevealOnView>
    </div>
  )
}
