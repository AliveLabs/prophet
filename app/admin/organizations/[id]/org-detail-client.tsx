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
} from "@/app/actions/org-management"

interface OrgDetail {
  id: string
  name: string
  slug: string
  billingEmail: string | null
  tier: string
  trialStartedAt: string | null
  trialEndsAt: string | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  createdAt: string
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
    details: Record<string, unknown> | null
    createdAt: string
  }>
}

export function OrgDetailClient({ org }: { org: OrgDetail }) {
  const [isPending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState("")
  const [showEdit, setShowEdit] = useState(false)
  const [showTierChange, setShowTierChange] = useState(false)

  const isSuspended = org.tier === "suspended"
  const isTrial =
    org.tier === "free" && org.trialEndsAt
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
                    ? `${trialDaysLeft}d left`
                    : isTrial
                      ? "Expired"
                      : org.tier === "free"
                        ? "No trial"
                        : "Paid"
                }
              />
              <InfoItem label="Created" value={new Date(org.createdAt).toLocaleDateString()} />
              <InfoItem
                label="Stripe Customer"
                value={org.stripeCustomerId ? "Connected" : "None"}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
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

          {showEdit && (
            <EditOrgPanel
              orgId={org.id}
              currentName={org.name}
              currentBillingEmail={org.billingEmail ?? ""}
              onClose={() => setShowEdit(false)}
              onFeedback={setFeedback}
            />
          )}

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
                    <p className="text-[11px] text-muted-foreground">
                      by {log.adminEmail} ·{" "}
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
    starter: "bg-vatic-indigo/10 text-vatic-indigo",
    pro: "bg-precision-teal/10 text-precision-teal",
    agency: "bg-signal-gold/10 text-signal-gold",
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
            <option value="free">Free</option>
            <option value="starter">Starter</option>
            <option value="pro">Pro</option>
            <option value="agency">Agency</option>
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

function EditOrgPanel({
  orgId,
  currentName,
  currentBillingEmail,
  onClose,
  onFeedback,
}: {
  orgId: string
  currentName: string
  currentBillingEmail: string
  onClose: () => void
  onFeedback: (msg: string) => void
}) {
  const [name, setName] = useState(currentName)
  const [billingEmail, setBillingEmail] = useState(currentBillingEmail)
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const updates: { name?: string; billingEmail?: string } = {}
    if (name !== currentName) updates.name = name
    if (billingEmail !== currentBillingEmail) updates.billingEmail = billingEmail
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
