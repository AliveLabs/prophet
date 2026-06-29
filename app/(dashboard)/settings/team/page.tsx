// Team — REBUILT to The Pass. This page has no team-management backend yet, so it stays
// HONEST: it shows the real signed-in operator as the owner (from auth context — same
// requireUser pattern the rest of settings uses) and a clear seam rather than faking a
// roster. Presentation is re-authored to the kit (roster rows, section head, empty-state).
//
// ALT-218: inviting additional users is a Tier 2+ capability. On Tier 1 (and any org
// without active access), the invite affordance is replaced by an upgrade prompt; on
// Tier 2/3 (incl. a live Tier-2 trial) the "coming soon" invite seam shows instead.
// The real tier check lives in lib/billing (canInviteTeamMembers) so the eventual invite
// server action can reuse the same rule (ensureCanInviteTeamMember) as a bypass-proof guard.

import Link from "next/link"
import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { resolveOperator } from "../../operator-data"
import { canInviteTeamMembers } from "@/lib/billing/limits"
import {
  RevealOnView,
  TkSectionHead,
  TkSoftPanel,
  TkButton,
  TkEmptyState,
} from "@/components/ticket"
import { ICON_TEAM, ICON_ARROW } from "../settings-icons"
import "../settings-pass.css"

export default async function TeamPage() {
  const user = await requireUser()
  const email = user.email ?? "you"
  const name =
    (user.user_metadata?.full_name as string | undefined) ?? user.email?.split("@")[0] ?? "You"
  const initial = (name.trim()[0] ?? "Y").toUpperCase()

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

  return (
    <div className="pv-page">
      <div className="pv-page-head">
        <span className="pv-kicker">Account</span>
        <h1 className="pv-h1">Team</h1>
        <p className="pv-sub">Who has access to this workspace.</p>
      </div>

      <div className="tk-kit tk-set">
        {/* ── MEMBERS ── */}
        <RevealOnView className="tk-set-block">
          <TkSectionHead title="Members" sub="People on this account" />
          <TkSoftPanel>
            <div className="tk-set-roster">
              <div className="tk-set-member">
                <span className="tk-set-avatar" aria-hidden="true">{initial}</span>
                <span className="tk-set-member-text">
                  <b>{name}</b>
                  <span>Owner · {email}</span>
                </span>
                <span className="tk-set-member-tag">Active</span>
              </div>
            </div>
          </TkSoftPanel>
        </RevealOnView>

        {/* ── INVITES ── tier-gated (ALT-218): Tier 2+ sees the "coming soon" invite seam;
              Tier 1 sees an upgrade prompt instead of a disabled control. ── */}
        <RevealOnView className="tk-set-block">
          <TkSectionHead title="Invites" sub="Bring your team in" />
          {canInvite ? (
            <TkEmptyState
              icon={ICON_TEAM}
              title="Team invites are on the way"
              description="Your plan includes multiple users. Right now you're the only one on this workspace — inviting teammates and managing their access lands in an upcoming release."
              action={
                <TkButton variant="add" disabled aria-label="Invite member — coming soon">
                  Invite member
                </TkButton>
              }
            />
          ) : (
            <TkEmptyState
              icon={ICON_TEAM}
              title="Add your team on Tier 2 and up"
              description="Your current plan is single-operator. Upgrade to Tier 2 or Tier 3 to invite teammates and manage their access."
              action={
                <Link className="tk-set-linkbtn" href="/settings/billing">
                  View plans {ICON_ARROW}
                </Link>
              }
            />
          )}
        </RevealOnView>
      </div>
    </div>
  )
}
