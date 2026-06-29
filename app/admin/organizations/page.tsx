import { connection } from "next/server"
import type { CSSProperties } from "react"
import Link from "next/link"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { isTrialing, isPaidActive } from "@/lib/billing/trial"
import { RevealOnView } from "@/components/ticket"
import { OrgsTable } from "./components/orgs-table"
import "./orgs.css"

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

async function fetchOrgs(): Promise<{
  orgs: OrgRow[]
  deleted: Array<{ id: string; name: string; slug: string; deletedAt: string }>
  stats: { total: number; activeTrials: number; expiredTrials: number; paid: number }
}> {
  await connection()
  const supabase = createAdminSupabaseClient()

  const { data: orgsData } = await supabase
    .from("organizations")
    .select(
      "id, name, slug, subscription_tier, trial_ends_at, payment_state, created_at, industry_type"
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  // Soft-deleted orgs (Phase 6c) — surfaced as a separate section so they can be restored
  // or purged from their detail page; excluded from the main list + all counts above.
  const { data: deletedData } = await supabase
    .from("organizations")
    .select("id, name, slug, deleted_at")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false })

  const { data: members } = await supabase
    .from("organization_members")
    .select("organization_id")

  const { data: locations } = await supabase
    .from("locations")
    .select("organization_id")

  const memberCounts = new Map<string, number>()
  for (const m of members ?? []) {
    memberCounts.set(
      m.organization_id,
      (memberCounts.get(m.organization_id) ?? 0) + 1
    )
  }

  const locationCounts = new Map<string, number>()
  for (const l of locations ?? []) {
    locationCounts.set(
      l.organization_id,
      (locationCounts.get(l.organization_id) ?? 0) + 1
    )
  }

  const now = new Date()
  const allOrgs = orgsData ?? []

  const orgs: OrgRow[] = allOrgs.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    tier: o.subscription_tier,
    trialEndsAt: o.trial_ends_at,
    paymentState: o.payment_state ?? null,
    memberCount: memberCounts.get(o.id) ?? 0,
    locationCount: locationCounts.get(o.id) ?? 0,
    createdAt: o.created_at,
    industryType: o.industry_type,
  }))

  // Trials = card-backed (payment_state 'trialing') or legacy clock-only
  // (null payment_state + clock). Paid = converted (Stripe active/dunning).
  const stats = {
    total: orgs.length,
    activeTrials: allOrgs.filter((o) => isTrialing(o)).length,
    expiredTrials: allOrgs.filter(
      (o) =>
        o.payment_state == null &&
        o.subscription_tier !== "suspended" &&
        o.trial_ends_at &&
        new Date(o.trial_ends_at) <= now
    ).length,
    paid: allOrgs.filter((o) => isPaidActive(o)).length,
  }

  const deleted = (deletedData ?? []).map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    deletedAt: o.deleted_at as string,
  }))

  return { orgs, deleted, stats }
}

export default async function AdminOrgsPage() {
  const { orgs, deleted, stats } = await fetchOrgs()

  return (
    <div className="ticket-chrome tk-kit ao-page">
      <RevealOnView as="header" className="ao-page-head">
        <span className="tk-eyebrow">Platform · Accounts</span>
        <h1>Organizations</h1>
        <p>
          Every organization on the platform — adjust tiers, manage trials,
          view as the customer, and run the destructive operations.
        </p>
      </RevealOnView>

      <RevealOnView className="ao-stats" stagger>
        <StatTile i={0} label="Total" value={stats.total} tone="ink" />
        <StatTile i={1} label="Active Trials" value={stats.activeTrials} tone="teal" />
        <StatTile i={2} label="Expired Trials" value={stats.expiredTrials} tone="gold" />
        <StatTile i={3} label="Paid" value={stats.paid} tone="rust" />
      </RevealOnView>

      <RevealOnView>
        <OrgsTable orgs={orgs} />
      </RevealOnView>

      {deleted.length > 0 && (
        <RevealOnView className="tk-card">
          <div className="ao-cardlbl">
            Deleted <span className="ao-count">{deleted.length}</span>
          </div>
          <div className="ao-deleted-list">
            {deleted.map((o) => (
              <div key={o.id} className="ao-deleted-row">
                <Link href={`/admin/organizations/${o.id}`}>
                  {o.name} <span className="ao-slug">/{o.slug}</span>
                </Link>
                <span className="ao-when">
                  deleted {new Date(o.deletedAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </RevealOnView>
      )}
    </div>
  )
}

function StatTile({
  i,
  label,
  value,
  tone,
}: {
  i: number
  label: string
  value: number
  tone: "ink" | "teal" | "gold" | "rust"
}) {
  return (
    <div className={`ao-stat ao-tone-${tone}`} style={{ "--tk-i": i } as CSSProperties}>
      <span className="ao-stat-lbl">{label}</span>
      <span className="ao-stat-val">{value}</span>
      <span className="ao-stat-bar" aria-hidden="true">
        <i />
      </span>
    </div>
  )
}
