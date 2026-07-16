// TICKET ADMIN — Pipeline Health (2026-07-08, the alert-landing page that didn't exist).
//
// The Slack/email watchdog alert deep-links here. Before this page, the link landed on the
// admin overview with no wiring for pipeline health at all — a dead end at the exact moment an
// operator wants context. This renders the SAME verdict the external watchdog polls
// (detectPipelineHealth — see lib/ops/pipeline-health.ts), plus the per-location and per-day
// detail the aggregate verdict deliberately doesn't carry, so "why did this alert fire" is
// answerable in one page load: verdict -> which locations/skills -> is it a trend or a blip.
//
// Read-only. No server actions, no writes — mirrors source-quality's posture.

import { connection } from "next/server"
import type { CSSProperties } from "react"
import { requirePlatformAdmin } from "@/lib/auth/platform-admin"
import { createAdminSupabaseClient } from "@/lib/supabase/admin"
import { detectPipelineHealth, RECENT_ACTIVE_DAYS, type PipelineHealthVerdict } from "@/lib/ops/pipeline-health"
import { estimateAnthropicCostUsd, type ModelTokenTotals } from "@/lib/ai/pricing"
import { RevealOnView } from "@/components/ticket"
import "./health.css"

type SkillHealthRow = { skillId?: string; status?: string; usedFallback?: boolean; reused?: boolean; reason?: string; elapsedMs?: number }
type ProviderStatsRow = {
  requests?: number
  rateLimited?: number
  // Cost telemetry (2026-07-16). Absent on briefs built before then; totals undercount on
  // timeout-fallback days (aborted calls never surface usage client-side).
  inputTokens?: number
  outputTokens?: number
  tokensByModel?: Record<string, ModelTokenTotals>
}

type LocationDetail = {
  locationId: string
  name: string
  generatedAt: string
  skills: SkillHealthRow[]
  requests: number
  rateLimited: number
  /** Estimated Anthropic $ for the newest build (null pre-telemetry briefs). */
  estCostUsd: number | null
}

type DayTrend = {
  dateKey: string
  locationsBuilt: number
  totalSlots: number
  fallbackSlots: number
  reusedSlots: number
  requests: number
  rateLimited: number
  inputTokens: number
  outputTokens: number
  estCostUsd: number
}

const TREND_DAYS = 7

