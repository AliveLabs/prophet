import { connection } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { UsersTable } from "./components/users-table"

interface UserRow {
  id: string
  email: string
  fullName: string | null
  createdAt: string
  lastSignInAt: string | null
  isBanned: boolean
  orgCount: number
  hasOnboarded: boolean
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Users
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage all platform users, invite new users, and export data.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total Users" value={stats.total} />
        <StatCard
          label="Active (7d)"
          value={stats.active7d}
          color="text-precision-teal"
        />
        <StatCard
          label="Deactivated"
          value={stats.deactivated}
          color="text-destructive"
        />
        <StatCard
          label="Never Onboarded"
          value={stats.neverOnboarded}
          color="text-signal-gold"
        />
      </div>

      <UsersTable users={users} />
    </div>
  )
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`mt-2 text-3xl font-bold ${color ?? "text-foreground"}`}>
        {value}
      </p>
    </div>
  )
}
