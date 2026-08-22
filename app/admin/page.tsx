// TICKET ADMIN: Platform Overview, rebuilt to "The Pass".
//
// STRUCTURE rebuild (not a reskin): the old flat stack of bordered "CardGrid"
// boxes is replaced with weighted WIDGET tiles (gradient = headline weight,
// --card = data) + kit TkCard sections holding token-driven, animate-in viz
// (ranked bars, funnel meters, sparkbars, pill stats, an activity feed). The
// data layer is IDENTICAL: fetchPlatformMetrics is unchanged; only presentation
// moved to the kit + admin.css chrome.

import { connection } from "next/server"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { isTrialing, isPaidActive } from "@/lib/billing/trial"
import { summarizeUserLifecycle } from "@/lib/ops/user-lifecycle"
import {
  RevealOnView,
  TkCard,
  TkSectionHead,
  TkWidgetGrid,
  TkWidget,
  TkNumBig,
  TkEmptyState,
} from "@/components/ticket"
import { AdminBars, AdminFunnel, AdminSparkbars } from "./admin-metrics"

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
      .select("*", { count: "exact", head: true })
      .is("deleted_at", null),
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
        "id, name, slug, subscription_tier, trial_started_at, trial_ends_at, payment_state, stripe_customer_id, created_at"
      )
      .is("deleted_at", null),
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
      .select("id, email, full_name, current_organization_id, created_at, last_seen_at"),
  ])

  let authUserCount = 0
  let neverSignedIn = 0
  let signedInNoOrg = 0
  let recentlyActive = 0
  try {
    const { data: authData } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    })
    authUserCount = authData?.users?.length ?? 0

    // ONE shared definition with /admin/users (lib/ops/user-lifecycle.ts). This block used to
    // compute "never onboarded" as "has no current_organization_id", which is a different thing:
    // it missed invited users who never signed in (they have an org set FOR them) and wrongly
    // included users whose org was later deleted. See that module for the full write-up.
    //
    // "Recently active" still means they were IN the product, not that they re-authenticated. On a
    // magic-link product last_sign_in_at only moves when a session lapses, so it under-counts
    // daily users badly; the summarizer reads the resolved last_seen_at for that reason.
    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]))
    const summary = summarizeUserLifecycle(
      (authData?.users ?? []).map((u) => {
        const profile = profileMap.get(u.id)
        return {
          lastSignInAt: u.last_sign_in_at ?? null,
          lastSeenAtResolved: profile?.last_seen_at ?? u.last_sign_in_at ?? null,
          currentOrganizationId: profile?.current_organization_id ?? null,
          isBanned: !!u.banned_until && new Date(u.banned_until) > new Date(),
        }
      }),
    )
    recentlyActive = summary.activeLast7d
    neverSignedIn = summary.neverSignedIn
    signedInNoOrg = summary.signedInNoOrg
  } catch {
    // auth admin may fail in some environments
  }

  const allOrgs = orgs ?? []
  const now = new Date()
  // Trials = card-backed (payment_state 'trialing') or legacy clock-only
  // (null payment_state + clock). Paid = converted (Stripe active/dunning).
  const activeTrials = allOrgs.filter((o) => isTrialing(o))
  const expiredTrials = allOrgs.filter(
    (o) =>
      o.payment_state == null &&
      o.subscription_tier !== "suspended" &&
      o.trial_ends_at &&
      new Date(o.trial_ends_at) <= now
  )
  const paidOrgs = allOrgs.filter((o) => isPaidActive(o))
  // ALT-713: the three buckets above do not PARTITION the org set. A churned org
  // (payment_state canceled / incomplete_expired / unpaid) is not trialing, not "expired" (that
  // filter requires payment_state to be null) and not paid, so it fell out of the funnel entirely.
  // So did an org with no clock and no payment_state, and a suspended one.
  //
  // Those omissions are what let Conversion read 100%: it divided paid by (active + paid), a
  // denominator that excludes everyone whose trial ENDED WITHOUT CONVERTING. One paid org and no
  // active trials printed 100% next to any number of expired ones.
  //
  // `other` is computed as the REMAINDER rather than as its own predicate, so the buckets are
  // self-checking: if a future state escapes all four, it shows up here instead of vanishing.
  const churnedOrgs = allOrgs.filter(
    (o) =>
      o.payment_state === "canceled" ||
      o.payment_state === "incomplete_expired" ||
      o.payment_state === "unpaid" ||
      o.payment_state === "paused"
  )
  const bucketed = new Set([
    ...activeTrials.map((o) => o.id),
    ...expiredTrials.map((o) => o.id),
    ...paidOrgs.map((o) => o.id),
    ...churnedOrgs.map((o) => o.id),
  ])
  const otherOrgs = allOrgs.filter((o) => !bucketed.has(o.id))
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
  // ALT-717: this filtered for "completed" and "success". The job_runs CHECK constraint allows
  // exactly queued | running | succeeded | failed, so NEITHER value can ever exist and the tile was
  // structurally 0%. "error" is impossible for the same reason. Verified against prod 2026-08-21.
  const successfulJobs = allJobs.filter((j) => j.status === "succeeded")
  const failedJobs = allJobs.filter((j) => j.status === "failed")

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
      churned: churnedOrgs.length,
      other: otherOrgs.length,
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
      neverSignedIn,
      signedInNoOrg,
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

  const jobSuccessRate =
    m.jobs.total > 0 ? Math.round((m.jobs.successful / m.jobs.total) * 100) : 0
  const approvedPct =
    m.waitlist.total > 0 ? Math.round((m.waitlist.approved / m.waitlist.total) * 100) : 0
  const pendingPct =
    m.waitlist.total > 0 ? Math.round((m.waitlist.pending / m.waitlist.total) * 100) : 0
  const declinedPct =
    m.waitlist.total > 0 ? Math.round((m.waitlist.declined / m.waitlist.total) * 100) : 0

  const topMax = m.insights.topTypes[0]?.[1] ?? 1
  const insightBars = m.insights.topTypes.map(([type, count]) => ({
    label: type.replace(/_/g, " "),
    value: count,
    pct: Math.round((count / topMax) * 100),
  }))

  const weekEntries = Object.entries(m.waitlist.signupsByWeek)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
  const weekMax = Math.max(1, ...weekEntries.map(([, c]) => c))
  const sparkbars = weekEntries.map(([week, count]) => ({
    label: week.slice(5),
    value: count,
    pct: Math.round((count / weekMax) * 100),
  }))

  return (
    <div className="adm-stack" style={{ display: "flex", flexDirection: "column" }}>
      {/* ── PAGE HEADER ── */}
      <RevealOnView as="header" className="adm-pagehead">
        <div className="adm-pagehead__kicker">Platform</div>
        <h1>Overview</h1>
        <p>
          Real-time analytics across users, organizations, trials, and platform usage —
          refreshed on load.
        </p>
      </RevealOnView>

      {/* ── PLATFORM AT A GLANCE: weighted widget grid ── */}
      <TkSectionHead title="Platform at a glance" sub="Live totals" />
      <RevealOnView>
        <TkWidgetGrid>
          <TkWidget
            tone="rust"
            size="wide"
            label="Auth users"
            value={m.overview.authUserCount.toLocaleString()}
            sub={`${m.users.recentlyActive.toLocaleString()} active in the last 7 days`}
          />
          <TkWidget
            tone="teal"
            label="Organizations"
            value={m.overview.orgCount.toLocaleString()}
          />
          <TkWidget
            tone="gold"
            label="Paid subs"
            value={m.trials.paid.toLocaleString()}
            sub={`${m.trials.active} on trial`}
          />
          <TkWidget
            tone="slate"
            label="Locations"
            value={m.overview.locationCount.toLocaleString()}
          />
          <TkWidget
            tone="slate"
            label="Active competitors"
            value={m.overview.competitorCount.toLocaleString()}
          />
          <TkWidget
            tone="slate"
            size="wide"
            label="Job success rate"
            value={`${jobSuccessRate}%`}
            sub={`${m.jobs.successful.toLocaleString()} of ${m.jobs.total.toLocaleString()} runs · ${m.jobs.failed} failed`}
          />
        </TkWidgetGrid>
      </RevealOnView>

      {/* ── WAITLIST FUNNEL ── */}
      <TkSectionHead title="Waitlist funnel" sub={`${m.waitlist.total.toLocaleString()} signups`} />
      <RevealOnView className="tk-grid">
        <TkCard>
          <TkNumBig
            value={m.waitlist.total}
            caption="Total signups"
            captionRight={`${m.waitlist.pending} awaiting review`}
            sub={
              <>
                <b>{m.waitlist.approved.toLocaleString()}</b> approved ·{" "}
                <b>{m.waitlist.declined.toLocaleString()}</b> declined
              </>
            }
          />
          {m.waitlist.total > 0 && (
            <div style={{ marginTop: 18 }}>
              <AdminFunnel
                items={[
                  { label: "Approved", pct: approvedPct, tone: "teal" },
                  { label: "Pending", pct: pendingPct, tone: "gold" },
                  { label: "Declined", pct: declinedPct, tone: "alert" },
                ]}
              />
            </div>
          )}
        </TkCard>
        <TkCard>
          <span className="tk-eyebrow">Signups by week</span>
          {sparkbars.length > 0 ? (
            <div style={{ marginTop: 14 }}>
              <AdminSparkbars bars={sparkbars} />
            </div>
          ) : (
            <p className="tk-muted" style={{ fontSize: 13, marginTop: 12 }}>
              No signups recorded yet.
            </p>
          )}
        </TkCard>
      </RevealOnView>

      {/* ── TRIALS & BILLING ── */}
      <TkSectionHead title="Trials & billing" sub="Conversion state" />
      <RevealOnView>
        <TkWidgetGrid>
          <TkWidget tone="teal" label="Active trials" value={m.trials.active.toLocaleString()} />
          <TkWidget tone="gold" label="Expired trials" value={m.trials.expired.toLocaleString()} />
          <TkWidget tone="rust" label="Paid subscriptions" value={m.trials.paid.toLocaleString()} />
          <TkWidget tone="gold" label="Churned" value={m.trials.churned.toLocaleString()} />
          {/* ALT-713: the remainder bucket. Non-zero means an org state escapes all four filters,
              which is exactly what used to happen silently. */}
          {m.trials.other > 0 && (
            <TkWidget tone="rust" label="Unclassified orgs" value={m.trials.other.toLocaleString()} />
          )}
          <TkWidget
            tone="slate"
            label="Conversion"
            /* ALT-713: denominated on trials that ENDED. The old denominator was (active + paid),
               which omitted every trial that expired without converting, so it could only ever
               flatter us. Active trials have not decided yet, so they are reported separately
               rather than diluting the rate. */
            value={
              m.trials.paid + m.trials.expired > 0
                ? `${Math.round((m.trials.paid / (m.trials.paid + m.trials.expired)) * 100)}%`
                : "n/a"
            }
            sub={`paid of the ${(m.trials.paid + m.trials.expired).toLocaleString()} trial(s) that ended`}
          />
        </TkWidgetGrid>
      </RevealOnView>
      {Object.keys(m.trials.tierCounts).length > 0 && (
        <RevealOnView>
          <TkCard style={{ marginTop: 14 }}>
            <span className="tk-eyebrow">Paid tier breakdown</span>
            <div className="adm-pills" style={{ marginTop: 12 }}>
              {Object.entries(m.trials.tierCounts).map(([tier, count]) => (
                <span className="adm-pillstat" key={tier}>
                  <span className="adm-pillstat__dot" aria-hidden="true" />
                  <span className="adm-pillstat__name">{tier}</span>
                  <span className="adm-pillstat__n">{count.toLocaleString()}</span>
                </span>
              ))}
            </div>
          </TkCard>
        </RevealOnView>
      )}

      {/* ── USAGE METRICS ── */}
      <TkSectionHead title="Usage metrics" sub="Insights generated" />
      <RevealOnView className="tk-grid">
        <TkCard>
          <TkNumBig
            value={m.insights.total}
            localize
            caption="Total insights"
            captionRight="all time"
            sub={
              <>
                <b>{m.insights.last7.toLocaleString()}</b> in the last 7 days ·{" "}
                <b>{m.insights.last30.toLocaleString()}</b> in 30
              </>
            }
          />
        </TkCard>
        <TkCard>
          <span className="tk-eyebrow">Top insight types · 30 days</span>
          {insightBars.length > 0 ? (
            <div style={{ marginTop: 14 }}>
              <AdminBars rows={insightBars} />
            </div>
          ) : (
            <p className="tk-muted" style={{ fontSize: 13, marginTop: 12 }}>
              No insights in the last 30 days.
            </p>
          )}
        </TkCard>
      </RevealOnView>

      {/* ── USER ACTIVITY ── */}
      <TkSectionHead title="User activity" sub="Engagement signals" />
      <RevealOnView>
        <TkWidgetGrid>
          <TkWidget
            tone="teal"
            size="wide"
            label="Active in last 7 days"
            value={m.users.recentlyActive.toLocaleString()}
            sub="active in the product, not just re-authenticated"
          />
          <TkWidget
            tone="gold"
            size="wide"
            label="Never signed in"
            value={m.users.neverSignedIn.toLocaleString()}
            sub="invited or created, never authenticated once"
          />
          <TkWidget
            tone="rust"
            size="wide"
            label="Signed in, no org"
            value={m.users.signedInNoOrg.toLocaleString()}
            sub="got in, but attached to no organization"
          />
        </TkWidgetGrid>
      </RevealOnView>

      {/* ── RECENT ADMIN ACTIVITY ── */}
      <TkSectionHead title="Recent admin activity" sub="Last 20 actions" />
      <RevealOnView>
        {m.recentActivity.length === 0 ? (
          <TkEmptyState
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M12 8v4l3 2" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="12" cy="12" r="9" />
              </svg>
            }
            title="No activity logged yet"
            description="Admin actions across the platform will appear here as they happen."
          />
        ) : (
          <TkCard>
            <div className="adm-feed">
              {m.recentActivity.map((a) => (
                <div className="adm-feed__row" key={a.id}>
                  <span className="adm-feed__avatar" aria-hidden="true">
                    {a.adminEmail[0]?.toUpperCase() ?? "?"}
                  </span>
                  <div className="adm-feed__body">
                    <div className="adm-feed__action">
                      {a.action.replace(/\./g, " → ")}
                    </div>
                    <div className="adm-feed__meta">
                      by {a.adminEmail || "system"} · {a.targetType}
                      {a.targetId ? ` · ${a.targetId.slice(0, 8)}…` : ""}
                    </div>
                  </div>
                  <span className="adm-feed__time">
                    {a.createdAt ? new Date(a.createdAt).toLocaleString() : "n/a"}
                  </span>
                </div>
              ))}
            </div>
          </TkCard>
        )}
      </RevealOnView>
    </div>
  )
}