export default async function PipelineHealthPage() {
  await connection()
  await requirePlatformAdmin()

  const supabase = createAdminSupabaseClient()
  const [verdict, { locations, trend }] = await Promise.all([
    detectPipelineHealth(supabase),
    loadFleetDetail(supabase),
  ])

  return (
    <div className="ticket-chrome tk-kit ph-page">
      <RevealOnView as="header" className="ph-head">
        <div className="ph-head-text">
          <span className="tk-eyebrow">Platform · Pipeline health</span>
          <h1 className="ph-title">Pipeline Health</h1>
          <p className="ph-sub">
            The same verdict the external watchdog polls, plus enough per-location and per-day
            detail to answer &ldquo;why did that alert fire&rdquo; without a database query.
          </p>
        </div>
        <StatusPill status={verdict.status} checkedAt={verdict.checkedAt} />
      </RevealOnView>

      <RevealOnView className="ph-signals" stagger>
        <SignalTile label="Fallback rate" value={pct(verdict.fallbackSkillRate)} sub={`${verdict.briefsAssessed} location(s) assessed`} tone={toneFor(verdict.fallbackSkillRate, verdict.thresholds.fallbackRateAlert)} />
        <SignalTile label="Rate-limited" value={pct(verdict.rateLimitedRate)} sub={`${verdict.rateLimitCallsSampled} recent calls`} tone={toneFor(verdict.rateLimitedRate, verdict.thresholds.rateLimitedRateAlert)} />
        <SignalTile label="Producer p95" value={seconds(verdict.producerLatencyP95Ms)} sub={`${verdict.latencySamples} recent calls`} tone="teal" />
        <SignalTile label="Brief drain p95" value={minutes(verdict.briefDrainP95Ms)} sub={`${verdict.briefDrainsSampled} recent builds`} tone={toneFor(verdict.briefDrainP95Ms, verdict.thresholds.briefDrainAlertMs)} />
        <SignalTile label="Stale locations" value={String(verdict.staleLocations)} sub={`of ${RECENT_ACTIVE_DAYS}d-active fleet`} tone={verdict.staleLocations > 0 ? "alert" : "teal"} />
        <SignalTile label="Vendor (DataForSEO)" value={verdict.vendor.down ? "Down" : "OK"} sub={verdict.vendor.paymentRequired ? "payment required" : "—"} tone={verdict.vendor.down ? "alert" : "teal"} />
      </RevealOnView>

      {verdict.reasons.length > 0 && (
        <ReasonBlock title="Reasons (these paged Slack/email)" items={verdict.reasons} tone="alert" />
      )}
      {verdict.warnings.length > 0 && (
        <ReasonBlock
          title="Warnings (informational — did not page)"
          items={verdict.warnings}
          tone="gold"
        />
      )}
      {verdict.reasons.length === 0 && verdict.warnings.length === 0 && (
        <div className="ph-clean">Nothing to report — every signal is inside its healthy band.</div>
      )}

      <h2 className="ph-h2">Fleet — newest brief per location</h2>
      <div className="ph-table-wrap">
        <table className="ph-table">
          <thead>
            <tr>
              <th>Location</th>
              <th>Last brief</th>
              <th>Real</th>
              <th>Reused</th>
              <th>Fallback</th>
              <th>Offending skills</th>
              <th>Requests</th>
              <th>Est. cost</th>
            </tr>
          </thead>
          <tbody>
            {locations.length === 0 && (
              <tr><td colSpan={8} className="ph-empty">No briefs in the last {RECENT_ACTIVE_DAYS} days.</td></tr>
            )}
            {locations.map((loc) => {
              const real = loc.skills.filter((s) => s.status === "ok" && !s.usedFallback && !s.reused).length
              const reused = loc.skills.filter((s) => s.reused).length
              const fallback = loc.skills.filter((s) => s.usedFallback || s.status === "failed")
              return (
                <tr key={loc.locationId}>
                  <td className="is-strong">{loc.name}</td>
                  <td>{relativeTime(loc.generatedAt)}</td>
                  <td>{real}</td>
                  <td>{reused}</td>
                  <td className={fallback.length > 0 ? "is-alert" : undefined}>{fallback.length}</td>
                  <td className="ph-offenders">
                    {fallback.length === 0 ? "—" : fallback.map((s) => `${s.skillId ?? "?"} (${s.reason ?? "failed"})`).join(", ")}
                  </td>
                  <td>
                    {loc.requests}
                    {loc.rateLimited > 0 ? <span className="is-alert"> ({loc.rateLimited} limited)</span> : null}
                  </td>
                  <td>{loc.estCostUsd == null ? "—" : usd(loc.estCostUsd)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <h2 className="ph-h2">{TREND_DAYS}-day trend — is this a blip or a pattern?</h2>
      <div className="ph-table-wrap">
        <table className="ph-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Locations built</th>
              <th>Fallback rate</th>
              <th>Reused rate</th>
              <th>Requests</th>
              <th>Rate-limited</th>
              <th>Tokens in / out</th>
              <th>Est. cost</th>
            </tr>
          </thead>
          <tbody>
            {trend.length === 0 && (
              <tr><td colSpan={8} className="ph-empty">No briefs in the last {TREND_DAYS} days.</td></tr>
            )}
            {trend.map((day) => (
              <tr key={day.dateKey}>
                <td className="is-strong">{day.dateKey}</td>
                <td>{day.locationsBuilt}</td>
                <td className={day.totalSlots > 0 && day.fallbackSlots / day.totalSlots >= 0.15 ? "is-alert" : undefined}>
                  {day.totalSlots > 0 ? pct(day.fallbackSlots / day.totalSlots) : "—"}
                </td>
                <td>{day.totalSlots > 0 ? pct(day.reusedSlots / day.totalSlots) : "—"}</td>
                <td>{day.requests}</td>
                <td>{day.requests > 0 ? pct(day.rateLimited / day.requests) : "—"}</td>
                <td>{day.inputTokens > 0 || day.outputTokens > 0 ? `${tok(day.inputTokens)} / ${tok(day.outputTokens)}` : "—"}</td>
                <td>{day.estCostUsd > 0 ? usd(day.estCostUsd) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── data layer ───────────────────────────────────────────────────────────────────────────────

/** One query serves BOTH the "current fleet" table (newest brief per location) and the N-day
 *  trend (grouped by date_key) — same shape as pipeline-health.ts's own newest-per-location dedup,
 *  kept separate here because this page needs location NAMES + raw per-skill rows, not aggregates. */
async function loadFleetDetail(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
): Promise<{ locations: LocationDetail[]; trend: DayTrend[] }> {
  const sinceIso = new Date(Date.now() - Math.max(RECENT_ACTIVE_DAYS, TREND_DAYS) * 86_400_000).toISOString()
  const trendCutoffMs = Date.now() - TREND_DAYS * 86_400_000

  // jsonb-path selects (brief->skillHealth) aren't in the generated types — same posture as
  // pipeline-health.ts's fetchPipelineSignals: select loosely, cast the returned rows.
  const [briefRows, locRows] = await Promise.all([
    supabase
      .from("daily_briefs")
      .select("location_id, generated_at, date_key, brief->skillHealth, brief->providerStats")
      .gte("generated_at", sinceIso)
      .order("generated_at", { ascending: false }),
    supabase.from("locations").select("id, name"),
  ])

  const nameById = new Map((locRows.data ?? []).map((l) => [l.id, l.name ?? "Unnamed location"]))
  const rows = (briefRows.data ?? []) as unknown as RawBriefRow[]

  // Newest row per location -> the "current fleet" table.
  const seen = new Set<string>()
  const locations: LocationDetail[] = []
  for (const r of rows) {
    if (!r.location_id || seen.has(r.location_id)) continue
    seen.add(r.location_id)
    const stats = (r.providerStats ?? null) as ProviderStatsRow | null
    locations.push({
      locationId: r.location_id,
      name: nameById.get(r.location_id) ?? "Unknown location",
      generatedAt: r.generated_at,
      skills: Array.isArray(r.skillHealth) ? r.skillHealth : [],
      requests: typeof stats?.requests === "number" ? stats.requests : 0,
      rateLimited: typeof stats?.rateLimited === "number" ? stats.rateLimited : 0,
      estCostUsd: stats?.tokensByModel ? estimateAnthropicCostUsd(stats.tokensByModel) : null,
    })
  }
  locations.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))

  // ALL rows within TREND_DAYS, grouped by date_key -> the trend table (every build counts, not
  // just the newest per location — the point is daily VOLUME, not per-location freshness).
  const byDay = new Map<string, DayTrend>()
  for (const r of rows) {
    if (!r.date_key || new Date(r.generated_at).getTime() < trendCutoffMs) continue
    const day = byDay.get(r.date_key) ?? { dateKey: r.date_key, locationsBuilt: 0, totalSlots: 0, fallbackSlots: 0, reusedSlots: 0, requests: 0, rateLimited: 0, inputTokens: 0, outputTokens: 0, estCostUsd: 0 }
    day.locationsBuilt++
    const skills = Array.isArray(r.skillHealth) ? r.skillHealth : []
    for (const s of skills) {
      day.totalSlots++
      if (s?.usedFallback || s?.status === "failed") day.fallbackSlots++
      if (s?.reused) day.reusedSlots++
    }
    const stats = (r.providerStats ?? null) as ProviderStatsRow | null
    day.requests += typeof stats?.requests === "number" ? stats.requests : 0
    day.rateLimited += typeof stats?.rateLimited === "number" ? stats.rateLimited : 0
    day.inputTokens += typeof stats?.inputTokens === "number" ? stats.inputTokens : 0
    day.outputTokens += typeof stats?.outputTokens === "number" ? stats.outputTokens : 0
    if (stats?.tokensByModel) day.estCostUsd += estimateAnthropicCostUsd(stats.tokensByModel)
    byDay.set(r.date_key, day)
  }
  const trend = [...byDay.values()].sort((a, b) => b.dateKey.localeCompare(a.dateKey))

  return { locations, trend }
}

type RawBriefRow = { location_id: string | null; generated_at: string; date_key: string | null; skillHealth: unknown; providerStats: unknown }

// ── presentation helpers ────────────────────────────────────────────────────────────────────

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}
function usd(n: number): string {
  return `$${n.toFixed(2)}`
}
/** Compact token count: 1234 -> "1.2k", 2500000 -> "2.5M". */
function tok(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(n)
}
function seconds(ms: number): string {
  return `${Math.round(ms / 1000)}s`
}
function minutes(ms: number): string {
  return `${Math.round(ms / 60_000)}m`
}
function relativeTime(iso: string): string {
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000
  if (hours < 1) return `${Math.round(hours * 60)}m ago`
  if (hours < 48) return `${Math.round(hours)}h ago`
  return `${Math.round(hours / 24)}d ago`
}
function toneFor(value: number, alertThreshold: number): "teal" | "gold" | "alert" {
  if (value >= alertThreshold) return "alert"
  if (value >= alertThreshold * 0.6) return "gold"
  return "teal"
}

function StatusPill({ status, checkedAt }: { status: PipelineHealthVerdict["status"]; checkedAt: string }) {
  const label = status === "ok" ? "Healthy" : status === "degraded" ? "Degraded" : "Down"
  return (
    <div className={`ph-status ph-status-${status}`}>
      <span className="ph-status-dot" aria-hidden="true" />
      <span className="ph-status-label">{label}</span>
      <span className="ph-status-time">checked {relativeTime(checkedAt)}</span>
    </div>
  )
}

function SignalTile({ label, value, sub, tone, i = 0 }: { label: string; value: string; sub: string; tone: "teal" | "gold" | "alert"; i?: number }) {
  return (
    <div className={`ph-tile ph-tile-${tone}`} style={{ "--tk-i": i } as CSSProperties}>
      <span className="ph-tile-rail" aria-hidden="true" />
      <span className="ph-tile-lbl">{label}</span>
      <span className="ph-tile-val">{value}</span>
      <span className="ph-tile-sub">{sub}</span>
    </div>
  )
}

function ReasonBlock({ title, items, tone }: { title: string; items: string[]; tone: "alert" | "gold" }) {
  return (
    <div className={`ph-reasons ph-reasons-${tone}`}>
      <h2 className="ph-h2">{title}</h2>
      <ul>
        {items.map((r, i) => <li key={i}>{r}</li>)}
      </ul>
    </div>
  )
}
