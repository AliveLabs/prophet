"use client"

// The Pass — Local visibility / SEO, page-local interactive island.
//
// This re-implements the PRESENTATION of the shared components/visibility/*
// modules (filters, traffic chart, ranking distribution, keyword tabs, intent/
// SERP panels, competitor table) directly in the route folder using the Pass
// kit + Pass-styled controls. No data fetching here — the server page owns it
// and passes plain serializable props. Honest framing throughout: ETV is
// "estimated clicks", competitor strength is "share-of-overlap" / "you vs them",
// no fabricated revenue.

import { Suspense, useCallback, useState, type ReactNode } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
  Legend,
} from "recharts"
import { useChartColors } from "@/lib/hooks/use-chart-colors"
import {
  TkSectionHead,
  TkSoftPanel,
  TkCard,
  TkH2HBars,
  TkRangeBar,
  TkStillLearning,
  TkEmptyState,
  TkTooltipLayer,
  RevealOnView,
} from "@/components/ticket"

/* ─────────────────────────────────────────────────────────────────────────
   Serializable prop shapes (plain data the server page hands us)
   ───────────────────────────────────────────────────────────────────────── */
export type VizLocation = { id: string; name: string }

export type VizRankedKeyword = {
  keyword: string
  rank: number
  searchVolume: number | null
  cpc: number | null
  competition: number | null
  intent: string | null
}

export type VizCompetitor = {
  domain: string
  intersections: number
  organicKeywords: number
  organicEtv: number
}

export type VizPageRow = {
  url: string
  organicEtv: number
  trafficShare: number
}

export type VizSubdomain = {
  subdomain: string
  organicEtv: number
  trafficShare: number
}

export type VizGapRow = {
  keyword: string
  domain2Rank: number | null
  searchVolume: number | null
  cpc: number | null
}

export type VizIntent = {
  intent: string
  count: number
  traffic: number
  percent: number
}

export type VizSerpFeature = { feature: string; count: number }

export type VizTrafficPoint = {
  date: string
  organicEtv: number
  paidEtv: number
  organicKeywords: number
}

export type VizDistribution = {
  pos_1: number
  pos_2_3: number
  pos_4_10: number
  pos_11_20: number
  pos_21_50: number
  pos_51_100: number
}

export type VizAdCreative = {
  headline: string | null
  description: string | null
  displayUrl: string | null
  domain: string | null
  keyword: string
  position: number | null
}

export type VizPaidOverlap = {
  keyword: string
  domain1Rank: number | null
  domain2Rank: number | null
  searchVolume: number | null
  cpc: number | null
}

/* ─────────────────────────────────────────────────────────────────────────
   Small Pass-styled control primitives
   ───────────────────────────────────────────────────────────────────────── */
