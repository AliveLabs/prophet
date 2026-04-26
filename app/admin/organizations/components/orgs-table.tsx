"use client"

import { useState, useMemo } from "react"
import Link from "next/link"

interface OrgRow {
  id: string
  name: string
  slug: string
  tier: string
  trialEndsAt: string | null
  memberCount: number
  locationCount: number
  createdAt: string
  industryType: string
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
      return (
        matchesSearch &&
        o.tier === "free" &&
        o.trialEndsAt &&
        new Date(o.trialEndsAt) > new Date()
      )
    }
    if (tierFilter === "trial_expired") {
      return (
        matchesSearch &&
        o.tier === "free" &&
        o.trialEndsAt &&
        new Date(o.trialEndsAt) <= new Date()
      )
    }
    return matchesSearch && o.tier === tierFilter
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search by name or slug..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-72 rounded-lg border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-vatic-indigo"
        />

        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          className="h-9 rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-vatic-indigo"
        >
          <option value="all">All</option>
          <option value="free">Free</option>
          <option value="trial_active">Active Trials</option>
          <option value="trial_expired">Expired Trials</option>
          <option value="entry">Entry</option>
          <option value="mid">Mid</option>
          <option value="top">Top</option>
          <option value="suspended">Suspended</option>
        </select>

        <select
          value={industryFilter}
          onChange={(e) => setIndustryFilter(e.target.value)}
          className="h-9 rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-vatic-indigo"
        >
          <option value="all">All Industries</option>
          <option value="restaurant">Restaurant</option>
          <option value="liquor_store">Liquor Store</option>
        </select>

        <a
          href="/api/admin/export/organizations"
          className="ml-auto h-9 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-secondary transition-colors inline-flex items-center"
        >
          Export CSV
        </a>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-card text-left">
              <th className="px-4 py-3 font-medium text-muted-foreground">
                Name
              </th>
              <th className="px-4 py-3 font-medium text-muted-foreground">
                Industry
              </th>
              <th className="px-4 py-3 font-medium text-muted-foreground">
                Tier
              </th>
              <th className="px-4 py-3 font-medium text-muted-foreground">
                Trial Status
              </th>
              <th className="px-4 py-3 font-medium text-muted-foreground">
                Members
              </th>
              <th className="px-4 py-3 font-medium text-muted-foreground">
                Locations
              </th>
              <th className="px-4 py-3 font-medium text-muted-foreground">
                Created
              </th>
              <th className="px-4 py-3 font-medium text-muted-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((org) => (
              <tr key={org.id} className="hover:bg-secondary/30 transition-colors">
                <td className="px-4 py-3">
                  <div>
                    <span className="font-medium text-foreground">{org.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {org.slug}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <IndustryBadge industryType={org.industryType} />
                </td>
                <td className="px-4 py-3">
                  <TierBadge tier={org.tier} />
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  <TrialStatus tier={org.tier} trialEndsAt={org.trialEndsAt} />
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {org.memberCount}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {org.locationCount}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(org.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/organizations/${org.id}`}
                    className="text-xs font-medium text-vatic-indigo hover:underline"
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  No organizations found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function IndustryBadge({ industryType }: { industryType: string }) {
  const label = industryType === "liquor_store" ? "Liquor Store" : "Restaurant"
  const color =
    industryType === "liquor_store"
      ? "bg-signal-gold/10 text-signal-gold"
      : "bg-vatic-indigo/10 text-vatic-indigo"

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}
    >
      {label}
    </span>
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
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${colors[tier] ?? "bg-secondary text-foreground"}`}
    >
      {tier}
    </span>
  )
}

function TrialStatus({
  tier,
  trialEndsAt,
}: {
  tier: string
  trialEndsAt: string | null
}) {
  const now = useMemo(() => new Date(), [])

  if (tier === "suspended") return <span className="text-destructive">Suspended</span>
  if (tier !== "free") return <span className="text-precision-teal">Paid</span>
  if (!trialEndsAt) return <span>No trial</span>

  const endsAt = new Date(trialEndsAt)
  if (endsAt <= now) {
    return <span className="text-destructive">Expired</span>
  }

  const daysLeft = Math.ceil(
    (endsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  )
  return (
    <span className="text-precision-teal">
      {daysLeft}d remaining
    </span>
  )
}
