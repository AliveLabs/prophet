import Link from "next/link"
import { requireUser } from "@/lib/auth/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import JobRefreshButton from "@/components/ui/job-refresh-button"

const SEVERITY_COLORS: Record<string, string> = {
  critical: "border-red-200 bg-red-50 text-red-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  info: "border-blue-200 bg-blue-50 text-blue-800",
  positive: "border-emerald-200 bg-emerald-50 text-emerald-800",
}

const PIPELINE_LABELS: Record<string, { label: string; href: string }> = {
  content: { label: "Content", href: "/content" },
  visibility: { label: "Visibility", href: "/visibility" },
  events: { label: "Events", href: "/events" },
  insights: { label: "Insights", href: "/insights" },
  photos: { label: "Photos", href: "/photos" },
  busy_times: { label: "Busy Times", href: "/traffic" },
  weather: { label: "Weather", href: "/weather" },
}

export default async function HomePage() {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  const organizationId = profile?.current_organization_id
  if (!organizationId) return null

  const [
    { count: locationCount },
    { count: competitorCount },
    { count: insightCount },
    { data: locations },
    { data: recentInsights },
    { data: recentJobs },
  ] = await Promise.all([
    supabase
      .from("locations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId),
    supabase
      .from("competitors")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    supabase
      .from("insights")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("locations")
      .select("id, name")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false }),
    supabase
      .from("insights")
      .select("id, insight_type, title, summary, severity, confidence, created_at, competitor_id")
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("refresh_jobs")
      .select("id, job_type, status, created_at, updated_at, location_id")
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false })
      .limit(20),
  ])

  const defaultLocationId = locations?.[0]?.id ?? null

  const hasLocations = (locationCount ?? 0) > 0
  const hasCompetitors = (competitorCount ?? 0) > 0
  const hasInsights = (insightCount ?? 0) > 0

  const approvedCompetitors = competitorCount ?? 0

  const jobsByType = new Map<string, { status: string; updatedAt: string }>()
  for (const job of recentJobs ?? []) {
    const existing = jobsByType.get(job.job_type)
    if (!existing || job.updated_at > existing.updatedAt) {
      jobsByType.set(job.job_type, {
        status: job.status,
        updatedAt: job.updated_at,
      })
    }
  }

  const isNewUser = !hasCompetitors && !hasInsights

  return (
    <section className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-purple-600 to-violet-600 p-6 text-white shadow-xl shadow-indigo-200/50">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-10 -left-10 h-40 w-40 rounded-full bg-white/5" />
        <div className="relative">
          <h1 className="text-xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-1 max-w-lg text-sm text-white/70">
            Your competitive intelligence overview. Track competitors, monitor signals, and generate actionable insights.
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-white">
          <p className="text-xs font-medium text-slate-500">Locations</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{locationCount ?? 0}</p>
          <Link href="/locations" className="mt-1 text-[11px] text-indigo-600 hover:underline">
            Manage locations
          </Link>
        </Card>
        <Card className="bg-white">
          <p className="text-xs font-medium text-slate-500">Competitors Tracked</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{approvedCompetitors}</p>
          <Link href="/competitors" className="mt-1 text-[11px] text-indigo-600 hover:underline">
            View competitors
          </Link>
        </Card>
        <Card className="bg-white">
          <p className="text-xs font-medium text-slate-500">Total Insights</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{insightCount ?? 0}</p>
          <Link href="/insights" className="mt-1 text-[11px] text-indigo-600 hover:underline">
            View insights
          </Link>
        </Card>
        <Card className="bg-white">
          <p className="text-xs font-medium text-slate-500">Signal Sources</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{jobsByType.size}</p>
          <p className="mt-1 text-[11px] text-slate-400">pipelines with data</p>
        </Card>
      </div>

      {/* Onboarding Checklist (only for new users) */}
      {isNewUser && (
        <Card className="border-indigo-200 bg-indigo-50/50">
          <h2 className="text-sm font-bold text-indigo-900">Getting Started</h2>
          <p className="mt-1 text-xs text-indigo-700/70">
            Complete these steps to start receiving competitive insights.
          </p>
          <div className="mt-4 space-y-3">
            <ChecklistItem
              done={hasLocations}
              label="Add your first location"
              href="/locations"
            />
            <ChecklistItem
              done={hasCompetitors}
              label="Discover and approve competitors"
              href="/competitors"
            />
            <ChecklistItem
              done={hasInsights}
              label="Generate your first insights"
              href="/insights"
            />
          </div>
        </Card>
      )}

      {/* Quick Actions */}
      {defaultLocationId && hasCompetitors && (
        <Card className="bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Quick Actions</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Refresh all data or generate insights for{" "}
                <span className="font-medium">{locations?.[0]?.name ?? "your location"}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <JobRefreshButton
                type="refresh_all"
                locationId={defaultLocationId}
                label="Refresh All Data"
                pendingLabel="Refreshing all data pipelines"
                className="!bg-indigo-600 !text-white hover:!bg-indigo-700"
              />
              <JobRefreshButton
                type="insights"
                locationId={defaultLocationId}
                label="Generate Insights"
                pendingLabel="Generating insights"
              />
            </div>
          </div>
        </Card>
      )}

      {/* Data Freshness */}
      {jobsByType.size > 0 && (
        <Card className="bg-white">
          <h2 className="text-sm font-bold text-slate-900">Data Freshness</h2>
          <p className="mt-0.5 text-xs text-slate-500">Last refresh time for each pipeline</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(PIPELINE_LABELS).map(([type, { label, href }]) => {
              const job = jobsByType.get(type)
              return (
                <Link
                  key={type}
                  href={href}
                  className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 transition-colors hover:bg-slate-50"
                >
                  <span className="text-xs font-medium text-slate-700">{label}</span>
                  {job ? (
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          job.status === "completed"
                            ? "bg-emerald-500"
                            : job.status === "running"
                              ? "bg-amber-500"
                              : "bg-red-400"
                        }`}
                      />
                      <span className="text-[10px] text-slate-400">
                        {formatRelativeTime(job.updatedAt)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-300">No data</span>
                  )}
                </Link>
              )
            })}
          </div>
        </Card>
      )}

      {/* Recent Insights */}
      {(recentInsights?.length ?? 0) > 0 && (
        <Card className="bg-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Recent Insights</h2>
              <p className="mt-0.5 text-xs text-slate-500">Latest intelligence across all sources</p>
            </div>
            <Link
              href="/insights"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
            >
              View all
            </Link>
          </div>
          <div className="mt-4 space-y-2">
            {recentInsights?.map((insight) => (
              <div
                key={insight.id}
                className={`rounded-xl border px-4 py-3 ${
                  SEVERITY_COLORS[insight.severity ?? "info"] ?? SEVERITY_COLORS.info
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{insight.title}</p>
                    <p className="mt-0.5 line-clamp-1 text-xs opacity-70">
                      {insight.summary}
                    </p>
                  </div>
                  <Badge
                    variant={
                      insight.confidence === "high"
                        ? "success"
                        : insight.confidence === "medium"
                          ? "warning"
                          : "default"
                    }
                    className="shrink-0 text-[10px]"
                  >
                    {insight.confidence ?? "medium"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Empty state when no insights */}
      {!hasInsights && hasCompetitors && (
        <Card className="border-dashed bg-white py-8 text-center">
          <svg
            className="mx-auto h-10 w-10 text-slate-300"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
            />
          </svg>
          <p className="mt-3 text-sm font-medium text-slate-600">
            No insights generated yet
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Refresh your data pipelines first, then generate insights to see intelligence here.
          </p>
        </Card>
      )}
    </section>
  )
}

function ChecklistItem({
  done,
  label,
  href,
}: {
  done: boolean
  label: string
  href: string
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border border-indigo-200/50 bg-white px-4 py-3 transition-colors hover:bg-indigo-50"
    >
      <div
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          done ? "bg-emerald-500 text-white" : "border-2 border-slate-300 text-transparent"
        }`}
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <span className={`text-sm ${done ? "text-slate-500 line-through" : "font-medium text-indigo-900"}`}>
        {label}
      </span>
    </Link>
  )
}

function formatRelativeTime(isoDate: string): string {
  const now = Date.now()
  const then = new Date(isoDate).getTime()
  const diffMs = now - then
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}
