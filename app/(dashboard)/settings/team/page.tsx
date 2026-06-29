// Team — REBUILT to The Pass. This page has no team-management backend yet, so it stays
// HONEST: it shows the real signed-in operator as the owner (from auth context — same
// requireUser pattern the rest of settings uses) and a clear "still wiring invites" seam
// rather than faking a roster. Presentation is re-authored to the kit (roster rows,
// section head, empty-state note). The invite affordance is disabled until invites land.

import { requireUser } from "@/lib/auth/server"
import {
  RevealOnView,
  TkSectionHead,
  TkSoftPanel,
  TkButton,
  TkEmptyState,
} from "@/components/ticket"
import { ICON_TEAM } from "../settings-icons"
import "../settings-pass.css"

export default async function TeamPage() {
  const user = await requireUser()
  const email = user.email ?? "you"
  const name =
    (user.user_metadata?.full_name as string | undefined) ?? user.email?.split("@")[0] ?? "You"
  const initial = (name.trim()[0] ?? "Y").toUpperCase()

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

        {/* ── INVITES (not yet wired — honest empty state) ── */}
        <RevealOnView className="tk-set-block">
          <TkSectionHead title="Invites" sub="Bring your team in" />
          <TkEmptyState
            icon={ICON_TEAM}
            title="Team invites are on the way"
            description="Right now you're the only one on this workspace. Inviting teammates and managing their access lands in an upcoming release."
            action={
              <TkButton variant="add" disabled aria-label="Invite member — coming soon">
                Invite member
              </TkButton>
            }
          />
        </RevealOnView>
      </div>
    </div>
  )
}
