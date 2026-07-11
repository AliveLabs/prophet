import { getTierDisplayName } from "@/lib/billing/tiers"
import type { IndustryType } from "@/lib/verticals"
import { UpgradeButtons } from "@/app/(dashboard)/settings/billing/upgrade-buttons"
import { ManageBillingButton } from "@/app/(dashboard)/settings/billing/manage-billing-button"
import { TkRule } from "@/components/ticket"

interface AccountHeldPanelProps {
  orgName: string
  userEmail: string | null
  brandName: "Ticket" | "Neat"
  industry: IndustryType
  insightCount: number
  competitorCount: number
  /** Trial clock ended (formatted) — null when the org never started one. */
  trialEndedLabel: string | null
  /** Org never started a trial (no clock, never through checkout). */
  neverStarted: boolean
  /** Org has a Stripe customer → offer the portal (update card / history / cancel). */
  hasStripeCustomer: boolean
}

// The "access on hold" state, rendered INSIDE the operator shell (sidebar +
// account menu stay put, so sign-out and org-switching are always reachable —
// the 2026-06-16 Chris incident: the old full-page gate trapped expired users
// on a chromeless price list with no way out). Newsprint editorial styling to
// match the app; reuses the billing page's checkout tiles + portal button.
export function AccountHeldPanel({
  orgName,
  userEmail,
  brandName,
  industry,
  insightCount,
  competitorCount,
  trialEndedLabel,
  neverStarted,
  hasStripeCustomer,
}: AccountHeldPanelProps) {
  const midName = getTierDisplayName("mid", industry)

  return (
    <div className="pv-page">
      <div className="pv-page-head">
        <span className="pv-kicker">Account</span>
        <h1 className="pv-h1">
          {neverStarted ? `Pick a plan to start using ${brandName}` : "Your access is on hold"}
        </h1>
        <p className="pv-sub">
          {neverStarted ? (
            <>
              {orgName}&rsquo;s setup is saved and the first data pull is in. Start
              with 14 days free on the {midName} tier — card required, $0 today,
              cancel anytime.
            </>
          ) : (
            <>
              {orgName}&rsquo;s trial
              {trialEndedLabel ? ` ended ${trialEndedLabel}` : " has ended"}. Your
              data and insights are safe — pick a plan below to pick up right where
              you left off.
            </>
          )}
        </p>
        {userEmail && (
          <p className="pv-field__hint" style={{ marginTop: 10 }}>
            Signed in as {userEmail}. Not your account, or need a different one? Use
            the account menu to switch organizations or sign out.
          </p>
        )}
      </div>
      <TkRule />

      {(insightCount > 0 || competitorCount > 0) && (
        <div className="pv-section">
          <div className="pv-card">
            <p className="pv-sub" style={{ margin: 0 }}>
              So far {brandName} generated{" "}
              <strong>{insightCount.toLocaleString()} insight{insightCount === 1 ? "" : "s"}</strong>{" "}
              across{" "}
              <strong>{competitorCount} competitor{competitorCount === 1 ? "" : "s"}</strong>
              {" "}— all of it kept and waiting.
            </p>
          </div>
        </div>
      )}

      <div className="pv-section">
        <div className="pv-section-head">
          {neverStarted ? "Choose your plan" : "Reactivate your account"}
          <span className="pv-section-sub">
            Daily intelligence, competitor tracking, and more locations as you grow.
          </span>
        </div>
        <UpgradeButtons industry={industry} showFeatures />
      </div>

      {hasStripeCustomer && (
        <div className="pv-section">
          <div className="pv-section-head">Manage billing</div>
          <div className="pv-card">
            <div className="pv-field">
              <div className="pv-field__label">Stripe</div>
              <div className="pv-field__val">
                <ManageBillingButton />
                <div className="pv-field__hint">
                  Update your card, view invoices, or cancel in the Stripe portal.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="pv-section">
        <p className="pv-field__hint">
          Questions?{" "}
          <a className="pv-link" href="mailto:support@alivelabs.co">
            Contact us
          </a>
        </p>
      </div>
    </div>
  )
}
