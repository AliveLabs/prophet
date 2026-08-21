import type { CSSProperties } from "react"
import { connection } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import {
  classifyUserLifecycle,
  summarizeUserLifecycle,
  type UserLifecycleRow,
  type UserLifecycleStage,
} from "@/lib/ops/user-lifecycle"
import { RevealOnView } from "@/components/ticket"
import { UsersTable } from "./components/users-table"
import "./admin-pass.css"

interface UserRow {
  id: string
  email: string
  fullName: string | null
  createdAt: string
  /** Last time the user was actually IN the product (profiles.last_seen_at). */
  lastSeenAt: string | null
  /** Auth event. Kept because "has never signed in" is still a real state worth showing. */
  lastSignInAt: string | null
  isBanned: boolean
  orgCount: number
  /** Where they actually are in the lifecycle. Replaces a `hasOnboarded` boolean that was really
   *  just "has an org", which both missed invited-never-signed-in users and wrongly flagged users
   *  whose org had been deleted. See lib/ops/user-lifecycle.ts. */
  stage: UserLifecycleStage
  isAdmin: boolean
}

/** Build the classifier's input from an auth user plus their profile row. `lastSeenAtResolved`
 *  keeps the existing display fallback (auth timestamp until the touch path has seen them once);
 *  activation is decided from the RAW auth field, which is null only if they never signed in. */
function lifecycleRow(
  u: { last_sign_in_at?: string | null; banned_until?: string | null },
  profile: { current_organization_id?: string | null; last_seen_at?: string | null } | undefined,
): UserLifecycleRow {
  return {
    lastSignInAt: u.last_sign_in_at ?? null,
    lastSeenAtResolved: profile?.last_seen_at ?? u.last_sign_in_at ?? null,
    currentOrganizationId: profile?.current_organization_id ?? null,
    isBanned: !!u.banned_until && new Date(u.banned_until) > new Date(),
  }
}

async function fetchUsers(): Promise<{
  users: UserRow[]
  stats: {
    total: number
    active7d: number
    deactivated: number
    neverSignedIn: number
    signedInNoOrg: number
  }
}> {
  await connection()
  const supabase = createAdminSupabaseClient()

  const { data: authData } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, current_organization_id, last_seen_at")

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
      // Fall back to the auth timestamp only until the touch path has seen them once —
      // the migration seeds last_seen_at from it, so this is a belt-and-braces default.
      lastSeenAt: profile?.last_seen_at ?? u.last_sign_in_at ?? null,
      lastSignInAt: u.last_sign_in_at ?? null,
      isBanned: !!u.banned_until && new Date(u.banned_until) > now,
      orgCount: orgCountMap.get(u.id) ?? 0,
      stage: classifyUserLifecycle(lifecycleRow(u, profile)),
      isAdmin: adminIds.has(u.id),
    }
  })

  // One shared definition for both admin surfaces, so the dashboard tile and this page can never
  // drift apart or disagree about what "onboarded" means.
  const summary = summarizeUserLifecycle(
    allUsers.map((u) => lifecycleRow(u, profileMap.get(u.id))),
    { nowMs: now.getTime() },
  )
  const stats = {
    total: summary.total,
    active7d: summary.activeLast7d,
    deactivated: users.filter((u) => u.isBanned).length,
    neverSignedIn: summary.neverSignedIn,
    signedInNoOrg: summary.signedInNoOrg,
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
        <StatTile i={3} tone="gold" label="Never signed in" value={stats.neverSignedIn} />
        <StatTile i={4} tone="alert" label="Signed in, no org" value={stats.signedInNoOrg} />
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
