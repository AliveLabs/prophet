import { connection } from "next/server"
import { notFound } from "next/navigation"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { UserDetailClient } from "./user-detail-client"

interface Props {
  params: Promise<{ id: string }>
}

async function fetchUserDetail(userId: string) {
  await connection()
  const supabase = createAdminSupabaseClient()

  const { data: userData } = await supabase.auth.admin.getUserById(userId)
  if (!userData?.user) return null

  const user = userData.user

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, avatar_url, current_organization_id, created_at")
    .eq("id", userId)
    .maybeSingle()

  const { data: memberships } = await supabase
    .from("organization_members")
    .select("organization_id, role, created_at")
    .eq("user_id", userId)

  const orgIds = (memberships ?? []).map((m) => m.organization_id)
  let orgs: Array<{
    id: string
    name: string
    subscription_tier: string
    trial_ends_at: string | null
  }> = []

  if (orgIds.length > 0) {
    const { data } = await supabase
      .from("organizations")
      .select("id, name, subscription_tier, trial_ends_at")
      .in("id", orgIds)
    orgs = data ?? []
  }

  const { data: activityLogs } = await supabase
    .from("admin_activity_log")
    .select("*")
    .eq("target_id", userId)
    .eq("target_type", "user")
    .order("created_at", { ascending: false })
    .limit(20)

  return {
    id: user.id,
    email: user.email ?? "",
    fullName:
      profile?.full_name ??
      (user.user_metadata?.full_name as string | undefined) ??
      null,
    avatarUrl: profile?.avatar_url ?? null,
    createdAt: user.created_at,
    lastSignInAt: user.last_sign_in_at ?? null,
    isBanned: !!user.banned_until && new Date(user.banned_until) > new Date(),
    provider: user.app_metadata?.provider ?? "email",
    hasOnboarded: !!profile?.current_organization_id,
    organizations: (memberships ?? []).map((m) => {
      const org = orgs.find((o) => o.id === m.organization_id)
      return {
        id: m.organization_id,
        name: org?.name ?? "Unknown",
        role: m.role,
        tier: org?.subscription_tier ?? "free",
        trialEndsAt: org?.trial_ends_at ?? null,
        joinedAt: m.created_at,
      }
    }),
    activityLog: (activityLogs ?? []).map((log) => ({
      id: log.id,
      action: log.action,
      adminEmail: log.admin_email ?? "",
      details: log.details as Record<string, unknown> | null,
      createdAt: log.created_at ?? "",
    })),
  }
}

export default async function UserDetailPage({ params }: Props) {
  const { id } = await params
  const user = await fetchUserDetail(id)

  if (!user) notFound()

  return <UserDetailClient user={user} />
}
