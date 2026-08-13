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

type SkillHealthRow = { skillId?: string; status?: string; usedFallback?: boolean; reused?: boolean; reason?: string; elapsedMs?: number; skipped?: boolean }
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
// Non-brief AI spend (beta rescue 2.3): a separate, shorter window from the brief trend above.
// This is a "is anything non-brief spending real money" glance, not a day-by-day trend.
const NON_BRIEF_SPEND_DAYS = 7
// Menu ingestion reliability (beta rescue 2.6, ALT-363): same 7d glance posture.
const MENU_RELIABILITY_DAYS = 7

export default async function PipelineHealthPage() {
  await connection()
  await requirePlatformAdmin()

  const supabase = createAdminSupabaseClient()
  const [verdict, { locations, trend }, nonBriefSpend, menuReliability] = await Promise.all([
    detectPipelineHealth(supabase),
    loadFleetDetail(supabase),
    loadNonBriefSpend(supabase),
    loadMenuReliability(supabase),
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
              // A first-brief readiness skip made no model call, so it is neither a real
              // generation nor a reuse nor a degradation — it is not a slot at all.
              const real = loc.skills.filter((s) => s.status === "ok" && !s.usedFallback && !s.reused && !s.skipped).length
              const reused = loc.skills.filter((s) => s.reused).length
              const fallback = loc.skills.filter((s) => !s.skipped && (s.usedFallback || s.status === "failed"))
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

      <h2 className="ph-h2">Non-brief AI spend ({NON_BRIEF_SPEND_DAYS}d)</h2>
      <p className="ph-sub">
        Every model call OUTSIDE the brief pipeline (Priority Briefing, Ask, quick-tip, the
        nightly judge, weekly knowledge ingestion, on-demand insight generation, the insights
        pipeline&rsquo;s own Gemini calls). Estimates only, not billing truth. Absent here means
        not yet applied in this environment, not zero spend.
      </p>
      <div className="ph-table-wrap">
        <table className="ph-table">
          <thead>
            <tr>
              <th>Surface</th>
              <th>Calls</th>
              <th>Est. cost</th>
            </tr>
          </thead>
          <tbody>
            {nonBriefSpend === null && (
              <tr><td colSpan={3} className="ph-empty">ai_spend_events not available yet in this environment.</td></tr>
            )}
            {nonBriefSpend !== null && nonBriefSpend.bySurface.length === 0 && (
              <tr><td colSpan={3} className="ph-empty">No non-brief AI calls recorded in the last {NON_BRIEF_SPEND_DAYS} days.</td></tr>
            )}
            {nonBriefSpend?.bySurface.map((row) => (
              <tr key={row.surface}>
                <td className="is-strong">{row.surface}</td>
                <td>{row.calls}</td>
                <td>{usd(row.usd)}</td>
              </tr>
            ))}
            {nonBriefSpend !== null && nonBriefSpend.bySurface.length > 0 && (
              <tr>
                <td className="is-strong">Total</td>
                <td>{nonBriefSpend.bySurface.reduce((s, r) => s + r.calls, 0)}</td>
                <td className="is-strong">{usd(nonBriefSpend.totalUsd)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="ph-h2">Menu ingestion reliability ({MENU_RELIABILITY_DAYS}d)</h2>
      <p className="ph-sub">
        One row per menu-ingestion attempt (own location or competitor), including the runs
        that produced nothing and therefore left no snapshot. &ldquo;Empty&rdquo; means the
        sources answered with no menu; &ldquo;Failed&rdquo; means no trustworthy answer at
        all. Observation only: recording never alters pipeline behaviour. Absent here means
        the migration is not yet applied in this environment, not a clean week.
      </p>
      <div className="ph-table-wrap">
        <table className="ph-table">
          <thead>
            <tr>
              <th>Target</th>
              <th>Attempts</th>
              <th>Succeeded</th>
              <th>Empty</th>
              <th>Failed</th>
              <th>Failure reasons</th>
            </tr>
          </thead>
          <tbody>
            {menuReliability === null && (
              <tr><td colSpan={6} className="ph-empty">menu_ingest_events not available yet in this environment.</td></tr>
            )}
            {menuReliability !== null && menuReliability.byTarget.length === 0 && (
              <tr><td colSpan={6} className="ph-empty">No menu ingestion runs recorded in the last {MENU_RELIABILITY_DAYS} days.</td></tr>
            )}
            {menuReliability?.byTarget.map((row) => (
              <tr key={row.target}>
                <td className="is-strong">{row.target}</td>
                <td>{row.attempts}</td>
                <td>{row.attempts > 0 ? `${row.succeeded} (${pct(row.succeeded / row.attempts)})` : "—"}</td>
                <td>{row.empty}</td>
                <td className={row.failed > 0 ? "is-alert" : undefined}>{row.failed}</td>
                <td className="ph-offenders">
                  {row.reasons.length === 0 ? "—" : row.reasons.map((r) => `${r.reason} ×${r.count}`).join(", ")}
                </td>
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
      // A first-brief readiness skip (beta rescue 3.1) made no model call, so it is not a slot.
      // Counting it would pad the denominator and drag both rates toward zero — the same reason
      // lib/ops/pipeline-health.ts excludes it from the fleet fallback rate.
      if (s?.skipped === true) continue
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

// ── non-brief AI spend (beta rescue 2.3) ────────────────────────────────────────────────────────

type SpendEventRow = { surface: string; estimated_usd: number | string | null }

/** `ai_spend_events` isn't in the generated DB types yet (its migration hasn't been applied), so
 *  this uses the same loose-client cast the rest of the app uses for a not-yet-regenerated table
 *  (see app/(dashboard)/feedback-actions.ts for the beta_feedback precedent). */
type SpendEventsReadClient = {
  from: (table: string) => {
    select: (cols: string) => {
      gte: (col: string, val: string) => Promise<{ data: SpendEventRow[] | null; error: { message: string } | null }>
    }
  }
}

export type NonBriefSpendSummary = {
  bySurface: Array<{ surface: string; usd: number; calls: number }>
  totalUsd: number
}

/** Sum estimated_usd by surface over the trailing window. Returns null (not an empty summary)
 *  when the table itself isn't queryable yet: that environment hasn't had the migration applied,
 *  which is a materially different state from "queried fine, zero rows". */
async function loadNonBriefSpend(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
): Promise<NonBriefSpendSummary | null> {
  const sinceIso = new Date(Date.now() - NON_BRIEF_SPEND_DAYS * 86_400_000).toISOString()
  const client = supabase as unknown as SpendEventsReadClient
  const { data, error } = await client.from("ai_spend_events").select("surface, estimated_usd").gte("created_at", sinceIso)
  if (error) {
    console.warn("[admin/health] ai_spend_events query failed (migration likely not applied yet):", error.message)
    return null
  }
  const bySurfaceMap = new Map<string, { usd: number; calls: number }>()
  let totalUsd = 0
  for (const row of data ?? []) {
    const rowUsd = Number(row.estimated_usd) || 0
    totalUsd += rowUsd
    const entry = bySurfaceMap.get(row.surface) ?? { usd: 0, calls: 0 }
    entry.usd += rowUsd
    entry.calls += 1
    bySurfaceMap.set(row.surface, entry)
  }
  const bySurface = [...bySurfaceMap.entries()]
    .map(([surface, v]) => ({ surface, ...v }))
    .sort((a, b) => b.usd - a.usd)
  return { bySurface, totalUsd }
}

// ── menu ingestion reliability (beta rescue 2.6, ALT-363) ──────────────────────────────────────

type MenuIngestEventRow = { target: string; outcome: string; failure_reason: string | null }

/** `menu_ingest_events` isn't in the generated DB types yet (its migration hasn't been applied),
 *  so this uses the same loose-client cast as loadNonBriefSpend above. */
type MenuEventsReadClient = {
  from: (table: string) => {
    select: (cols: string) => {
      gte: (col: string, val: string) => Promise<{ data: MenuIngestEventRow[] | null; error: { message: string } | null }>
    }
  }
}

export type MenuReliabilitySummary = {
  byTarget: Array<{
    target: string
    attempts: number
    succeeded: number
    empty: number
    failed: number
    reasons: Array<{ reason: string; count: number }>
  }>
}

/** Roll up menu ingestion outcomes by target over the trailing window. Returns null (not an
 *  empty summary) when the table itself isn't queryable yet: that environment hasn't had the
 *  migration applied, which is a materially different state from "queried fine, zero rows". */
async function loadMenuReliability(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
): Promise<MenuReliabilitySummary | null> {
  const sinceIso = new Date(Date.now() - MENU_RELIABILITY_DAYS * 86_400_000).toISOString()
  const client = supabase as unknown as MenuEventsReadClient
  const { data, error } = await client
    .from("menu_ingest_events")
    .select("target, outcome, failure_reason")
    .gte("created_at", sinceIso)
  if (error) {
    console.warn("[admin/health] menu_ingest_events query failed (migration likely not applied yet):", error.message)
    return null
  }
  type Agg = { attempts: number; succeeded: number; empty: number; failed: number; reasons: Map<string, number> }
  const byTargetMap = new Map<string, Agg>()
  for (const row of data ?? []) {
    const agg = byTargetMap.get(row.target) ?? { attempts: 0, succeeded: 0, empty: 0, failed: 0, reasons: new Map<string, number>() }
    agg.attempts += 1
    if (row.outcome === "succeeded") agg.succeeded += 1
    else if (row.outcome === "empty") agg.empty += 1
    else if (row.outcome === "failed") agg.failed += 1
    if (row.failure_reason) agg.reasons.set(row.failure_reason, (agg.reasons.get(row.failure_reason) ?? 0) + 1)
    byTargetMap.set(row.target, agg)
  }
  const byTarget = [...byTargetMap.entries()]
    .map(([target, agg]) => ({
      target,
      attempts: agg.attempts,
      succeeded: agg.succeeded,
      empty: agg.empty,
      failed: agg.failed,
      reasons: [...agg.reasons.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => a.target.localeCompare(b.target))
  return { byTarget }
}

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
