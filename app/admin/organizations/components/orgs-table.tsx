"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { TkEmptyState } from "@/components/ticket"

interface OrgRow {
  id: string
  name: string
  slug: string
  tier: string
  trialEndsAt: string | null
  paymentState: string | null
  memberCount: number
  locationCount: number
  createdAt: string
  industryType: string
}

// Mirrors lib/billing/trial.ts isTrialing: card-backed Stripe trials report
// payment_state 'trialing'; legacy clock-only trials have null payment_state
// plus a live trial clock.
function isTrialingRow(o: { paymentState: string | null; trialEndsAt: string | null }): boolean {
  if (o.paymentState === "trialing") return true
  if (o.paymentState != null) return false
  return !!o.trialEndsAt && new Date(o.trialEndsAt) > new Date()
}

export function OrgsTable({ orgs }: { orgs: OrgRow[] }) {
  const [search, setSearch] = useState("")
  const [tierFilter, setTierFilter] = useState<string>("all")
  const [industryFilter, setIndustryFilter] = useState<string>("all")

  const filtered = orgs.filter((o) => {
    const matchesSearch =
      o.name.toLowerCase().includes(search.toLowerCase()) ||
      o.slug.toLowerCase().includes(search.toLowerCase())

    const matchesIndustry =
      industryFilter === "all" || o.industryType === industryFilter

    if (!matchesIndustry) return false

    if (tierFilter === "all") return matchesSearch
    if (tierFilter === "trial_active") {
      return matchesSearch && isTrialingRow(o)
    }
    if (tierFilter === "trial_expired") {
      return (
        matchesSearch &&
        o.paymentState == null &&
        o.tier !== "suspended" &&
        !!o.trialEndsAt &&
        new Date(o.trialEndsAt) <= new Date()
      )
    }
    return matchesSearch && o.tier === tierFilter
  })

  return (
    <div className="tk-kit" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="ao-toolbar">
        <div className="ao-search">
          <SearchIcon />
          <input
            type="text"
            placeholder="Search by name or slug…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ao-input"
            aria-label="Search organizations"
          />
        </div>

        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          className="ao-select"
          aria-label="Filter by tier"
        >
          <option value="all">All tiers</option>
          <option value="trial_active">Active trials</option>
          <option value="trial_expired">Expired trials</option>
          <option value="entry">Entry</option>
          <option value="mid">Mid</option>
          <option value="top">Top</option>
          <option value="suspended">Suspended</option>
        </select>

        <select
          value={industryFilter}
          onChange={(e) => setIndustryFilter(e.target.value)}
          className="ao-select"
          aria-label="Filter by industry"
        >
          <option value="all">All industries</option>
          <option value="restaurant">Restaurant</option>
          <option value="liquor_store">Liquor store</option>
        </select>

        <div className="ao-spacer">
          <a href="/api/admin/export/organizations" className="tk-btn tk-btn-keep">
            <DownloadIcon />
            Export CSV
          </a>
        </div>
      </div>

      {filtered.length === 0 ? (
        <TkEmptyState
          icon={<SearchIcon />}
          title="No organizations found"
          description="Nothing matches the current search and filters. Try clearing them."
        />
      ) : (
        <div className="ao-tablewrap">
          <div className="ao-tablescroll">
            <table className="ao-table">
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Industry</th>
                  <th>Tier</th>
                  <th>Status</th>
                  <th>Members</th>
                  <th>Locations</th>
                  <th>Created</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((org) => (
                  <tr key={org.id}>
                    <td>
                      <span className="ao-row-name">
                        <span className="ao-nm">{org.name}</span>
                        <span className="ao-slug">/{org.slug}</span>
                      </span>
                    </td>
                    <td>
                      <IndustryBadge industryType={org.industryType} />
                    </td>
                    <td>
                      <TierBadge tier={org.tier} />
                    </td>
                    <td>
                      <TrialStatus
                        tier={org.tier}
                        trialEndsAt={org.trialEndsAt}
                        paymentState={org.paymentState}
                      />
                    </td>
                    <td className="ao-cell-num">{org.memberCount}</td>
                    <td className="ao-cell-num">{org.locationCount}</td>
                    <td className="ao-cell-num">
                      {new Date(org.createdAt).toLocaleDateString()}
                    </td>
                    <td>
                      <Link
                        href={`/admin/organizations/${org.id}`}
                        className="ao-link"
                      >
                        View
                        <ArrowIcon />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function IndustryBadge({ industryType }: { industryType: string }) {
  const isLiquor = industryType === "liquor_store"
  return (
    <span className={`ao-badge ${isLiquor ? "ao-badge-gold" : "ao-badge-slate"}`}>
      {isLiquor ? "Liquor store" : "Restaurant"}
    </span>
  )
}

function TierBadge({ tier }: { tier: string }) {
  const tone: Record<string, string> = {
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

function TrialStatus({
  tier,
  trialEndsAt,
  paymentState,
}: {
  tier: string
  trialEndsAt: string | null
  paymentState: string | null
}) {
  const now = useMemo(() => new Date(), [])

  if (tier === "suspended")
    return <span className="ao-badge ao-badge-alert"><span className="ao-led" />Suspended</span>
  if (paymentState === "active")
    return <span className="ao-badge ao-badge-teal"><span className="ao-led" />Paid</span>
  if (paymentState === "past_due")
    return <span className="ao-badge ao-badge-alert"><span className="ao-led" />Past due</span>
  if (
    paymentState === "canceled" ||
    paymentState === "incomplete_expired" ||
    paymentState === "unpaid"
  ) {
    return <span className="ao-badge ao-badge-ink"><span className="ao-led" />Canceled</span>
  }
  if (!trialEndsAt) return <span className="ao-badge ao-badge-ink">No trial</span>

  const endsAt = new Date(trialEndsAt)
  if (endsAt <= now) {
    return <span className="ao-badge ao-badge-alert"><span className="ao-led" />Expired</span>
  }

  const daysLeft = Math.ceil(
    (endsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  )
  const tone = daysLeft <= 2 ? "ao-badge-alert" : daysLeft <= 5 ? "ao-badge-gold" : "ao-badge-teal"
  return (
    <span className={`ao-badge ${tone}`}>
      <span className="ao-led" />
      {daysLeft}d left{paymentState === "trialing" ? "" : " · no card"}
    </span>
  )
}

/* ── icons ──────────────────────────────────────────────── */
function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="7" cy="7" r="5" />
      <path d="M11 11l3.5 3.5" strokeLinecap="round" />
    </svg>
  )
}
function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M8 2v8M5 7l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 13h10" strokeLinecap="round" />
    </svg>
  )
}
function ArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M3 8h9M8 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
