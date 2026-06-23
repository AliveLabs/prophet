import { connection } from "next/server"
import Link from "next/link"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { isTrialing, isPaidActive } from "@/lib/billing/trial"
import { OrgsTable } from "./components/orgs-table"

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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Organizations
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage all organizations, adjust tiers, and reset trials.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total Orgs" value={stats.total} />
        <StatCard
          label="Active Trials"
          value={stats.activeTrials}
          color="text-precision-teal"
        />
        <StatCard
          label="Expired Trials"
          value={stats.expiredTrials}
          color="text-signal-gold"
        />
        <StatCard
          label="Paid"
          value={stats.paid}
          color="text-vatic-indigo"
        />
      </div>

      <OrgsTable orgs={orgs} />

      {deleted.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
            Deleted ({deleted.length})
          </h2>
          <ul className="divide-y divide-border text-sm">
            {deleted.map((o) => (
              <li key={o.id} className="flex items-center justify-between py-2">
                <Link
                  href={`/admin/organizations/${o.id}`}
                  className="text-vatic-indigo hover:underline"
                >
                  {o.name} <span className="text-muted-foreground">/{o.slug}</span>
                </Link>
                <span className="text-xs text-muted-foreground">
                  deleted {new Date(o.deletedAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`mt-2 text-3xl font-bold ${color ?? "text-foreground"}`}>
        {value}
      </p>
    </div>
  )
}
