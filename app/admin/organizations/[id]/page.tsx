import { connection } from "next/server"
import { notFound } from "next/navigation"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { OrgDetailClient } from "./org-detail-client"

interface Props {
  params: Promise<{ id: string }>
}

async function fetchOrgDetail(orgId: string) {
  await connection()
  const supabase = createAdminSupabaseClient()

  const { data: org } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", orgId)
    .single()

  if (!org) return null

  const { data: members } = await supabase
    .from("organization_members")
    .select("id, user_id, role, created_at")
    .eq("organization_id", orgId)

  const userIds = (members ?? []).map((m) => m.user_id)
  const userEmails: Map<string, string> = new Map()
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email, full_name")
      .in("id", userIds)
    for (const p of profiles ?? []) {
      userEmails.set(p.id, p.email ?? p.full_name ?? p.id)
    }
  }

  const { data: locations } = await supabase
    .from("locations")
    .select("id, name, city, created_at")
    .eq("organization_id", orgId)

  const locationIds = (locations ?? []).map((l) => l.id)
  const competitorCounts = new Map<string, number>()
  if (locationIds.length > 0) {
    const { data: competitors } = await supabase
      .from("competitors")
      .select("location_id")
      .in("location_id", locationIds)
      .eq("is_active", true)
    for (const c of competitors ?? []) {
      competitorCounts.set(
        c.location_id,
        (competitorCounts.get(c.location_id) ?? 0) + 1
      )
    }
  }

  const { data: activityLogs } = await supabase
    .from("admin_activity_log")
    .select("*")
    .eq("target_id", orgId)
    .eq("target_type", "org")
    .order("created_at", { ascending: false })
    .limit(20)

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    billingEmail: org.billing_email,
    tier: org.subscription_tier,
    trialStartedAt: org.trial_started_at,
    trialEndsAt: org.trial_ends_at,
    stripeCustomerId: org.stripe_customer_id,
    stripeSubscriptionId: org.stripe_subscription_id,
    createdAt: org.created_at,
    members: (members ?? []).map((m) => ({
      id: m.id,
      userId: m.user_id,
      email: userEmails.get(m.user_id) ?? m.user_id,
      role: m.role,
      joinedAt: m.created_at,
    })),
    locations: (locations ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      city: l.city,
      competitorCount: competitorCounts.get(l.id) ?? 0,
      createdAt: l.created_at,
    })),
    activityLog: (activityLogs ?? []).map((log) => ({
      id: log.id,
      action: log.action,
      adminEmail: log.admin_email ?? "",
      details: log.details as Record<string, unknown> | null,
      createdAt: log.created_at ?? "",
    })),
  }
}

export default async function OrgDetailPage({ params }: Props) {
  const { id } = await params
  const org = await fetchOrgDetail(id)

  if (!org) notFound()

  return <OrgDetailClient org={org} />
}
