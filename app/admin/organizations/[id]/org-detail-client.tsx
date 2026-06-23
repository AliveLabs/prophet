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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/admin/organizations" className="hover:text-foreground">
          Organizations
        </Link>
        <span>/</span>
        <span className="text-foreground">{org.name}</span>
      </div>

      {feedback && (
        <div className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-foreground">
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

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  {org.name}
                </h2>
                <p className="text-sm text-muted-foreground">/{org.slug}</p>
              </div>
              <TierBadge tier={org.tier} />
            </div>

            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <InfoItem label="Billing Email" value={org.billingEmail ?? "—"} />
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
                label="Stripe Customer"
                value={org.stripeCustomerId ? "Connected" : "None"}
              />
            </div>
          </div>

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

          <div className="flex flex-wrap gap-2">
            {org.orgKind === "real" && !org.deletedAt && (
              <button
                onClick={handleImpersonate}
                disabled={isPending}
                className="h-9 rounded-lg border border-precision-teal/40 bg-precision-teal/5 px-4 text-sm font-medium text-precision-teal hover:bg-precision-teal/15 transition-colors disabled:opacity-50"
              >
                View as customer
              </button>
            )}
            <button
              onClick={() => setShowTierChange(!showTierChange)}
              className="h-9 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
            >
              Change Tier
            </button>
            <button
              onClick={() => handleExtendTrial(7)}
              disabled={isPending}
              className="h-9 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
            >
              +7 Days
            </button>
            <button
              onClick={() => handleExtendTrial(14)}
              disabled={isPending}
              className="h-9 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
            >
              +14 Days
            </button>
            <button
              onClick={() => handleExtendTrial(30)}
              disabled={isPending}
              className="h-9 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
            >
              +30 Days
            </button>
            <button
              onClick={handleResetTrial}
              disabled={isPending}
              className="h-9 rounded-lg border border-border bg-card px-4 text-sm font-medium text-signal-gold hover:bg-secondary transition-colors disabled:opacity-50"
            >
              Reset Trial
            </button>
            <button
              onClick={() => setShowSetDate(!showSetDate)}
              className="h-9 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
            >
              Set Trial Date
            </button>
            {org.orgKind === "real" && (
              <button
                onClick={() => setShowConvert(!showConvert)}
                className="h-9 rounded-lg border border-border bg-card px-4 text-sm font-medium text-precision-teal hover:bg-secondary transition-colors"
              >
                Convert to Paid
              </button>
            )}
            <button
              onClick={() => setShowEdit(!showEdit)}
              className="h-9 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
            >
              Edit Info
            </button>
            <button
              onClick={handleToggleSuspend}
              disabled={isPending}
              className={`h-9 rounded-lg px-4 text-sm font-medium transition-colors disabled:opacity-50 ${
                isSuspended
                  ? "bg-precision-teal/10 text-precision-teal hover:bg-precision-teal/20"
                  : "bg-destructive/10 text-destructive hover:bg-destructive/20"
              }`}
            >
              {isSuspended ? "Activate" : "Suspend"}
            </button>
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

          <div className="rounded-xl border border-destructive/30 bg-card p-5">
            <h3 className="mb-3 text-sm font-semibold text-destructive">Danger Zone</h3>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setShowSetKind(!showSetKind)}
                className="h-9 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
              >
                Set Kind
              </button>
              <button
                onClick={() => setShowTransfer(!showTransfer)}
                className="h-9 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
              >
                Transfer Owner
              </button>
              <button
                onClick={() => setShowClearData(!showClearData)}
                className="h-9 rounded-lg bg-signal-gold/10 px-4 text-sm font-medium text-signal-gold hover:bg-signal-gold/20 transition-colors"
              >
                Clear Data
              </button>
              {!org.deletedAt && (
                <button
                  onClick={() => setShowDeleteOrg(!showDeleteOrg)}
                  className="h-9 rounded-lg bg-destructive/10 px-4 text-sm font-medium text-destructive hover:bg-destructive/20 transition-colors"
                >
                  Delete Org
                </button>
              )}
            </div>
            <div className="mt-3 space-y-3">
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

          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="mb-4 text-sm font-semibold text-foreground">
              Members ({org.members.length})
            </h3>
            {org.members.length === 0 ? (
              <p className="text-sm text-muted-foreground">No members.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="pb-2 pr-4 font-medium text-muted-foreground">Email</th>
                      <th className="pb-2 pr-4 font-medium text-muted-foreground">Role</th>
                      <th className="pb-2 font-medium text-muted-foreground">Joined</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {org.members.map((m) => (
                      <tr key={m.id}>
                        <td className="py-2 pr-4">
                          <Link
                            href={`/admin/users/${m.userId}`}
                            className="text-sm text-vatic-indigo hover:underline"
                          >
                            {m.email}
                          </Link>
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground capitalize">
                          {m.role}
                        </td>
                        <td className="py-2 text-muted-foreground">
                          {new Date(m.joinedAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="mb-4 text-sm font-semibold text-foreground">
              Locations ({org.locations.length})
            </h3>
            {org.locations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No locations.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="pb-2 pr-4 font-medium text-muted-foreground">Name</th>
                      <th className="pb-2 pr-4 font-medium text-muted-foreground">City</th>
                      <th className="pb-2 pr-4 font-medium text-muted-foreground">Competitors</th>
                      <th className="pb-2 font-medium text-muted-foreground">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {org.locations.map((l) => (
                      <tr key={l.id}>
                        <td className="py-2 pr-4 font-medium text-foreground">
                          {l.name}
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {l.city ?? "—"}
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {l.competitorCount}
                        </td>
                        <td className="py-2 text-muted-foreground">
                          {new Date(l.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="mb-4 text-sm font-semibold text-foreground">
              Admin Activity
            </h3>
            {org.activityLog.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity logged yet.</p>
            ) : (
              <div className="space-y-3">
                {org.activityLog.map((log) => (
                  <div key={log.id} className="border-l-2 border-border pl-3 py-1">
                    <p className="text-xs font-medium text-foreground">
                      {log.action.replace(/\./g, " → ")}
                    </p>
                    {log.reason && (
                      <p className="text-[11px] italic text-muted-foreground">
                        &ldquo;{log.reason}&rdquo;
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      by {log.actorType === "system" ? "system" : log.adminEmail} ·{" "}
                      {new Date(log.createdAt).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
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
    <div className="rounded-xl border border-vatic-indigo/30 bg-vatic-indigo/5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">{blurb}</p>
        </div>
        {state === "ready" ? (
          <button
            onClick={handleOpen}
            disabled={isPending}
            className="h-9 rounded-lg bg-vatic-indigo px-4 text-sm font-semibold text-white hover:bg-vatic-indigo/90 disabled:opacity-50 transition-colors"
          >
            {isPending ? "Opening…" : "Open demo →"}
          </button>
        ) : (
          <Link
            href={`/onboarding?org=${org.id}`}
            className="inline-flex h-9 items-center rounded-lg bg-vatic-indigo px-4 text-sm font-semibold text-white hover:bg-vatic-indigo/90 transition-colors"
          >
            {state === "fresh" ? "Set up demo →" : "Resume setup →"}
          </Link>
        )}
      </div>
    </div>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-foreground">{value}</p>
    </div>
  )
}

function TierBadge({ tier }: { tier: string }) {
  const colors: Record<string, string> = {
    free: "bg-secondary text-foreground",
    entry: "bg-vatic-indigo/10 text-vatic-indigo",
    mid: "bg-precision-teal/10 text-precision-teal",
    top: "bg-signal-gold/10 text-signal-gold",
    suspended: "bg-destructive/10 text-destructive",
  }

  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium capitalize ${colors[tier] ?? "bg-secondary text-foreground"}`}
    >
      {tier}
    </span>
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
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Change Tier</h3>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>
      <form onSubmit={handleSubmit} className="flex items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">New Tier</label>
          <select
            value={selectedTier}
            onChange={(e) => setSelectedTier(e.target.value)}
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-vatic-indigo"
          >
            <option value="entry">Entry</option>
            <option value="mid">Mid</option>
            <option value="top">Top</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="h-9 rounded-lg bg-vatic-indigo px-4 text-sm font-medium text-white hover:bg-vatic-indigo/90 disabled:opacity-50 transition-colors"
        >
          {isPending ? "Saving..." : "Update Tier"}
        </button>
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
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Edit Organization</h3>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-vatic-indigo"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Billing Email</label>
            <input
              type="email"
              value={billingEmail}
              onChange={(e) => setBillingEmail(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-vatic-indigo"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Slug</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-vatic-indigo"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Industry</label>
            <select
              value={industry}
              onChange={(e) => setIndustry(e.target.value as Industry)}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-vatic-indigo"
            >
              <option value="restaurant">Restaurant</option>
              <option value="liquor_store">Liquor store</option>
            </select>
          </div>
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="h-9 rounded-lg bg-vatic-indigo px-4 text-sm font-medium text-white hover:bg-vatic-indigo/90 disabled:opacity-50 transition-colors"
        >
          {isPending ? "Saving..." : "Save Changes"}
        </button>
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

  let tone = "border-border bg-card text-foreground"
  let text: string
  if (isSuspended) {
    tone = "border-destructive/30 bg-destructive/10 text-destructive"
    text = "Suspended — members have no access."
  } else if (paymentState === "active" || paymentState === "past_due") {
    tone = "border-precision-teal/30 bg-precision-teal/10 text-precision-teal"
    text = "Paid — subscription active."
  } else if (trialActive) {
    tone =
      trialDaysLeft <= 2
        ? "border-destructive/30 bg-destructive/10 text-destructive"
        : trialDaysLeft <= 5
          ? "border-signal-gold/30 bg-signal-gold/10 text-signal-gold"
          : "border-border bg-card text-foreground"
    text = `Trial — ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left${
      endStr ? `, expires ${endStr}` : ""
    }${paymentState === "trialing" ? "" : " (no card)"}`
  } else if (trialEndsAt) {
    tone = "border-destructive/30 bg-destructive/10 text-destructive"
    text = `Trial expired${endStr ? ` ${endStr}` : ""}.`
  } else {
    text = "No active trial or subscription."
  }

  const kindNote = orgKind !== "real" ? ` · ${orgKind.toUpperCase()} org (non-billable)` : ""

  return (
    <div className={`rounded-xl border px-4 py-3 text-sm font-medium ${tone}`}>
      {text}
      {kindNote}
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
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Set Trial End Date</h3>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>
      <form onSubmit={handleSubmit} className="flex items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Trial ends</label>
          <input
            type="datetime-local"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-vatic-indigo"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="h-9 rounded-lg bg-vatic-indigo px-4 text-sm font-medium text-white hover:bg-vatic-indigo/90 disabled:opacity-50 transition-colors"
        >
          {isPending ? "Saving..." : "Set Date"}
        </button>
      </form>
      <p className="mt-2 text-xs text-muted-foreground">
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
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Convert to Paid</h3>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Tier</label>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as "entry" | "mid" | "top")}
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-vatic-indigo"
          >
            <option value="entry">Entry</option>
            <option value="mid">Mid</option>
            <option value="top">Top</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Cadence</label>
          <select
            value={cadence}
            onChange={(e) => setCadence(e.target.value as "monthly" | "annual")}
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-vatic-indigo"
          >
            <option value="monthly">Monthly</option>
            <option value="annual">Annual</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="h-9 rounded-lg bg-precision-teal px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-colors"
        >
          {isPending ? "Creating..." : "Generate Checkout Link"}
        </button>
      </form>
      {url && (
        <div className="mt-3">
          <label className="mb-1 block text-xs text-muted-foreground">
            Send this link to the customer:
          </label>
          <input
            type="text"
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-vatic-indigo"
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
    <div className="rounded-lg border border-border bg-background p-4">
      <form onSubmit={handleSubmit} className="flex items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Classification</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as "real" | "demo" | "test")}
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-vatic-indigo"
          >
            <option value="real">Customer</option>
            <option value="demo">Demo</option>
            <option value="test">Test</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="h-9 rounded-lg bg-vatic-indigo px-4 text-sm font-medium text-white hover:bg-vatic-indigo/90 disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Apply"}
        </button>
        <button type="button" onClick={onClose} className="h-9 px-2 text-xs text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </form>
      <p className="mt-2 text-xs text-muted-foreground">
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
      <div className="rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground">
        No other members to transfer ownership to. Add a member first.
        <button onClick={onClose} className="ml-2 text-xs text-vatic-indigo hover:underline">
          Close
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <form onSubmit={handleSubmit} className="flex items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">New owner</label>
          <select
            value={toUserId}
            onChange={(e) => setToUserId(e.target.value)}
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-vatic-indigo"
          >
            {candidates.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.email}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="h-9 rounded-lg bg-vatic-indigo px-4 text-sm font-medium text-white hover:bg-vatic-indigo/90 disabled:opacity-50"
        >
          {isPending ? "Transferring..." : "Transfer"}
        </button>
        <button type="button" onClick={onClose} className="h-9 px-2 text-xs text-muted-foreground hover:text-foreground">
          Cancel
        </button>
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
    <div className="rounded-lg border border-signal-gold/30 bg-background p-4">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Mode</label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "all" | "refresh")}
            className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-vatic-indigo"
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
            className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-vatic-indigo"
          />
        )}
        <p className="text-xs text-muted-foreground">
          Keeps the org, members, and billing. Type <strong className="text-foreground">{orgName}</strong> to confirm.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={orgName}
            className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-vatic-indigo"
          />
          <button
            type="submit"
            disabled={!ready || isPending}
            className="h-9 rounded-lg bg-signal-gold px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {isPending ? "Clearing..." : "Clear Data"}
          </button>
          <button type="button" onClick={onClose} className="h-9 px-2 text-xs text-muted-foreground hover:text-foreground">
            Cancel
          </button>
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
    <div className="rounded-lg border border-destructive/30 bg-background p-4">
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-xs font-semibold text-destructive">
          Permanently deletes {orgName} and all its data (locations, competitors, insights,
          memberships). This cannot be undone.
        </p>
        <p className="text-xs text-muted-foreground">
          Type <strong className="text-foreground">{orgName}</strong> and give a reason to confirm.
        </p>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (required, recorded in the audit log)"
          className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-destructive"
        />
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={orgName}
            className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-destructive"
          />
          <button
            type="submit"
            disabled={!ready || isPending}
            className="h-9 rounded-lg bg-destructive px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {isPending ? "Deleting..." : "Delete Permanently"}
          </button>
          <button type="button" onClick={onClose} className="h-9 px-2 text-xs text-muted-foreground hover:text-foreground">
            Cancel
          </button>
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
    <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-destructive">This organization is deleted</p>
          <p className="text-xs text-muted-foreground">
            Deleted {new Date(deletedAt).toLocaleString()} · hidden from all admin lists, counts,
            and crons. Restore it, or permanently purge it (super admin).
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleRestore}
            disabled={isPending}
            className="h-9 rounded-lg bg-precision-teal/15 px-4 text-sm font-semibold text-precision-teal hover:bg-precision-teal/25 disabled:opacity-50"
          >
            {isPending ? "..." : "Restore"}
          </button>
          <button
            onClick={() => setShowPurge((s) => !s)}
            className="h-9 rounded-lg bg-destructive/15 px-4 text-sm font-semibold text-destructive hover:bg-destructive/25"
          >
            Purge Permanently
          </button>
        </div>
      </div>

      {showPurge && (
        <form onSubmit={handlePurge} className="mt-4 space-y-3 border-t border-destructive/20 pt-4">
          <p className="text-xs font-semibold text-destructive">
            Permanently deletes {orgName} and all its data — irreversible. Type{" "}
            <strong className="text-foreground">{orgName}</strong> and give a reason.
          </p>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required, recorded in the audit log)"
            className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-destructive"
          />
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={orgName}
              className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-destructive"
            />
            <button
              type="submit"
              disabled={!purgeReady || isPending}
              className="h-9 rounded-lg bg-destructive px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {isPending ? "Purging..." : "Purge"}
            </button>
            <button
              type="button"
              onClick={() => setShowPurge(false)}
              className="h-9 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
