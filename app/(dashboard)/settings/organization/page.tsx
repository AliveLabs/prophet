// Organization settings — REBUILT to The Pass. All data fetching (profile → org →
// location/member counts), the redirect guards, and the org-update server action are
// UNCHANGED. The body is re-authored to the kit: a page header on-system, error/success
// status seams, an editable org soft panel (page-local form island), and a details panel.

import { redirect } from "next/navigation"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import {
  RevealOnView,
  TkSectionHead,
  TkSoftPanel,
} from "@/components/ticket"
import { OrgFormPass } from "./org-form-pass"
import "../settings-pass.css"

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
    .select("id, name, display_name, slug, billing_email, subscription_tier, created_at")
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
    <div className="pv-page">
      <div className="pv-page-head">
        <span className="pv-kicker">Account</span>
        <h1 className="pv-h1">Organization</h1>
        <p className="pv-sub">Your workspace name, billing email, and the shape of your account.</p>
      </div>

      <div className="tk-kit tk-set">
        {params.error && (
          <div className="tk-set-block" style={{ marginTop: 22 }}>
            <span className="tk-set-status tk-set-status-err">{params.error}</span>
          </div>
        )}
        {params.success && (
          <div className="tk-set-block" style={{ marginTop: 22 }}>
            <span className="tk-set-status">{params.success}</span>
          </div>
        )}

        {/* ── ORGANIZATION (editable) ── */}
        <RevealOnView className="tk-set-block">
          <TkSectionHead title="Organization" sub="Name & billing contact" />
          <TkSoftPanel>
            <OrgFormPass
              orgId={org.id}
              name={org.name}
              displayName={org.display_name}
              billingEmail={org.billing_email}
            />
          </TkSoftPanel>
        </RevealOnView>

        {/* ── DETAILS (read-only) ── */}
        <RevealOnView className="tk-set-block">
          <TkSectionHead title="Details" sub="At a glance" />
          <TkSoftPanel>
            <div className="tk-set-fields">
              <div className="tk-set-field">
                <div className="tk-set-flbl">Slug</div>
                <div className="tk-set-fval"><span className="tk-mono">{org.slug}</span></div>
              </div>
              <div className="tk-set-field">
                <div className="tk-set-flbl">Tier</div>
                <div className="tk-set-fval">
                  <span className="tk-set-fval-strong" style={{ textTransform: "capitalize" }}>
                    {org.subscription_tier}
                  </span>
                </div>
              </div>
              <div className="tk-set-field">
                <div className="tk-set-flbl">Locations</div>
                <div className="tk-set-fval"><span className="tk-mono">{locationCount ?? 0}</span></div>
              </div>
              <div className="tk-set-field">
                <div className="tk-set-flbl">Team members</div>
                <div className="tk-set-fval"><span className="tk-mono">{memberCount ?? 0}</span></div>
              </div>
              <div className="tk-set-field">
                <div className="tk-set-flbl">Created</div>
                <div className="tk-set-fval">
                  <span className="tk-mono">
                    {new Date(org.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
              </div>
            </div>
          </TkSoftPanel>
        </RevealOnView>
      </div>
    </div>
  )
}
