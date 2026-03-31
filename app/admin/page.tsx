import { connection } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"

interface MetricCard {
  label: string
  value: string | number
  sub?: string
  color?: string
}

async function fetchPlatformMetrics() {
  await connection()
  const supabase = createAdminSupabaseClient()

  const [
    { count: orgCount },
    { count: locationCount },
    { count: competitorCount },
    { count: insightCount },
    { count: jobRunCount },
    { data: orgs },
    { data: waitlistRows },
    { data: recentInsights },
    { data: jobRuns },
    { data: profiles },
  ] = await Promise.all([
    supabase
      .from("organizations")
      .select("*", { count: "exact", head: true }),
    supabase.from("locations").select("*", { count: "exact", head: true }),
    supabase
      .from("competitors")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true),
    supabase.from("insights").select("*", { count: "exact", head: true }),
    supabase.from("job_runs").select("*", { count: "exact", head: true }),
    supabase
      .from("organizations")
      .select(
        "id, name, slug, subscription_tier, trial_started_at, trial_ends_at, stripe_customer_id, created_at"
      ),
    supabase
      .from("waitlist_signups")
      .select("id, email, status, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("insights")
      .select("id, insight_type, created_at")
      .gte(
        "created_at",
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      ),
    supabase
      .from("job_runs")
      .select("id, status, job_type, created_at"),
    supabase
      .from("profiles")
      .select("id, email, full_name, current_organization_id, created_at"),
  ])

  let authUserCount = 0
  let neverOnboarded = 0
  let recentlyActive = 0
  try {
    const { data: authData } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    })
    authUserCount = authData?.users?.length ?? 0

    const now = Date.now()
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000
    recentlyActive = (authData?.users ?? []).filter(
      (u) => u.last_sign_in_at && new Date(u.last_sign_in_at).getTime() > weekAgo
    ).length

    const allProfiles = profiles ?? []
    const profileIds = new Set(
      allProfiles
        .filter((p) => p.current_organization_id)
        .map((p) => p.id)
    )
    neverOnboarded = (authData?.users ?? []).filter(
      (u) => !profileIds.has(u.id)
    ).length
  } catch {
    // auth admin may fail in some environments
  }

  const allOrgs = orgs ?? []
  const now = new Date()
  const activeTrials = allOrgs.filter(
    (o) =>
      o.subscription_tier === "free" &&
      o.trial_ends_at &&
      new Date(o.trial_ends_at) > now
  )
  const expiredTrials = allOrgs.filter(
    (o) =>
      o.subscription_tier === "free" &&
      o.trial_ends_at &&
      new Date(o.trial_ends_at) <= now
  )
  const paidOrgs = allOrgs.filter((o) => o.subscription_tier !== "free")
  const tierCounts: Record<string, number> = {}
  for (const o of paidOrgs) {
    tierCounts[o.subscription_tier] =
      (tierCounts[o.subscription_tier] ?? 0) + 1
  }

  const allWaitlist = waitlistRows ?? []
  const waitlistPending = allWaitlist.filter((w) => w.status === "pending").length
  const waitlistApproved = allWaitlist.filter(
    (w) => w.status === "approved"
  ).length
  const waitlistDeclined = allWaitlist.filter(
    (w) => w.status === "declined"
  ).length

  const last30Insights = recentInsights ?? []
  const last7Insights = last30Insights.filter(
    (i) =>
      new Date(i.created_at).getTime() >
      Date.now() - 7 * 24 * 60 * 60 * 1000
  )

  const insightsByType: Record<string, number> = {}
  for (const i of last30Insights) {
    insightsByType[i.insight_type] =
      (insightsByType[i.insight_type] ?? 0) + 1
  }
  const topInsightTypes = Object.entries(insightsByType)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)

  const allJobs = jobRuns ?? []
  const successfulJobs = allJobs.filter((j) => j.status === "completed" || j.status === "success")
  const failedJobs = allJobs.filter((j) => j.status === "failed" || j.status === "error")

  const signupsByWeek: Record<string, number> = {}
  for (const w of allWaitlist) {
    const d = new Date(w.created_at)
    const weekStart = new Date(d)
    weekStart.setDate(d.getDate() - d.getDay())
    const key = weekStart.toISOString().slice(0, 10)
    signupsByWeek[key] = (signupsByWeek[key] ?? 0) + 1
  }

  const { data: recentActivity } = await supabase
    .from("admin_activity_log")
    .select("id, admin_email, action, target_type, target_id, created_at")
    .order("created_at", { ascending: false })
    .limit(20)

  return {
    overview: {
      authUserCount,
      orgCount: orgCount ?? 0,
      locationCount: locationCount ?? 0,
      competitorCount: competitorCount ?? 0,
    },
    waitlist: {
      total: allWaitlist.length,
      pending: waitlistPending,
      approved: waitlistApproved,
      declined: waitlistDeclined,
      signupsByWeek,
    },
    trials: {
      active: activeTrials.length,
      expired: expiredTrials.length,
      paid: paidOrgs.length,
      tierCounts,
    },
    insights: {
      total: insightCount ?? 0,
      last7: last7Insights.length,
      last30: last30Insights.length,
      topTypes: topInsightTypes,
    },
    jobs: {
      total: jobRunCount ?? 0,
      successful: successfulJobs.length,
      failed: failedJobs.length,
    },
    users: {
      recentlyActive,
      neverOnboarded,
    },
    recentActivity: (recentActivity ?? []).map((a) => ({
      id: a.id,
      adminEmail: a.admin_email ?? "",
      action: a.action,
      targetType: a.target_type,
      targetId: a.target_id ?? "",
      createdAt: a.created_at ?? "",
    })),
  }
}

