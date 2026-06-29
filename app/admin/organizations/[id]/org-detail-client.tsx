"use client"

import { useState, useMemo, useTransition } from "react"
import Link from "next/link"
import {
  updateOrgTier,
  extendOrgTrial,
  resetOrgTrial,
  deactivateOrg,
  activateOrg,
  updateOrgInfo,
  setTrialEndsAt,
  convertOrgToPaid,
  setOrgKind,
  clearOrgData,
  transferOrgOwnership,
  deleteOrg,
  purgeOrg,
  restoreOrg,
} from "@/app/actions/org-management"
import { impersonateUser } from "@/app/actions/user-management"
import { switchOrganizationAction } from "@/app/(dashboard)/actions"
import { unstable_rethrow, useRouter } from "next/navigation"
import { RevealOnView, TkButton } from "@/components/ticket"

interface OrgDetail {
  id: string
  name: string
  slug: string
  billingEmail: string | null
  tier: string
  trialStartedAt: string | null
  trialEndsAt: string | null
  paymentState: string | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  createdAt: string
  industryType: string
  orgKind: string
  deletedAt: string | null
  members: Array<{
    id: string
    userId: string
    email: string
    role: string
    joinedAt: string
  }>
  locations: Array<{
    id: string
    name: string
    city: string | null
    competitorCount: number
    createdAt: string
  }>
  activityLog: Array<{
    id: string
    action: string
    adminEmail: string
    reason: string | null
    actorType: string
    details: Record<string, unknown> | null
    createdAt: string
  }>
}

