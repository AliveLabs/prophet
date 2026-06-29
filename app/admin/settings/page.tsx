// TICKET ADMIN — Settings, rebuilt to "The Pass".
//
// STRUCTURE rebuild: a kicker + display H1 page head, then kit TkCard sections
// for the admin roster (kit-styled table) and the invite form. Auth gate
// (requirePlatformAdminContext), the super_admin canManage capability check, and
// the data fetch are all preserved untouched — only presentation moved to the kit.

import { connection } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { requirePlatformAdminContext } from "@/lib/auth/platform-admin"
import { RevealOnView, TkCard, TkSectionHead } from "@/components/ticket"
import { AdminList } from "./components/admin-list"
import { InviteAdmin } from "./components/invite-admin"

export default async function AdminSettingsPage() {
  await connection()
  const { role } = await requirePlatformAdminContext()
  // Managing admins (invite / change role / remove) is a super_admin capability; lower
  // roles see the roster read-only. The server actions enforce this independently — this
  // just keeps the UI honest rather than offering controls that would be refused.
  const canManage = role === "super_admin"
  const supabase = createAdminSupabaseClient()

  const { data: admins } = await supabase
    .from("platform_admins")
    .select("*")
    .order("created_at", { ascending: true })

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* ── PAGE HEADER ── */}
      <RevealOnView as="header" className="adm-pagehead">
        <div className="adm-pagehead__kicker">Platform</div>
        <h1>Admin settings</h1>
        <p>
          {canManage
            ? "Manage the platform administrators who can access this dashboard."
            : "Platform administrators who can access this dashboard."}
        </p>
      </RevealOnView>

      {/* ── ROSTER ── */}
      <TkSectionHead
        title="Current admins"
        sub={`${(admins ?? []).length} ${(admins ?? []).length === 1 ? "person" : "people"}`}
      />
      <RevealOnView>
        <AdminList admins={admins ?? []} canManage={canManage} />
      </RevealOnView>

      {/* ── INVITE (super_admin only) ── */}
      {canManage && (
        <>
          <TkSectionHead title="Invite an admin" sub="Grants dashboard access" />
          <RevealOnView>
            <TkCard>
              <InviteAdmin />
            </TkCard>
          </RevealOnView>
        </>
      )}
    </div>
  )
}