export default async function AdminOverviewPage() {
  const m = await fetchPlatformMetrics()

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Platform Overview
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Real-time analytics across users, organizations, trials, and platform
          usage.
        </p>
      </div>

      <Section title="Platform at a Glance">
        <CardGrid
          cards={[
            { label: "Auth Users", value: m.overview.authUserCount },
            { label: "Organizations", value: m.overview.orgCount },
            { label: "Locations", value: m.overview.locationCount },
            {
              label: "Active Competitors",
              value: m.overview.competitorCount,
            },
          ]}
        />
      </Section>

      <Section title="Waitlist Funnel">
        <CardGrid
          cards={[
            { label: "Total Signups", value: m.waitlist.total },
            {
              label: "Pending",
              value: m.waitlist.pending,
              color: "text-signal-gold",
            },
            {
              label: "Approved",
              value: m.waitlist.approved,
              color: "text-precision-teal",
            },
            {
              label: "Declined",
              value: m.waitlist.declined,
              color: "text-destructive",
            },
          ]}
        />
        {m.waitlist.total > 0 && (
          <div className="mt-4 rounded-xl border border-border bg-card p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Conversion Rate
            </p>
            <div className="flex items-center gap-6">
              <FunnelBar
                label="Approved"
                pct={
                  m.waitlist.total > 0
                    ? Math.round(
                        (m.waitlist.approved / m.waitlist.total) * 100
                      )
                    : 0
                }
                color="bg-precision-teal"
              />
              <FunnelBar
                label="Pending"
                pct={
                  m.waitlist.total > 0
                    ? Math.round(
                        (m.waitlist.pending / m.waitlist.total) * 100
                      )
                    : 0
                }
                color="bg-signal-gold"
              />
              <FunnelBar
                label="Declined"
                pct={
                  m.waitlist.total > 0
                    ? Math.round(
                        (m.waitlist.declined / m.waitlist.total) * 100
                      )
                    : 0
                }
                color="bg-destructive"
              />
            </div>
          </div>
        )}

        {Object.keys(m.waitlist.signupsByWeek).length > 0 && (
          <div className="mt-4 rounded-xl border border-border bg-card p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Signups by Week
            </p>
            <div className="flex items-end gap-2" style={{ height: 80 }}>
              {Object.entries(m.waitlist.signupsByWeek)
                .sort(([a], [b]) => a.localeCompare(b))
                .slice(-12)
                .map(([week, count]) => {
                  const maxCount = Math.max(
                    ...Object.values(m.waitlist.signupsByWeek)
                  )
                  const h = maxCount > 0 ? (count / maxCount) * 64 : 4
                  return (
                    <div key={week} className="flex flex-1 flex-col items-center gap-1">
                      <div
                        className="w-full rounded-sm bg-vatic-indigo/70"
                        style={{ height: Math.max(4, h) }}
                        title={`${week}: ${count}`}
                      />
                      <span className="text-[9px] text-muted-foreground">
                        {week.slice(5)}
                      </span>
                    </div>
                  )
                })}
            </div>
          </div>
        )}
      </Section>

      <Section title="Trials & Billing">
        <CardGrid
          cards={[
            {
              label: "Active Trials",
              value: m.trials.active,
              color: "text-precision-teal",
            },
            {
              label: "Expired Trials",
              value: m.trials.expired,
              color: "text-signal-gold",
            },
            {
              label: "Paid Subscriptions",
              value: m.trials.paid,
              color: "text-vatic-indigo",
            },
          ]}
        />
        {Object.keys(m.trials.tierCounts).length > 0 && (
          <div className="mt-4 rounded-xl border border-border bg-card p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Paid Tier Breakdown
            </p>
            <div className="flex flex-wrap gap-4">
              {Object.entries(m.trials.tierCounts).map(([tier, count]) => (
                <div key={tier} className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-full bg-vatic-indigo" />
                  <span className="text-sm capitalize text-foreground">
                    {tier}
                  </span>
                  <span className="text-sm font-bold text-foreground">
                    {count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section title="Usage Metrics">
        <CardGrid
          cards={[
            { label: "Total Insights", value: m.insights.total },
            {
              label: "Last 7 Days",
              value: m.insights.last7,
              sub: "insights",
            },
            {
              label: "Last 30 Days",
              value: m.insights.last30,
              sub: "insights",
            },
          ]}
        />
        {m.insights.topTypes.length > 0 && (
          <div className="mt-4 rounded-xl border border-border bg-card p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Top Insight Types (Last 30d)
            </p>
            <div className="space-y-2">
              {m.insights.topTypes.map(([type, count]) => {
                const maxCount = m.insights.topTypes[0]?.[1] ?? 1
                const pct = Math.round((count / maxCount) * 100)
                return (
                  <div key={type} className="flex items-center gap-3">
                    <span className="w-48 truncate text-xs text-muted-foreground">
                      {type.replace(/_/g, " ")}
                    </span>
                    <div className="flex-1">
                      <div className="h-2 rounded-full bg-secondary">
                        <div
                          className="h-2 rounded-full bg-vatic-indigo/70"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                    <span className="w-10 text-right text-xs font-medium text-foreground">
                      {count}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </Section>

      <Section title="Job Runs">
        <CardGrid
          cards={[
            { label: "Total Runs", value: m.jobs.total },
            {
              label: "Successful",
              value: m.jobs.successful,
              color: "text-precision-teal",
            },
            {
              label: "Failed",
              value: m.jobs.failed,
              color: "text-destructive",
            },
            {
              label: "Success Rate",
              value:
                m.jobs.total > 0
                  ? `${Math.round((m.jobs.successful / m.jobs.total) * 100)}%`
                  : "N/A",
            },
          ]}
        />
      </Section>

      <Section title="User Activity">
        <CardGrid
          cards={[
            {
              label: "Active (7d)",
              value: m.users.recentlyActive,
              sub: "signed in last week",
              color: "text-precision-teal",
            },
            {
              label: "Never Onboarded",
              value: m.users.neverOnboarded,
              sub: "signed up but no org",
              color: "text-signal-gold",
            },
          ]}
        />
      </Section>

      <Section title="Recent Admin Activity">
        {m.recentActivity.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity logged yet.</p>
        ) : (
          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            {m.recentActivity.map((a) => (
              <div key={a.id} className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-vatic-indigo/10 text-xs font-bold text-vatic-indigo">
                    {a.adminEmail[0]?.toUpperCase() ?? "?"}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {a.action.replace(/\./g, " → ")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      by {a.adminEmail} · {a.targetType}
                      {a.targetId ? ` · ${a.targetId.slice(0, 8)}…` : ""}
                    </p>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(a.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h2 className="mb-4 text-base font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  )
}

function CardGrid({ cards }: { cards: MetricCard[] }) {
  return (
    <div
      className={`grid gap-4 ${cards.length <= 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2 md:grid-cols-4"}`}
    >
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-xl border border-border bg-card p-5"
        >
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {card.label}
          </p>
          <p
            className={`mt-2 text-3xl font-bold ${card.color ?? "text-foreground"}`}
          >
            {card.value}
          </p>
          {card.sub && (
            <p className="mt-0.5 text-xs text-muted-foreground">{card.sub}</p>
          )}
        </div>
      ))}
    </div>
  )
}

function FunnelBar({
  label,
  pct,
  color,
}: {
  label: string
  pct: number
  color: string
}) {
  return (
    <div className="flex-1">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs font-semibold text-foreground">{pct}%</span>
      </div>
      <div className="h-2.5 rounded-full bg-secondary">
        <div
          className={`h-2.5 rounded-full ${color}`}
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
    </div>
  )
}