export function OrgDetailClient({ org }: { org: OrgDetail }) {
  const [isPending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState("")
  const [showEdit, setShowEdit] = useState(false)
  const [showTierChange, setShowTierChange] = useState(false)
  const [showSetDate, setShowSetDate] = useState(false)
  const [showConvert, setShowConvert] = useState(false)
  const [showSetKind, setShowSetKind] = useState(false)
  const [showClearData, setShowClearData] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [showDeleteOrg, setShowDeleteOrg] = useState(false)
  const router = useRouter()

  const isSuspended = org.tier === "suspended"
  // Trial = card-backed Stripe trial OR legacy clock-only org (null payment_state).
  const isTrial =
    !isSuspended &&
    (org.paymentState === "trialing" || org.paymentState == null) &&
    Boolean(org.trialEndsAt)
  const now = useMemo(() => new Date(), [])
  const trialActive = isTrial && new Date(org.trialEndsAt!) > now
  const trialDaysLeft = org.trialEndsAt
    ? Math.max(
        0,
        Math.ceil(
          (new Date(org.trialEndsAt).getTime() - now.getTime()) /
            (1000 * 60 * 60 * 24)
        )
      )
    : 0

  const handleExtendTrial = (days: number) => {
    startTransition(async () => {
      const result = await extendOrgTrial(org.id, days)
      setFeedback(result.ok ? result.message : result.error)
    })
  }

  const handleResetTrial = () => {
    if (!confirm("Reset trial? This sets a fresh 14-day trial.")) return
    startTransition(async () => {
      const result = await resetOrgTrial(org.id)
      setFeedback(result.ok ? result.message : result.error)
    })
  }

  const handleToggleSuspend = () => {
    if (
      !confirm(
        isSuspended
          ? `Activate ${org.name}?`
          : `Suspend ${org.name}? All members will lose access.`
      )
    )
      return
    startTransition(async () => {
      const result = isSuspended
        ? await activateOrg(org.id)
        : await deactivateOrg(org.id)
      setFeedback(result.ok ? result.message : result.error)
    })
  }

  // "View as customer" — start a read-only impersonation session as this org's
  // owner (impersonation is user-scoped; the owner is the customer). Mirrors the
  // user-detail flow: required reason, 30-min time-box, banner, fully audited.
  // Only for REAL orgs — demo/test you own, so use "Open demo" instead, and the
  // action server-side refuses impersonating a fellow platform admin anyway.
  const handleImpersonate = () => {
    const target = org.members.find((m) => m.role === "owner") ?? org.members[0]
    if (!target) {
      setFeedback("This org has no members to view as.")
      return
    }
    const reason = window.prompt(
      `View as ${target.email} (owner of ${org.name})? You'll switch to their read-only session (30-min limit, banner, fully audited); "Exit" returns you to sign-in.\n\nReason (required):`
    )
    if (!reason || !reason.trim()) return
    startTransition(async () => {
      const result = await impersonateUser(target.userId, reason)
      if (result.ok) {
        window.location.href = "/home" // now the target's read-only session
      } else {
        setFeedback(result.error)
      }
    })
  }

  const initial = (org.name.trim()[0] ?? "?").toUpperCase()

  return (
    <div className="ticket-chrome tk-kit ao-page">
      <nav className="ao-crumbs" aria-label="Breadcrumb">
        <Link href="/admin/organizations">Organizations</Link>
        <span className="ao-sep" aria-hidden="true">/</span>
        <span className="ao-here">{org.name}</span>
      </nav>

      {feedback && (
        <div className="ao-feedback" role="status">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {feedback}
        </div>
      )}

      {org.deletedAt && (
        <DeletedBanner
          orgId={org.id}
          orgName={org.name}
          deletedAt={org.deletedAt}
          onFeedback={setFeedback}
          onRestored={() => router.refresh()}
          onPurged={() => router.push("/admin/organizations")}
        />
      )}

      <div className="ao-detail">
        <div className="ao-detail-main">
          <RevealOnView className="tk-card">
            <div className="ao-orghead">
              <div style={{ display: "flex", gap: 14, minWidth: 0 }}>
                <span className="ao-mark" aria-hidden="true">{initial}</span>
                <div style={{ minWidth: 0 }}>
                  <h2>{org.name}</h2>
                  <p className="ao-slug">/{org.slug}</p>
                </div>
              </div>
              <TierBadge tier={org.tier} />
            </div>

            <div className="ao-infogrid">
              <InfoItem label="Billing email" value={org.billingEmail ?? "—"} />
              <InfoItem
                label="Trial"
                value={
                  trialActive
                    ? `${trialDaysLeft}d left${org.paymentState === "trialing" ? "" : " · no card"}`
                    : isTrial
                      ? "Expired"
                      : org.paymentState === "active"
                        ? "Paid"
                        : org.paymentState ?? "No trial"
                }
              />
              <InfoItem label="Created" value={new Date(org.createdAt).toLocaleDateString()} />
              <InfoItem
                label="Stripe"
                value={org.stripeCustomerId ? "Connected" : "None"}
              />
            </div>
          </RevealOnView>

          <TrialBanner
            isSuspended={isSuspended}
            paymentState={org.paymentState}
            trialEndsAt={org.trialEndsAt}
            trialActive={trialActive}
            trialDaysLeft={trialDaysLeft}
            orgKind={org.orgKind}
          />

          {(org.orgKind === "demo" || org.orgKind === "test") && !org.deletedAt && (
            <DemoSetupBanner org={org} onFeedback={setFeedback} />
          )}

          <div className="ao-actions">
            {org.orgKind === "real" && !org.deletedAt && (
              <TkButton
                variant="keep"
                onClick={handleImpersonate}
                disabled={isPending}
              >
                View as customer
              </TkButton>
            )}
            <TkButton variant="keep" onClick={() => setShowTierChange(!showTierChange)}>
              Change tier
            </TkButton>
            <TkButton variant="keep" onClick={() => handleExtendTrial(7)} disabled={isPending}>
              +7 days
            </TkButton>
            <TkButton variant="keep" onClick={() => handleExtendTrial(14)} disabled={isPending}>
              +14 days
            </TkButton>
            <TkButton variant="keep" onClick={() => handleExtendTrial(30)} disabled={isPending}>
              +30 days
            </TkButton>
            <TkButton variant="keep" onClick={handleResetTrial} disabled={isPending}>
              Reset trial
            </TkButton>
            <TkButton variant="keep" onClick={() => setShowSetDate(!showSetDate)}>
              Set trial date
            </TkButton>
            {org.orgKind === "real" && (
              <TkButton variant="keep" onClick={() => setShowConvert(!showConvert)}>
                Convert to paid
              </TkButton>
            )}
            <TkButton variant="keep" onClick={() => setShowEdit(!showEdit)}>
              Edit info
            </TkButton>
            <TkButton
              variant={isSuspended ? "add" : "dismiss"}
              onClick={handleToggleSuspend}
              disabled={isPending}
              style={
                isSuspended
                  ? undefined
                  : { color: "var(--alert-deep)", border: "1.5px solid color-mix(in srgb, var(--alert) 36%, transparent)" }
              }
            >
              {isSuspended ? "Activate" : "Suspend"}
            </TkButton>
          </div>

          {showTierChange && (
            <TierChangePanel
              orgId={org.id}
              currentTier={org.tier}
              onClose={() => setShowTierChange(false)}
              onFeedback={setFeedback}
            />
          )}

          {showSetDate && (
            <SetTrialDatePanel
              orgId={org.id}
              currentTrialEndsAt={org.trialEndsAt}
              onClose={() => setShowSetDate(false)}
              onFeedback={setFeedback}
            />
          )}

          {showConvert && org.orgKind === "real" && (
            <ConvertToPaidPanel
              orgId={org.id}
              onClose={() => setShowConvert(false)}
              onFeedback={setFeedback}
            />
          )}

          {showEdit && (
            <EditOrgPanel
              orgId={org.id}
              currentName={org.name}
              currentBillingEmail={org.billingEmail ?? ""}
              currentSlug={org.slug}
              currentIndustry={org.industryType}
              onClose={() => setShowEdit(false)}
              onFeedback={setFeedback}
            />
          )}

          <div className="ao-danger">
            <h3>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M8 2L1.5 13.5h13L8 2Z" strokeLinejoin="round" />
                <path d="M8 6.5v3.5M8 11.8v.01" strokeLinecap="round" />
              </svg>
              Danger zone
            </h3>
            <div className="ao-actions">
              <TkButton variant="keep" onClick={() => setShowSetKind(!showSetKind)}>
                Set kind
              </TkButton>
              <TkButton variant="keep" onClick={() => setShowTransfer(!showTransfer)}>
                Transfer owner
              </TkButton>
              <TkButton
                variant="keep"
                onClick={() => setShowClearData(!showClearData)}
                style={{ color: "var(--gold-deep)", borderColor: "color-mix(in srgb, var(--gold) 40%, transparent)" }}
              >
                Clear data
              </TkButton>
              {!org.deletedAt && (
                <TkButton
                  variant="keep"
                  onClick={() => setShowDeleteOrg(!showDeleteOrg)}
                  style={{ color: "var(--alert-deep)", borderColor: "color-mix(in srgb, var(--alert) 40%, transparent)" }}
                >
                  Delete org
                </TkButton>
              )}
            </div>
            <div className="ao-danger-panels">
              {showSetKind && (
                <SetKindPanel
                  orgId={org.id}
                  currentKind={org.orgKind}
                  onClose={() => setShowSetKind(false)}
                  onFeedback={setFeedback}
                />
              )}
              {showTransfer && (
                <TransferOwnerPanel
                  orgId={org.id}
                  members={org.members}
                  onClose={() => setShowTransfer(false)}
                  onFeedback={setFeedback}
                />
              )}
              {showClearData && (
                <ClearDataPanel
                  orgId={org.id}
                  orgName={org.name}
                  onClose={() => setShowClearData(false)}
                  onFeedback={setFeedback}
                />
              )}
              {showDeleteOrg && (
                <DeleteOrgPanel
                  orgId={org.id}
                  orgName={org.name}
                  onClose={() => setShowDeleteOrg(false)}
                  onFeedback={setFeedback}
                  onDeleted={() => router.push("/admin/organizations")}
                />
              )}
            </div>
          </div>

          <RevealOnView className="tk-card">
            <div className="ao-cardlbl">
              Members <span className="ao-count">{org.members.length}</span>
            </div>
            {org.members.length === 0 ? (
              <p className="ao-hint">No members.</p>
            ) : (
              <div className="ao-tablescroll">
                <table className="ao-table" style={{ border: 0 }}>
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {org.members.map((m) => (
                      <tr key={m.id}>
                        <td>
                          <Link href={`/admin/users/${m.userId}`} className="ao-link">
                            {m.email}
                          </Link>
                        </td>
                        <td>
                          <span className="ao-badge ao-badge-ink" style={{ textTransform: "capitalize" }}>
                            {m.role}
                          </span>
                        </td>
                        <td className="ao-cell-num">
                          {new Date(m.joinedAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </RevealOnView>

          <RevealOnView className="tk-card">
            <div className="ao-cardlbl">
              Locations <span className="ao-count">{org.locations.length}</span>
            </div>
            {org.locations.length === 0 ? (
              <p className="ao-hint">No locations.</p>
            ) : (
              <div className="ao-tablescroll">
                <table className="ao-table" style={{ border: 0 }}>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>City</th>
                      <th>Competitors</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {org.locations.map((l) => (
                      <tr key={l.id}>
                        <td>
                          <span className="ao-nm">{l.name}</span>
                        </td>
                        <td>{l.city ?? "—"}</td>
                        <td className="ao-cell-num">{l.competitorCount}</td>
                        <td className="ao-cell-num">
                          {new Date(l.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </RevealOnView>
        </div>

        <div className="ao-detail-side">
          <RevealOnView className="tk-card">
            <div className="ao-cardlbl">Admin activity</div>
            {org.activityLog.length === 0 ? (
              <p className="ao-hint">No activity logged yet.</p>
            ) : (
              <div className="ao-feed">
                {org.activityLog.map((log) => (
                  <div
                    key={log.id}
                    className={`ao-feed-item ${log.actorType === "system" ? "ao-sys" : ""}`}
                  >
                    <span className="ao-dot" aria-hidden="true" />
                    <p className="ao-act">{log.action.replace(/\./g, " → ")}</p>
                    {log.reason && <p className="ao-reason">&ldquo;{log.reason}&rdquo;</p>}
                    <p className="ao-meta">
                      by {log.actorType === "system" ? "system" : log.adminEmail} ·{" "}
                      {new Date(log.createdAt).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </RevealOnView>
        </div>
      </div>
    </div>
  )
}

// A demo/test org is born as a bare placeholder (no location). This is the
// state-aware entry that lets the admin complete its setup through the real
// onboarding wizard (in setup mode), then open it to present. Three states:
// fresh (no location) → set up · partial (location, no competitors) → resume ·
// ready (location + competitors) → open the demo's dashboard.
function DemoSetupBanner({
  org,
  onFeedback,
}: {
  org: OrgDetail
  onFeedback: (msg: string) => void
}) {
  const [isPending, startTransition] = useTransition()

  const hasLocation = org.locations.length > 0
  const hasCompetitors = org.locations.some((l) => l.competitorCount > 0)
  const state = !hasLocation ? "fresh" : !hasCompetitors ? "partial" : "ready"
  const kindLabel = org.orgKind === "test" ? "Test" : "Demo"

  const handleOpen = () => {
    // Switches the admin's current org to this one + redirects to /home, where
    // social setup and the brief live. The admin is already an owner-member.
    startTransition(async () => {
      try {
        await switchOrganizationAction(org.id)
      } catch (err) {
        unstable_rethrow(err) // let Next's success redirect propagate
        onFeedback(err instanceof Error ? err.message : "Couldn't open the demo.")
      }
    })
  }

  const title =
    state === "fresh"
      ? `${kindLabel} not set up yet`
      : state === "partial"
        ? `${kindLabel} setup unfinished`
        : `${kindLabel} ready to show`
  const blurb =
    state === "fresh"
      ? "An empty placeholder — pick its restaurant, choose competitors, and pull live data so you can present it."
      : state === "partial"
        ? "It has a location but no tracked competitors yet. Finish setup to populate the dashboard."
        : "Open it to review the brief and set up social. Clear & re-run setup anytime from the Danger Zone."

  return (
    <div className="ao-banner ao-banner-rust">
      <div className="ao-bt">
        <strong>{title}</strong>
        <span>{blurb}</span>
      </div>
      {state === "ready" ? (
        <TkButton variant="act" onClick={handleOpen} disabled={isPending}>
          {isPending ? "Opening…" : "Open demo →"}
        </TkButton>
      ) : (
        <Link
          href={`/onboarding?org=${org.id}`}
          className="tk-btn tk-btn-act"
        >
          {state === "fresh" ? "Set up demo →" : "Resume setup →"}
        </Link>
      )}
    </div>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="ao-info">
      <p className="ao-il">{label}</p>
      <p className="ao-iv">{value}</p>
    </div>
  )
}

function TierBadge({ tier }: { tier: string }) {
  const tone: Record<string, string> = {
    free: "ao-badge-ink",
    entry: "ao-badge-slate",
    mid: "ao-badge-teal",
    top: "ao-badge-gold",
    suspended: "ao-badge-alert",
  }
  return (
    <span className={`ao-badge ${tone[tier] ?? "ao-badge-ink"}`}>
      <span className="ao-led" aria-hidden="true" />
      <span style={{ textTransform: "capitalize" }}>{tier}</span>
    </span>
  )
}

function PanelHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="ao-panel-head">
      <h3>{title}</h3>
      <TkButton variant="ghost" onClick={onClose} style={{ minHeight: 0, padding: "6px 10px", fontSize: 12 }}>
        Cancel
      </TkButton>
    </div>
  )
}

function TierChangePanel({
  orgId,
  currentTier,
  onClose,
  onFeedback,
}: {
  orgId: string
  currentTier: string
  onClose: () => void
  onFeedback: (msg: string) => void
}) {
  const [selectedTier, setSelectedTier] = useState(currentTier)
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (selectedTier === currentTier) {
      onFeedback("No change selected.")
      return
    }
    startTransition(async () => {
      const result = await updateOrgTier(orgId, selectedTier)
      onFeedback(result.ok ? result.message : result.error)
      if (result.ok) onClose()
    })
  }

  return (
    <div className="ao-panel">
      <PanelHead title="Change tier" onClose={onClose} />
      <form onSubmit={handleSubmit} className="ao-panel-row">
        <div className="ao-field">
          <label>New tier</label>
          <select
            value={selectedTier}
            onChange={(e) => setSelectedTier(e.target.value)}
            className="ao-select"
          >
            <option value="entry">Entry</option>
            <option value="mid">Mid</option>
            <option value="top">Top</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
        <TkButton type="submit" variant="act" disabled={isPending}>
          {isPending ? "Saving…" : "Update tier"}
        </TkButton>
      </form>
    </div>
  )
}

type Industry = "restaurant" | "liquor_store"

function EditOrgPanel({
  orgId,
  currentName,
  currentBillingEmail,
  currentSlug,
  currentIndustry,
  onClose,
  onFeedback,
}: {
  orgId: string
  currentName: string
  currentBillingEmail: string
  currentSlug: string
  currentIndustry: string
  onClose: () => void
  onFeedback: (msg: string) => void
}) {
  const [name, setName] = useState(currentName)
  const [billingEmail, setBillingEmail] = useState(currentBillingEmail)
  const [slug, setSlug] = useState(currentSlug)
  const [industry, setIndustry] = useState<Industry>(
    currentIndustry === "liquor_store" ? "liquor_store" : "restaurant"
  )
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const updates: {
      name?: string
      billingEmail?: string
      slug?: string
      industryType?: Industry
    } = {}
    if (name !== currentName) updates.name = name
    if (billingEmail !== currentBillingEmail) updates.billingEmail = billingEmail
    if (slug !== currentSlug) updates.slug = slug
    if (industry !== currentIndustry) updates.industryType = industry
    if (Object.keys(updates).length === 0) {
      onFeedback("No changes to save.")
      return
    }
    startTransition(async () => {
      const result = await updateOrgInfo(orgId, updates)
      onFeedback(result.ok ? result.message : result.error)
      if (result.ok) onClose()
    })
  }

  return (
    <div className="ao-panel">
      <PanelHead title="Edit organization" onClose={onClose} />
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="ao-panel-grid">
          <div className="ao-field">
            <label>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="ao-input"
            />
          </div>
          <div className="ao-field">
            <label>Billing email</label>
            <input
              type="email"
              value={billingEmail}
              onChange={(e) => setBillingEmail(e.target.value)}
              className="ao-input"
            />
          </div>
          <div className="ao-field">
            <label>Slug</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="ao-input"
            />
          </div>
          <div className="ao-field">
            <label>Industry</label>
            <select
              value={industry}
              onChange={(e) => setIndustry(e.target.value as Industry)}
              className="ao-select"
              style={{ width: "100%" }}
            >
              <option value="restaurant">Restaurant</option>
              <option value="liquor_store">Liquor store</option>
            </select>
          </div>
        </div>
        <div>
          <TkButton type="submit" variant="act" disabled={isPending}>
            {isPending ? "Saving…" : "Save changes"}
          </TkButton>
        </div>
      </form>
    </div>
  )
}

function TrialBanner({
  isSuspended,
  paymentState,
  trialEndsAt,
  trialActive,
  trialDaysLeft,
  orgKind,
}: {
  isSuspended: boolean
  paymentState: string | null
  trialEndsAt: string | null
  trialActive: boolean
  trialDaysLeft: number
  orgKind: string
}) {
  const endStr = trialEndsAt
    ? new Date(trialEndsAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null

  let tone = ""
  let text: string
  if (isSuspended) {
    tone = "ao-banner-alert"
    text = "Suspended — members have no access."
  } else if (paymentState === "active" || paymentState === "past_due") {
    tone = "ao-banner-teal"
    text = "Paid — subscription active."
  } else if (trialActive) {
    tone =
      trialDaysLeft <= 2 ? "ao-banner-alert" : trialDaysLeft <= 5 ? "ao-banner-gold" : ""
    text = `Trial — ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left${
      endStr ? `, expires ${endStr}` : ""
    }${paymentState === "trialing" ? "" : " (no card)"}`
  } else if (trialEndsAt) {
    tone = "ao-banner-alert"
    text = `Trial expired${endStr ? ` ${endStr}` : ""}.`
  } else {
    text = "No active trial or subscription."
  }

  const kindNote = orgKind !== "real" ? ` · ${orgKind.toUpperCase()} org (non-billable)` : ""

  return (
    <div className={`ao-banner ${tone}`}>
      <div className="ao-bt">
        <strong>
          {text}
          {kindNote}
        </strong>
      </div>
    </div>
  )
}

// datetime-local has no timezone — render the stored instant as LOCAL wall-clock so
// the prefill and `new Date(value)` on submit agree (avoids a UTC-offset shift).
function toLocalDatetimeInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function SetTrialDatePanel({
  orgId,
  currentTrialEndsAt,
  onClose,
  onFeedback,
}: {
  orgId: string
  currentTrialEndsAt: string | null
  onClose: () => void
  onFeedback: (msg: string) => void
}) {
  const [value, setValue] = useState(
    currentTrialEndsAt ? toLocalDatetimeInput(currentTrialEndsAt) : ""
  )
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!value) {
      onFeedback("Pick a date.")
      return
    }
    startTransition(async () => {
      const result = await setTrialEndsAt(orgId, new Date(value).toISOString())
      onFeedback(result.ok ? result.message : result.error)
      if (result.ok) onClose()
    })
  }

  return (
    <div className="ao-panel">
      <PanelHead title="Set trial end date" onClose={onClose} />
      <form onSubmit={handleSubmit} className="ao-panel-row">
        <div className="ao-field">
          <label>Trial ends</label>
          <input
            type="datetime-local"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="ao-input"
          />
        </div>
        <TkButton type="submit" variant="act" disabled={isPending}>
          {isPending ? "Saving…" : "Set date"}
        </TkButton>
      </form>
      <p className="ao-hint" style={{ marginTop: 10 }}>
        For a card-backed Stripe trial this updates Stripe; otherwise it sets the clock directly.
      </p>
    </div>
  )
}

function ConvertToPaidPanel({
  orgId,
  onClose,
  onFeedback,
}: {
  orgId: string
  onClose: () => void
  onFeedback: (msg: string) => void
}) {
  const [tier, setTier] = useState<"entry" | "mid" | "top">("mid")
  const [cadence, setCadence] = useState<"monthly" | "annual">("monthly")
  const [url, setUrl] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const result = await convertOrgToPaid(orgId, { tier, cadence })
      if (result.ok) {
        setUrl(result.url)
        onFeedback(result.message)
      } else {
        onFeedback(result.error)
      }
    })
  }

  return (
    <div className="ao-panel">
      <PanelHead title="Convert to paid" onClose={onClose} />
      <form onSubmit={handleSubmit} className="ao-panel-row">
        <div className="ao-field">
          <label>Tier</label>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as "entry" | "mid" | "top")}
            className="ao-select"
          >
            <option value="entry">Entry</option>
            <option value="mid">Mid</option>
            <option value="top">Top</option>
          </select>
        </div>
        <div className="ao-field">
          <label>Cadence</label>
          <select
            value={cadence}
            onChange={(e) => setCadence(e.target.value as "monthly" | "annual")}
            className="ao-select"
          >
            <option value="monthly">Monthly</option>
            <option value="annual">Annual</option>
          </select>
        </div>
        <TkButton type="submit" variant="add" disabled={isPending}>
          {isPending ? "Creating…" : "Generate checkout link"}
        </TkButton>
      </form>
      {url && (
        <div className="ao-field" style={{ marginTop: 14 }}>
          <label>Send this link to the customer</label>
          <input
            type="text"
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="ao-copyfield"
          />
        </div>
      )}
    </div>
  )
}

function SetKindPanel({
  orgId,
  currentKind,
  onClose,
  onFeedback,
}: {
  orgId: string
  currentKind: string
  onClose: () => void
  onFeedback: (msg: string) => void
}) {
  const [kind, setKind] = useState<"real" | "demo" | "test">(
    currentKind === "demo" ? "demo" : currentKind === "test" ? "test" : "real"
  )
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const result = await setOrgKind(orgId, kind)
      onFeedback(result.ok ? result.message : result.error)
      if (result.ok) onClose()
    })
  }

  return (
    <div className="ao-panel">
      <form onSubmit={handleSubmit} className="ao-panel-row">
        <div className="ao-field">
          <label>Classification</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as "real" | "demo" | "test")}
            className="ao-select"
          >
            <option value="real">Customer</option>
            <option value="demo">Demo</option>
            <option value="test">Test</option>
          </select>
        </div>
        <TkButton type="submit" variant="act" disabled={isPending}>
          {isPending ? "Saving…" : "Apply"}
        </TkButton>
        <TkButton variant="ghost" onClick={onClose} style={{ minHeight: 0, padding: "10px 12px", fontSize: 12 }}>
          Cancel
        </TkButton>
      </form>
      <p className="ao-hint" style={{ marginTop: 10 }}>
        Demo/Test are excluded from real metrics &amp; billing. Setting to Customer is restricted.
      </p>
    </div>
  )
}

function TransferOwnerPanel({
  orgId,
  members,
  onClose,
  onFeedback,
}: {
  orgId: string
  members: Array<{ userId: string; email: string; role: string }>
  onClose: () => void
  onFeedback: (msg: string) => void
}) {
  const currentOwner = members.find((m) => m.role === "owner")
  const candidates = members.filter((m) => m.userId !== currentOwner?.userId)
  const [toUserId, setToUserId] = useState(candidates[0]?.userId ?? "")
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!toUserId || !currentOwner) {
      onFeedback("Pick a member to transfer ownership to.")
      return
    }
    startTransition(async () => {
      const result = await transferOrgOwnership(orgId, currentOwner.userId, toUserId)
      onFeedback(result.ok ? result.message : result.error)
      if (result.ok) onClose()
    })
  }

  if (candidates.length === 0) {
    return (
      <div className="ao-panel">
        <p className="ao-hint">
          No other members to transfer ownership to. Add a member first.{" "}
          <button onClick={onClose} className="ao-link" style={{ background: "none" }}>
            Close
          </button>
        </p>
      </div>
    )
  }

  return (
    <div className="ao-panel">
      <form onSubmit={handleSubmit} className="ao-panel-row">
        <div className="ao-field">
          <label>New owner</label>
          <select
            value={toUserId}
            onChange={(e) => setToUserId(e.target.value)}
            className="ao-select"
          >
            {candidates.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.email}
              </option>
            ))}
          </select>
        </div>
        <TkButton type="submit" variant="act" disabled={isPending}>
          {isPending ? "Transferring…" : "Transfer"}
        </TkButton>
        <TkButton variant="ghost" onClick={onClose} style={{ minHeight: 0, padding: "10px 12px", fontSize: 12 }}>
          Cancel
        </TkButton>
      </form>
    </div>
  )
}

function ClearDataPanel({
  orgId,
  orgName,
  onClose,
  onFeedback,
}: {
  orgId: string
  orgName: string
  onClose: () => void
  onFeedback: (msg: string) => void
}) {
  const [mode, setMode] = useState<"all" | "refresh">("refresh")
  const [confirmText, setConfirmText] = useState("")
  const [reason, setReason] = useState("")
  const [isPending, startTransition] = useTransition()
  // 'all' is destructive and requires a logged reason; 'refresh' (regenerable) does not.
  const ready =
    confirmText === orgName && (mode === "refresh" || reason.trim().length > 0)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!ready) return
    startTransition(async () => {
      const result = await clearOrgData(orgId, mode, reason)
      onFeedback(result.ok ? result.message : result.error)
      if (result.ok) onClose()
    })
  }

  return (
    <div className="ao-panel">
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="ao-field">
          <label>Mode</label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "all" | "refresh")}
            className="ao-select"
            style={{ width: "100%" }}
          >
            <option value="refresh">Refresh — wipe intelligence, keep locations</option>
            <option value="all">Clear all — also drop locations (pre-onboarding)</option>
          </select>
        </div>
        {mode === "all" && (
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required, recorded in the audit log)"
            className="ao-input"
          />
        )}
        <p className="ao-hint">
          Keeps the org, members, and billing. Type <b>{orgName}</b> to confirm.
        </p>
        <div className="ao-panel-row">
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={orgName}
            className="ao-input"
            style={{ flex: 1 }}
          />
          <TkButton
            type="submit"
            variant="add"
            disabled={!ready || isPending}
            style={{ background: "var(--gold-2)" }}
          >
            {isPending ? "Clearing…" : "Clear data"}
          </TkButton>
          <TkButton variant="ghost" onClick={onClose} style={{ minHeight: 0, padding: "10px 12px", fontSize: 12 }}>
            Cancel
          </TkButton>
        </div>
      </form>
    </div>
  )
}

