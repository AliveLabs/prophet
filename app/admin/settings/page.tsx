import { connection } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { requirePlatformAdminContext } from "@/lib/auth/platform-admin"
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
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Admin Settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {canManage
            ? "Manage platform administrators who can access the admin dashboard."
            : "Platform administrators who can access the admin dashboard."}
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-4 text-base font-semibold text-foreground">
            Current Admins
          </h2>
          <AdminList admins={admins ?? []} canManage={canManage} />
        </section>

        {canManage && (
          <section>
            <h2 className="mb-4 text-base font-semibold text-foreground">
              Invite Admin
            </h2>
            <InviteAdmin />
          </section>
        )}
      </div>
    </div>
  )
}
