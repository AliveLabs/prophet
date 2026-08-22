// Team — the REAL roster plus invite/remove (ALT-457 phase 1). Was a placeholder that
// showed only the signed-in operator behind a "coming soon" seam; operators had to ask us
// to add their own staff.
//
// ALT-218: inviting is a Tier 2+ capability. Tier 1 (and any org without active access)
// sees an upgrade prompt instead of the form. The same rule guards the server action
// (ensureCanInviteTeamMember), so a hidden form can't be bypassed by calling it directly.
//
// Phase 1 grants ORG-WIDE access. Per-location scoping is the next phase.

import Link from "next/link"
import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { resolveOperator } from "../../operator-data"
import { canInviteTeamMembers } from "@/lib/billing/limits"
import { tierDisplayName } from "@/lib/billing/tiers"
import {
  RevealOnView,
  TkSectionHead,
  TkSoftPanel,
  TkEmptyState,
} from "@/components/ticket"
import { ICON_TEAM, ICON_ARROW } from "../settings-icons"
import TeamClient, { type TeamMemberRow } from "./team-client"
import "../settings-pass.css"

export default async function TeamPage() {
  const user = await requireUser()

  // Effective-tier check for the invite gate (ALT-218).
  const op = await resolveOperator()
  const sb = await createServerSupabaseClient()
  const { data: org } = await sb
    .from("organizations")
    .select("subscription_tier, trial_ends_at, payment_state")
    .eq("id", op.organizationId)
    .maybeSingle()
  const canInvite = canInviteTeamMembers({
    subscription_tier: org?.subscription_tier ?? "entry",
    trial_ends_at: org?.trial_ends_at ?? null,
    payment_state: org?.payment_state ?? null,
  })

  // The REAL roster (ALT-457). Read with the admin client: organization_members RLS lets a
  // member see their own org's rows, but profiles is self-only, so a member-scoped read
  // would show every teammate as "Unknown". Access is already established by resolveOperator.
  const admin = createAdminSupabaseClient()
  const { data: memberRows } = await admin
    .from("organization_members")
    .select("user_id, role, created_at")
    .eq("organization_id", op.organizationId)
    .order("created_at", { ascending: true })

  const memberIds = (memberRows ?? []).map((m) => m.user_id)
  const { data: profileRows } = memberIds.length
    ? await admin.from("profiles").select("id, full_name, email").in("id", memberIds)
    : { data: [] }

  // "Invited" vs "Active" comes from auth's last_sign_in_at — a membership row whose user has
  // never signed in IS the pending invite, which is why phase 1 needs no invites table.
  const { data: authList } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const authById = new Map((authList?.users ?? []).map((u) => [u.id, u]))

  const actorRole = (memberRows ?? []).find((m) => m.user_id === user.id)?.role ?? "member"

  const members: TeamMemberRow[] = (memberRows ?? []).map((m) => {
    const profile = (profileRows ?? []).find((p) => p.id === m.user_id)
    const authUser = authById.get(m.user_id)
    const emailAddr = profile?.email ?? authUser?.email ?? "n/a"
    return {
      userId: m.user_id,
      name: profile?.full_name?.trim() || emailAddr.split("@")[0] || "Teammate",
      email: emailAddr,
      role: m.role as string,
      hasSignedIn: !!authUser?.last_sign_in_at,
      isYou: m.user_id === user.id,
    }
  })

  return (
    <div className="pv-page">
      <div className="pv-page-head">
        <span className="pv-kicker">Account</span>
        <h1 className="pv-h1">Team</h1>
        <p className="pv-sub">Who has access to this workspace.</p>
      </div>

      <div className="tk-kit tk-set">
        {/* ── MEMBERS + INVITE ── the real roster and, for owners/admins on Tier 2+, the
              invite form. Every rule is enforced server-side in ./actions.ts. ── */}
        <RevealOnView className="tk-set-block">
          <TkSectionHead title="Members" sub="People on this account" />
          <TkSoftPanel>
            <TeamClient members={members} actorRole={actorRole} canInvite={canInvite} />
          </TkSoftPanel>
        </RevealOnView>

        {/* ── UPGRADE PROMPT ── only when the plan doesn't include team members; the
              invite form itself sits in the roster panel above (ALT-218 + ALT-457). ── */}
        {!canInvite ? (
          <RevealOnView className="tk-set-block">
            <TkSectionHead title="Invites" sub="Bring your team in" />
            <TkEmptyState
              icon={ICON_TEAM}
              title={`Add your team on ${tierDisplayName("mid")} and up`}
              description={`Your current plan is single-operator. Upgrade to ${tierDisplayName("mid")} or ${tierDisplayName("top")} to invite teammates and manage their access.`}
              action={
                <Link className="tk-set-linkbtn" href="/settings/billing">
                  View plans {ICON_ARROW}
                </Link>
              }
            />
          </RevealOnView>
        ) : null}
      </div>
    </div>
  )
}