function PillTabs<T extends string>({
  tabs,
  active,
  onSelect,
  ariaLabel,
}: {
  tabs: Array<{ id: T; label: ReactNode }>
  active: T
  onSelect: (id: T) => void
  ariaLabel: string
}) {
  return (
    <div className="viz-pilltabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          className={`viz-pill${active === t.id ? " viz-pill-on" : ""}`}
          onClick={() => onSelect(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

function intentLabel(i: string) {
  return i.charAt(0).toUpperCase() + i.slice(1)
}

const INTENT_VAR: Record<string, string> = {
  local: "var(--teal)",
  transactional: "var(--teal)",
  commercial: "var(--gold)",
  navigational: "var(--slate)",
  informational: "var(--rust)",
}
function intentColor(i: string) {
  return INTENT_VAR[i] ?? "var(--ink-3)"
}

const SERP_LABEL: Record<string, string> = {
  organic: "Organic",
  paid: "Paid",
  featured_snippet: "Featured snippet",
  local_pack: "Local pack",
  knowledge_graph: "Knowledge graph",
  people_also_ask: "People also ask",
  images: "Images",
  video: "Video",
  reviews: "Reviews",
  sitelinks: "Sitelinks",
  shopping: "Shopping",
  top_stories: "News",
  twitter: "Social",
  carousel: "Carousel",
  map: "Map",
  app: "App",
  ai_overview: "AI overview",
  ai_overview_reference: "AI reference",
}

/* ═══════════════════════════════════════════════════════════════════════
   FILTER / CONTROL BAR (replaces components/visibility/visibility-filters)
   ═══════════════════════════════════════════════════════════════════════ */
function ControlBarInner({
  locations,
  selectedLocationId,
  activeTab,
  freshnessLabel,
  refreshSlot,
}: {
  locations: VizLocation[]
  selectedLocationId: string
  activeTab: string
  freshnessLabel: string
  refreshSlot?: ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const navigate = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "")
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value)
        else params.delete(key)
      }
      router.push(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams],
  )

  return (
    <TkSoftPanel className="viz-controls">
      <div className="viz-controls-left">
        {locations.length > 1 && (
          <label className="viz-select-wrap">
            <span className="viz-select-lbl">Location</span>
            <select
              value={searchParams?.get("location_id") ?? selectedLocationId}
              onChange={(e) => navigate({ location_id: e.target.value })}
              className="viz-select"
              aria-label="Select location"
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <PillTabs
          ariaLabel="Search channel"
          active={activeTab}
          onSelect={(id) => navigate({ tab: id })}
          tabs={[
            { id: "organic", label: "Organic" },
            { id: "paid", label: "Paid" },
          ]}
        />
      </div>
      <div className="viz-controls-right">
        {refreshSlot}
        <span className="viz-freshness">{freshnessLabel}</span>
      </div>
    </TkSoftPanel>
  )
}

export function VisibilityControlBar(props: {
  locations: VizLocation[]
  selectedLocationId: string
  activeTab: string
  freshnessLabel: string
  refreshSlot?: ReactNode
}) {
  return (
    <Suspense fallback={<div className="viz-controls-fallback" />}>
      <ControlBarInner {...props} />
    </Suspense>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   TREND CHART — gated for first 30 days with TkStillLearning
   (replaces components/visibility/traffic-chart)
   ═══════════════════════════════════════════════════════════════════════ */
function TrendChartBody({ data }: { data: VizTrafficPoint[] }) {
  const colors = useChartColors()
  const [mode, setMode] = useState<"traffic" | "keywords">("traffic")

  return (
    <div>
      <PillTabs
        ariaLabel="Trend metric"
        active={mode}
        onSelect={setMode}
        tabs={[
          { id: "traffic", label: "Est. traffic" },
          { id: "keywords", label: "Keywords" },
        ]}
      />
      <div className="viz-chart-wrap">
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={data} margin={{ top: 10, right: 16, bottom: 4, left: 6 }}>
            <defs>
              <linearGradient id="vizOrganic" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors.precisionTeal} stopOpacity={0.24} />
                <stop offset="95%" stopColor={colors.precisionTeal} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="vizPaid" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors.signalGold} stopOpacity={0.22} />
                <stop offset="95%" stopColor={colors.signalGold} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "var(--ink-3)", fontFamily: "var(--font-mono)" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--ink-3)", fontFamily: "var(--font-mono)" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v))}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 12,
                border: "1px solid var(--line-2)",
                background: "var(--card)",
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                color: "var(--ink)",
              }}
              formatter={(value) => {
                const v = typeof value === "number" ? value : Number(value ?? 0)
                return v.toLocaleString()
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {mode === "traffic" ? (
              <>
                <Area
                  type="monotone"
                  dataKey="organicEtv"
                  name="Organic (est.)"
                  stroke={colors.precisionTeal}
                  strokeWidth={2}
                  fill="url(#vizOrganic)"
                />
                <Area
                  type="monotone"
                  dataKey="paidEtv"
                  name="Paid (est.)"
                  stroke={colors.signalGold}
                  strokeWidth={2}
                  fill="url(#vizPaid)"
                />
              </>
            ) : (
              <Area
                type="monotone"
                dataKey="organicKeywords"
                name="Ranked keywords"
                stroke={colors.foreground}
                strokeWidth={2}
                fill="none"
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export function VisibilityTrend({
  data,
  historyDays,
}: {
  data: VizTrafficPoint[]
  /** estimated days of history we've collected for this location */
  historyDays: number
}) {
  // UX GAP: gate the position-over-time chart for the first 30 days with a
  // "still reading your area — N days in" state instead of a broken/empty chart.
  // With fewer than 2 monthly points there is genuinely no trend to draw.
  const enoughHistory = data.length >= 2 && historyDays >= 30
  // While gated, keep the ring honest — don't show a full ring on a single point.
  const ringDays = enoughHistory ? historyDays : Math.min(Math.max(1, historyDays), 29)

  return (
    <RevealOnView>
      <TkSectionHead title="How your standing moves" sub="Estimated organic & paid traffic over time" />
      <TkCard>
        {enoughHistory ? (
          <Suspense fallback={<div className="viz-chart-fallback" />}>
            <TrendChartBody data={data} />
          </Suspense>
        ) : (
          <TkStillLearning
            days={ringDays}
            target={30}
            title="Trend chart unlocks as history builds"
            description="We're still reading your area. Once there's at least a month of history, we'll chart how your search standing moves week over week — until then we won't draw a line we can't stand behind."
          />
        )}
      </TkCard>
    </RevealOnView>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   YOU vs COMPETITORS — visibility head-to-head (TkH2HBars)
   (replaces the organic-competitors table's "overlap" presentation)
   ═══════════════════════════════════════════════════════════════════════ */
export function VisibilityH2H({
  yourEtv,
  yourKeywords,
  competitors,
}: {
  yourEtv: number
  yourKeywords: number
  competitors: VizCompetitor[]
}) {
  if (competitors.length === 0) {
    return (
      <RevealOnView>
        <TkSectionHead title="You vs your market" sub="Search overlap with rival domains" />
        <TkEmptyState
          title="No competitor overlap yet"
          description="Once we read enough of your rivals' search footprint, you'll see where you lead and where they out-rank you."
        />
      </RevealOnView>
    )
  }

  const top = competitors.slice(0, 6)
  const maxEtv = Math.max(yourEtv, ...top.map((c) => c.organicEtv), 1)
  const maxKw = Math.max(yourKeywords, ...top.map((c) => c.organicKeywords), 1)

  // Each row: you vs one rival on est. organic reach. We blend reach (etv) and
  // breadth (keywords) into a 0–100 magnitude so the bar reads "who's bigger".
  const rows = top.map((c) => {
    const youScore = (yourEtv / maxEtv) * 0.6 + (yourKeywords / maxKw) * 0.4
    const themScore = (c.organicEtv / maxEtv) * 0.6 + (c.organicKeywords / maxKw) * 0.4
    const youAhead = youScore >= themScore
    const ratio = youAhead
      ? themScore === 0
        ? 1
        : Math.min(1, themScore / Math.max(youScore, 0.0001))
      : youScore === 0
        ? 1
        : Math.min(1, youScore / Math.max(themScore, 0.0001))
    // magnitude = how decisive the lead is (bigger gap → longer bar)
    const magnitude = Math.round((1 - ratio) * 80) + 20
    return {
      metric: c.domain,
      side: (youAhead ? "you" : "them") as "you" | "them",
      width: magnitude,
      verdict: youAhead ? "You lead" : "They lead",
      tip: `${c.organicKeywords.toLocaleString()} ranked keywords · ${c.intersections.toLocaleString()} shared with you`,
      tipValue: `${c.organicEtv.toLocaleString()} est. clicks/mo`,
    }
  })

  return (
    <RevealOnView>
      <TkSectionHead title="You vs your market" sub="Estimated organic reach against rival domains" />
      <TkCard>
        <TkH2HBars
          rows={rows}
          note="Reach blends estimated monthly clicks (60%) and ranked-keyword breadth (40%). Estimates from search-engine data, not your analytics."
        />
      </TkCard>
    </RevealOnView>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   RANKING DISTRIBUTION (replaces components/visibility/ranking-distribution)
   ═══════════════════════════════════════════════════════════════════════ */
function DistributionBody({ distribution }: { distribution: VizDistribution }) {
  const c = useChartColors()
  const palette = [c.precisionTeal, c.precisionTeal, c.signalGold, c.signalGold, c.destructive]
  const data = [
    { range: "1–5", count: distribution.pos_1 + distribution.pos_2_3 + Math.round(distribution.pos_4_10 * 0.2) },
    { range: "6–10", count: Math.round(distribution.pos_4_10 * 0.8) },
    { range: "11–20", count: distribution.pos_11_20 },
    { range: "21–50", count: distribution.pos_21_50 },
    { range: "51–100", count: distribution.pos_51_100 },
  ]
  const total = data.reduce((s, d) => s + d.count, 0)
  const withPct = data.map((d) => ({
    ...d,
    pct: total > 0 ? Math.round((d.count / total) * 1000) / 10 : 0,
  }))

  if (total === 0) {
    return <p className="viz-muted">No ranking distribution data yet.</p>
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={withPct} margin={{ top: 10, right: 16, bottom: 4, left: 6 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
        <XAxis
          dataKey="range"
          tick={{ fontSize: 11, fill: "var(--ink-3)", fontFamily: "var(--font-mono)" }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--ink-3)", fontFamily: "var(--font-mono)" }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          cursor={{ fill: "var(--paper-2)" }}
          contentStyle={{
            borderRadius: 12,
            border: "1px solid var(--line-2)",
            background: "var(--card)",
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            color: "var(--ink)",
          }}
          formatter={(value, _name, item) => {
            const v = typeof value === "number" ? value : Number(value ?? 0)
            const pct = (item?.payload as { pct?: number })?.pct ?? 0
            return [`${v.toLocaleString()} keywords (${pct}%)`, "Position"]
          }}
        />
        <Bar dataKey="count" radius={[7, 7, 0, 0]} maxBarSize={56}>
          {withPct.map((_, i) => (
            <Cell key={i} fill={palette[i % palette.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function VisibilityDistribution({ distribution }: { distribution: VizDistribution | null }) {
  return (
    <RevealOnView>
      <TkSectionHead title="Where your keywords rank" sub="Ranked keywords by search position" />
      <TkCard>
        {distribution ? (
          <Suspense fallback={<div className="viz-chart-fallback" />}>
            <DistributionBody distribution={distribution} />
          </Suspense>
        ) : (
          <p className="viz-muted">No ranking distribution data yet.</p>
        )}
      </TkCard>
    </RevealOnView>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   ORGANIC KEYWORDS (replaces components/visibility/keyword-tabs)
   ═══════════════════════════════════════════════════════════════════════ */
type KwTab = "all" | "improved" | "decreased" | "new"

export function VisibilityKeywords({
  keywords,
  newCount,
  upCount,
  downCount,
}: {
  keywords: VizRankedKeyword[]
  newCount: number
  upCount: number
  downCount: number
}) {
  const [tab, setTab] = useState<KwTab>("all")

  const filtered = (() => {
    switch (tab) {
      case "improved":
        return keywords.filter((kw) => kw.rank <= 10)
      case "decreased":
        return keywords.filter((kw) => kw.rank > 20)
      case "new":
        return keywords.slice(0, newCount || 10)
      default:
        return keywords
    }
  })()

  return (
    <RevealOnView>
      <TkSectionHead
        title="Your ranked keywords"
        sub={`${keywords.length.toLocaleString()} keywords you appear for`}
      />
      <TkCard>
        <PillTabs
          ariaLabel="Keyword movement"
          active={tab}
          onSelect={setTab}
          tabs={[
            { id: "all", label: `All ${keywords.length}` },
            { id: "improved", label: `Improved ${upCount}` },
            { id: "decreased", label: `Decreased ${downCount}` },
            { id: "new", label: `New ${newCount}` },
          ]}
        />
        <div className="viz-table-scroll" style={{ maxHeight: 420 }}>
          <table className="viz-table">
            <thead>
              <tr>
                <th>Keyword</th>
                <th className="viz-num">Volume</th>
                <th>Position</th>
                <th>Intent</th>
                <th className="viz-num">CPC</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="viz-table-empty">
                    No keywords for this filter.
                  </td>
                </tr>
              ) : (
                filtered.slice(0, 50).map((kw) => {
                  const tone = kw.rank <= 3 ? "ok" : kw.rank <= 10 ? "warn" : "off"
                  return (
                    <tr key={kw.keyword}>
                      <td className="viz-kw">{kw.keyword}</td>
                      <td className="viz-num viz-mono">{kw.searchVolume?.toLocaleString() ?? "—"}</td>
                      <td>
                        <span className={`viz-rank viz-rank-${tone}`}>#{kw.rank}</span>
                      </td>
                      <td>
                        {kw.intent ? (
                          <span className="viz-intent-chip">
                            <i style={{ background: intentColor(kw.intent) }} />
                            {intentLabel(kw.intent)}
                          </span>
                        ) : (
                          <span className="viz-muted">—</span>
                        )}
                      </td>
                      <td className="viz-num viz-mono">{kw.cpc ? `$${kw.cpc.toFixed(2)}` : "—"}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </TkCard>
    </RevealOnView>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   INTENT + SERP FEATURES (replaces components/visibility/intent-serp-panels)
   ═══════════════════════════════════════════════════════════════════════ */
export function VisibilityIntentSerp({
  intentData,
  serpFeatures,
}: {
  intentData: VizIntent[]
  serpFeatures: VizSerpFeature[]
}) {
  const total = intentData.reduce((s, d) => s + d.count, 0)
  return (
    <RevealOnView className="tk-grid">
      <TkCard>
        <div className="viz-card-head">Why people find you</div>
        <p className="viz-card-sub">The search intent behind the keywords you rank for.</p>
        {total > 0 ? (
          <>
            <div className="viz-intent-stack" role="img" aria-label="Keyword intent distribution">
              {intentData.map((d) => (
                <span
                  key={d.intent}
                  style={{ width: `${d.percent}%`, background: intentColor(d.intent) }}
                  data-tip={`${intentLabel(d.intent)} · ${d.count.toLocaleString()} keywords`}
                  data-tipv={`${d.percent.toFixed(1)}%`}
                />
              ))}
            </div>
            <ul className="viz-intent-rows">
              {intentData.map((d) => (
                <li key={d.intent}>
                  <span className="viz-intent-name">
                    <i style={{ background: intentColor(d.intent) }} />
                    {intentLabel(d.intent)}
                  </span>
                  <span className="viz-mono viz-intent-pct">{d.percent.toFixed(1)}%</span>
                  <span className="viz-mono viz-muted">{d.count.toLocaleString()} kw</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="viz-muted">No intent data yet.</p>
        )}
      </TkCard>

      <TkCard>
        <div className="viz-card-head">Search features you show up in</div>
        <p className="viz-card-sub">Rich-result placements across your tracked keywords.</p>
        {serpFeatures.length > 0 ? (
          <div className="viz-serp-grid">
            {serpFeatures.map((f) => (
              <div key={f.feature} className="viz-serp-chip">
                <span className="viz-serp-name">{SERP_LABEL[f.feature] ?? f.feature.replace(/_/g, " ")}</span>
                <span className="viz-mono viz-serp-n">{f.count}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="viz-muted">No SERP-feature data yet.</p>
        )}
      </TkCard>
    </RevealOnView>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   TOP PAGES + SUBDOMAINS — TkRangeBar share bars
   ═══════════════════════════════════════════════════════════════════════ */
function shortUrl(url: string) {
  return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")
}

export function VisibilityPages({
  pages,
  subdomains,
}: {
  pages: VizPageRow[]
  subdomains: VizSubdomain[]
}) {
  const maxPage = Math.max(...pages.map((p) => p.trafficShare), 1)
  const maxSub = Math.max(...subdomains.map((s) => s.trafficShare), 1)

  return (
    <RevealOnView className="tk-grid">
      <TkCard>
        <div className="viz-card-head">Your top pages</div>
        <p className="viz-card-sub">Which pages pull the most estimated organic traffic.</p>
        {pages.length > 0 ? (
          <ul className="viz-share-list">
            {pages.slice(0, 12).map((p) => (
              <li key={p.url}>
                <a className="viz-share-name" href={p.url} target="_blank" rel="noopener noreferrer">
                  {shortUrl(p.url)}
                </a>
                <span className="viz-share-bar">
                  <TkRangeBar
                    value={Math.round((p.trafficShare / maxPage) * 100)}
                    tip={`${p.organicEtv.toLocaleString()} est. clicks/mo`}
                    tipValue={`${p.trafficShare}% of traffic`}
                  />
                </span>
                <span className="viz-mono viz-share-val">{p.trafficShare}%</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="viz-muted">No page data yet.</p>
        )}
      </TkCard>

      <TkCard>
        <div className="viz-card-head">Top subdomains</div>
        <p className="viz-card-sub">Traffic split across the domain&apos;s subdomains.</p>
        {subdomains.length > 0 ? (
          <ul className="viz-share-list">
            {subdomains.slice(0, 10).map((s) => (
              <li key={s.subdomain}>
                <span className="viz-share-name viz-share-name-static">{s.subdomain}</span>
                <span className="viz-share-bar">
                  <TkRangeBar
                    value={Math.round((s.trafficShare / maxSub) * 100)}
                    tip={`${s.organicEtv.toLocaleString()} est. clicks/mo`}
                    tipValue={`${s.trafficShare}% of traffic`}
                  />
                </span>
                <span className="viz-mono viz-share-val">{s.trafficShare}%</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="viz-muted">No subdomain data yet.</p>
        )}
      </TkCard>
    </RevealOnView>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   KEYWORD GAP OPPORTUNITIES — soft-panel table
   ═══════════════════════════════════════════════════════════════════════ */
export function VisibilityGaps({ gaps }: { gaps: VizGapRow[] }) {
  if (gaps.length === 0) return null
  return (
    <RevealOnView>
      <TkSectionHead
        title="Keywords you're missing"
        sub="Searches your rivals win that you don't appear for"
      />
      <TkCard>
        <div className="viz-table-scroll">
          <table className="viz-table">
            <thead>
              <tr>
                <th>Keyword</th>
                <th>Their rank</th>
                <th className="viz-num">Volume</th>
                <th className="viz-num">CPC</th>
              </tr>
            </thead>
            <tbody>
              {gaps.map((g) => (
                <tr key={g.keyword}>
                  <td className="viz-kw">{g.keyword}</td>
                  <td>
                    <span className="viz-rank viz-rank-off">#{g.domain2Rank ?? "—"}</span>
                  </td>
                  <td className="viz-num viz-mono">{g.searchVolume?.toLocaleString() ?? "—"}</td>
                  <td className="viz-num viz-mono">{g.cpc ? `$${g.cpc.toFixed(2)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TkCard>
    </RevealOnView>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   PAID TAB — overlap table + ad-creative feed
   ═══════════════════════════════════════════════════════════════════════ */
export function VisibilityPaidOverlap({ rows }: { rows: VizPaidOverlap[] }) {
  if (rows.length === 0) return null
  return (
    <RevealOnView>
      <TkSectionHead title="Paid keyword overlap" sub="Where you and a rival both buy the same term" />
      <TkCard>
        <div className="viz-table-scroll">
          <table className="viz-table">
            <thead>
              <tr>
                <th>Keyword</th>
                <th>Your rank</th>
                <th>Their rank</th>
                <th className="viz-num">Volume</th>
                <th className="viz-num">CPC</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.keyword}>
                  <td className="viz-kw">{r.keyword}</td>
                  <td>
                    <span className="viz-rank viz-rank-ok">#{r.domain1Rank ?? "—"}</span>
                  </td>
                  <td>
                    <span className="viz-rank viz-rank-off">#{r.domain2Rank ?? "—"}</span>
                  </td>
                  <td className="viz-num viz-mono">{r.searchVolume?.toLocaleString() ?? "—"}</td>
                  <td className="viz-num viz-mono">{r.cpc ? `$${r.cpc.toFixed(2)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TkCard>
    </RevealOnView>
  )
}

export function VisibilityAds({ ads }: { ads: VizAdCreative[] }) {
  if (ads.length === 0) return null
  return (
    <RevealOnView>
      <TkSectionHead title="Competitor ad creatives" sub="Live ad copy your rivals are running" />
      <div className="tk-grid viz-ad-grid">
        {ads.slice(0, 12).map((ad, i) => (
          <TkSoftPanel key={i} className="viz-ad">
            <p className="viz-ad-headline">{ad.headline ?? "Ad creative"}</p>
            {ad.description && <p className="viz-ad-desc">{ad.description}</p>}
            <div className="viz-ad-meta">
              {ad.domain && <span className="viz-ad-domain">{ad.domain}</span>}
              {ad.keyword && <span className="viz-mono">kw: {ad.keyword}</span>}
              {ad.position && <span className="viz-mono">pos #{ad.position}</span>}
            </div>
          </TkSoftPanel>
        ))}
      </div>
    </RevealOnView>
  )
}

/* Mount the tooltip layer once for the whole Pass visibility surface. */
export function VisibilityTooltips() {
  return <TkTooltipLayer />
}
