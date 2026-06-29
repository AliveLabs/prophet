import type { CSSProperties } from "react"
import { connection } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { RevealOnView } from "@/components/ticket"
import { UsersTable } from "./components/users-table"
import "./admin-pass.css"

interface UserRow {
  id: string
  email: string
  fullName: string | null
  createdAt: string
  lastSignInAt: string | null
  isBanned: boolean
  orgCount: number
  hasOnboarded: boolean
  isAdmin: boolean
}

async function fetchUsers(): Promise<{
  users: UserRow[]
  stats: { total: number; active7d: number; deactivated: number; neverOnboarded: number }
}> {
  await connection()
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

  const { data: admins } = await supabase.from("platform_admins").select("user_id")
  const adminIds = new Set((admins ?? []).map((a) => a.user_id))

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]))
  const orgCountMap = new Map<string, number>()
  for (const m of memberships ?? []) {
    orgCountMap.set(m.user_id, (orgCountMap.get(m.user_id) ?? 0) + 1)
  }

  const now = new Date()
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  const allUsers = authData?.users ?? []

  const users: UserRow[] = allUsers.map((u) => {
    const profile = profileMap.get(u.id)
    return {
      id: u.id,
      email: u.email ?? "",
      fullName:
        profile?.full_name ??
        (u.user_metadata?.full_name as string | undefined) ??
        null,
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at ?? null,
      isBanned: !!u.banned_until && new Date(u.banned_until) > now,
      orgCount: orgCountMap.get(u.id) ?? 0,
      hasOnboarded: !!profile?.current_organization_id,
      isAdmin: adminIds.has(u.id),
    }
  })

  const stats = {
    total: users.length,
    active7d: users.filter(
      (u) => u.lastSignInAt && new Date(u.lastSignInAt) > weekAgo
    ).length,
    deactivated: users.filter((u) => u.isBanned).length,
    neverOnboarded: users.filter((u) => !u.hasOnboarded).length,
  }

  return { users, stats }
}

export default async function AdminUsersPage() {
  const { users, stats } = await fetchUsers()

  return (
    <div className="ticket-chrome tk-kit ap-page">
      <RevealOnView as="header" className="ap-head">
        <div className="ap-head-text">
          <span className="tk-eyebrow">Platform · People</span>
          <h1 className="ap-title">Users</h1>
          <p className="ap-sub">
            Every account on the platform — invite, deactivate, impersonate, and export.
          </p>
        </div>
      </RevealOnView>

      <RevealOnView className="ap-stats" stagger>
        <StatTile i={0} lead label="Total users" value={stats.total} />
        <StatTile i={1} tone="teal" label="Active · 7d" value={stats.active7d} />
        <StatTile i={2} tone="alert" label="Deactivated" value={stats.deactivated} />
        <StatTile i={3} tone="gold" label="Never onboarded" value={stats.neverOnboarded} />
      </RevealOnView>

      <RevealOnView>
        <UsersTable users={users} />
      </RevealOnView>
    </div>
  )
}

function StatTile({
  label,
  value,
  tone,
  lead = false,
  i = 0,
}: {
  label: string
  value: number
  tone?: "teal" | "gold" | "alert"
  lead?: boolean
  i?: number
}) {
  const cls = lead ? "ap-stat ap-stat-lead" : `ap-stat ${tone ? `ap-stat-${tone}` : ""}`
  return (
    <div className={cls} style={{ "--tk-i": i } as CSSProperties}>
      {tone ? <span className="ap-stat-rail" aria-hidden="true" /> : null}
      <span className="ap-stat-lbl">{label}</span>
      <span className="ap-stat-val">{value}</span>
    </div>
  )
}