function DeleteOrgPanel({
  orgId,
  orgName,
  onClose,
  onFeedback,
  onDeleted,
}: {
  orgId: string
  orgName: string
  onClose: () => void
  onFeedback: (msg: string) => void
  onDeleted: () => void
}) {
  const [confirmText, setConfirmText] = useState("")
  const [reason, setReason] = useState("")
  const [isPending, startTransition] = useTransition()
  const ready = confirmText === orgName && reason.trim().length > 0

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!ready) return
    startTransition(async () => {
      const result = await deleteOrg(orgId, reason)
      if (result.ok) {
        onDeleted()
      } else {
        onFeedback(result.error)
        onClose()
      }
    })
  }

  return (
    <div className="ao-panel" style={{ borderColor: "color-mix(in srgb, var(--alert) 34%, transparent)" }}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="ao-hint" style={{ color: "var(--alert-deep)", fontWeight: 600 }}>
          Permanently deletes {orgName} and all its data (locations, competitors, insights,
          memberships). This cannot be undone.
        </p>
        <p className="ao-hint">
          Type <b>{orgName}</b> and give a reason to confirm.
        </p>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (required, recorded in the audit log)"
          className="ao-input"
        />
        <div className="ao-panel-row">
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={orgName}
            className="ao-input"
            style={{ flex: 1 }}
          />
          <TkButton
            type="submit"
            variant="add"
            disabled={!ready || isPending}
            style={{ background: "var(--alert-2)" }}
          >
            {isPending ? "Deleting…" : "Delete permanently"}
          </TkButton>
          <TkButton variant="ghost" onClick={onClose} style={{ minHeight: 0, padding: "10px 12px", fontSize: 12 }}>
            Cancel
          </TkButton>
        </div>
      </form>
    </div>
  )
}

