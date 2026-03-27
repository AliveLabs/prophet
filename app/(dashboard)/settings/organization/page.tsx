import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import { OrgSettingsForm } from "./org-settings-form"

export default async function OrganizationSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>
}) {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()
  const params = await searchParams

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  if (!profile?.current_organization_id) {
    redirect("/onboarding")
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug, billing_email, subscription_tier, created_at")
    .eq("id", profile.current_organization_id)
    .maybeSingle()

  if (!org) {
    redirect("/settings")
  }

  const { count: locationCount } = await supabase
    .from("locations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org.id)

  const { count: memberCount } = await supabase
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org.id)

  return (
    <section className="space-y-5">
      {params.error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {params.error}
        </div>
      )}
      {params.success && (
        <div className="rounded-lg border border-precision-teal/30 bg-precision-teal/10 px-4 py-3 text-sm text-precision-teal">
          {params.success}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-3">
          <span className="text-[12.5px] font-semibold text-foreground">Organization</span>
        </div>
        <div className="p-5">
          <OrgSettingsForm
            orgId={org.id}
            name={org.name}
            billingEmail={org.billing_email}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-3">
          <span className="text-[12.5px] font-semibold text-foreground">Details</span>
        </div>
        <div className="space-y-3 p-5 text-sm text-muted-foreground">
          <div className="flex justify-between">
            <span>Slug</span>
            <span className="font-mono text-foreground">{org.slug}</span>
          </div>
          <div className="flex justify-between">
            <span>Tier</span>
            <span className="font-medium capitalize text-foreground">{org.subscription_tier}</span>
          </div>
          <div className="flex justify-between">
            <span>Locations</span>
            <span className="text-foreground">{locationCount ?? 0}</span>
          </div>
          <div className="flex justify-between">
            <span>Team members</span>
            <span className="text-foreground">{memberCount ?? 0}</span>
          </div>
          <div className="flex justify-between">
            <span>Created</span>
            <span className="text-foreground">
              {new Date(org.created_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}