// Shown when an org is soft-deleted (Phase 6c): a restore path + a super-admin permanent
// purge (typed-confirm + reason). Purge is server-gated to super_admin; a lower role gets a
// clean error rather than the control being hidden (we don't have the viewer role here).
function DeletedBanner({
  orgId,
  orgName,
  deletedAt,
  onFeedback,
  onRestored,
  onPurged,
}: {
  orgId: string
  orgName: string
  deletedAt: string
  onFeedback: (msg: string) => void
  onRestored: () => void
  onPurged: () => void
}) {
  const [showPurge, setShowPurge] = useState(false)
  const [confirmText, setConfirmText] = useState("")
  const [reason, setReason] = useState("")
  const [isPending, startTransition] = useTransition()
  const purgeReady = confirmText === orgName && reason.trim().length > 0

  const handleRestore = () => {
    startTransition(async () => {
      const result = await restoreOrg(orgId)
      onFeedback(result.ok ? result.message : result.error)
      if (result.ok) onRestored()
    })
  }

  const handlePurge = (e: React.FormEvent) => {
    e.preventDefault()
    if (!purgeReady) return
    startTransition(async () => {
      const result = await purgeOrg(orgId, reason)
      if (result.ok) {
        onPurged()
      } else {
        onFeedback(result.error)
      }
    })
  }

  return (
    <div className="ao-banner ao-banner-alert" style={{ flexDirection: "column", alignItems: "stretch" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div className="ao-bt">
          <strong>This organization is deleted</strong>
          <span>
            Deleted {new Date(deletedAt).toLocaleString()} · hidden from all admin lists, counts,
            and crons. Restore it, or permanently purge it (super admin).
          </span>
        </div>
        <div className="ao-actions">
          <TkButton variant="keep" onClick={handleRestore} disabled={isPending} kept>
            {isPending ? "…" : "Restore"}
          </TkButton>
          <TkButton
            variant="keep"
            onClick={() => setShowPurge((s) => !s)}
            style={{ color: "var(--alert-deep)", borderColor: "color-mix(in srgb, var(--alert) 40%, transparent)" }}
          >
            Purge permanently
          </TkButton>
        </div>
      </div>

      {showPurge && (
        <form
          onSubmit={handlePurge}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            marginTop: 14,
            paddingTop: 14,
            borderTop: "1px solid color-mix(in srgb, var(--alert) 24%, transparent)",
          }}
        >
          <p className="ao-hint" style={{ color: "var(--alert-deep)", fontWeight: 600 }}>
            Permanently deletes {orgName} and all its data — irreversible. Type{" "}
            <b>{orgName}</b> and give a reason.
          </p>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required, recorded in the audit log)"
            className="ao-input"
          />
          <div className="ao-panel-row">
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={orgName}
              className="ao-input"
              style={{ flex: 1 }}
            />
            <TkButton
              type="submit"
              variant="add"
              disabled={!purgeReady || isPending}
              style={{ background: "var(--alert-2)" }}
            >
              {isPending ? "Purging…" : "Purge"}
            </TkButton>
            <TkButton variant="ghost" onClick={() => setShowPurge(false)} style={{ minHeight: 0, padding: "10px 12px", fontSize: 12 }}>
              Cancel
            </TkButton>
          </div>
        </form>
      )}
    </div>
  )
}
