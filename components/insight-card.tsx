import type { ReactNode } from "react"
import {
  getSourceCategory,
  SOURCE_LABELS,
  SOURCE_COLORS,
  type SourceCategory,
} from "@/lib/insights/scoring"

type InsightCardProps = {
  id: string
  title: string
  summary: string
  insightType?: string
  competitorId?: string | null
  confidence: string
  severity: string
  status: string
  userFeedback?: string | null
  relevanceScore: number
  urgencyLevel: "critical" | "warning" | "info"
  suppressed: boolean
  evidence: Record<string, unknown>
  recommendations: Array<Record<string, unknown>>
  actions: ReactNode
  subjectLabel?: string
  searchParams?: Record<string, string>
}

// ---------------------------------------------------------------------------
// Urgency badge config
// ---------------------------------------------------------------------------

const URGENCY_STYLES = {
  critical: { bg: "bg-rose-100", text: "text-rose-700", ring: "ring-rose-200", label: "High Priority", barColor: "bg-rose-500" },
  warning: { bg: "bg-amber-100", text: "text-amber-700", ring: "ring-amber-200", label: "Medium", barColor: "bg-amber-500" },
  info: { bg: "bg-slate-100", text: "text-slate-500", ring: "ring-slate-200", label: "Low", barColor: "bg-emerald-500" },
} as const

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function IconCompetitors({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  )
}

function IconEvents({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
    </svg>
  )
}

function IconSeo({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605" />
    </svg>
  )
}

function IconContent({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
    </svg>
  )
}

function IconLightBulb({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
    </svg>
  )
}

function IconPhotos({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
    </svg>
  )
}

function IconTraffic({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  )
}

const SOURCE_ICONS: Record<SourceCategory, typeof IconCompetitors> = {
  competitors: IconCompetitors,
  events: IconEvents,
  seo: IconSeo,
  content: IconContent,
  photos: IconPhotos,
  traffic: IconTraffic,
}

// ---------------------------------------------------------------------------
// Metric pill extraction
// ---------------------------------------------------------------------------

function extractMetrics(evidence: Record<string, unknown>, insightType?: string): string[] {
  const pills: string[] = []

  if (typeof evidence.current_weekend_count === "number") pills.push(`${evidence.current_weekend_count} weekend events`)
  if (typeof evidence.pct_change === "number") pills.push(`${evidence.pct_change > 0 ? "+" : ""}${evidence.pct_change}%`)
  if (typeof evidence.event_count === "number") pills.push(`${evidence.event_count} events`)
  if (typeof evidence.date === "string") pills.push(evidence.date as string)
  if (typeof evidence.location_rating === "number") pills.push(`You: ${(evidence.location_rating as number).toFixed(1)}`)
  if (typeof evidence.competitor_rating === "number") pills.push(`Comp: ${(evidence.competitor_rating as number).toFixed(1)}`)
  if (typeof evidence.delta === "number" && insightType?.includes("cadence")) pills.push(`+${evidence.delta} events`)
  if (typeof evidence.field === "string" && typeof evidence.delta === "number") {
    if (evidence.field === "rating") pills.push(`${(evidence.delta as number) > 0 ? "+" : ""}${evidence.delta} rating`)
    if (evidence.field === "reviewCount") pills.push(`${(evidence.delta as number) > 0 ? "+" : ""}${evidence.delta} reviews`)
  }
  const kws = evidence.matched_keywords as string[] | undefined
  if (kws?.length) pills.push(kws.slice(0, 2).join(", "))

  return pills.slice(0, 3)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function InsightCard({
  title,
  summary,
  insightType,
  competitorId,
  confidence,
  severity,
  status,
  userFeedback,
  relevanceScore,
  urgencyLevel,
  suppressed,
  evidence,
  recommendations,
  actions,
  subjectLabel,
}: InsightCardProps) {
  const source = getSourceCategory(insightType ?? "", competitorId ?? null)
  const sourceColors = SOURCE_COLORS[source]
  const SourceIcon = SOURCE_ICONS[source]
  const urgencyStyle = URGENCY_STYLES[urgencyLevel]
  const metrics = extractMetrics(evidence, insightType)
  const isSaved = status === "read" || userFeedback === "useful"
  const isDismissed = status === "dismissed"

  return (
    <div
      className={`group relative rounded-xl border bg-white transition hover:shadow-md ${
        isDismissed
          ? "border-slate-200 opacity-50"
          : isSaved
            ? "border-emerald-200 bg-emerald-50/30"
            : suppressed
              ? "border-slate-200 opacity-60"
              : "border-slate-200"
      }`}
    >
      {/* Top bar: source badge + score + actions */}
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
        <div className="flex items-center gap-2">
          {/* Source badge */}
          <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold ${sourceColors.bg} ${sourceColors.text}`}>
            <SourceIcon className="h-3 w-3" />
            {SOURCE_LABELS[source]}
          </span>

          {/* Subject label */}
          {subjectLabel && (
            <span className="text-[11px] text-slate-400">{subjectLabel}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Relevance score with label */}
          <span
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] font-bold ring-1 ${urgencyStyle.bg} ${urgencyStyle.text} ${urgencyStyle.ring}`}
            title={`Relevance score: ${relevanceScore}/100 — based on ${severity} severity, ${confidence} confidence, and your feedback history`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${urgencyStyle.barColor}`} />
            {urgencyStyle.label}
            <span className="opacity-60">{relevanceScore}</span>
          </span>

          {/* Feedback actions */}
          <div className="flex items-center gap-0.5">
            {actions}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        <h3 className="text-sm font-semibold leading-snug text-slate-900">
          {title}
        </h3>

        <p className="mt-1 text-xs leading-relaxed text-slate-600">
          {summary}
        </p>

        {/* Metric pills */}
        {metrics.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {metrics.map((pill) => (
              <span
                key={pill}
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${sourceColors.bg} ${sourceColors.text}`}
              >
                {pill}
              </span>
            ))}
          </div>
        )}

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {recommendations.slice(0, 2).map((rec, i) => {
              const recTitle = String((rec as Record<string, unknown>)?.title ?? "")
              const recRationale = String((rec as Record<string, unknown>)?.rationale ?? "")
              if (!recTitle) return null
              return (
                <div key={i} className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2">
                  <IconLightBulb className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-slate-800">{recTitle}</p>
                    {recRationale && (
                      <p className="mt-0.5 text-[10px] leading-snug text-slate-500">{recRationale}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Suppressed notice */}
        {suppressed && (
          <p className="mt-2 text-[10px] italic text-slate-400">
            Less relevant based on your feedback
          </p>
        )}

        {/* Saved indicator */}
        {isSaved && !isDismissed && (
          <div className="mt-2 flex items-center gap-1 text-[10px] font-medium text-emerald-600">
            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
            </svg>
            Saved as useful
          </div>
        )}

        {/* Expandable evidence */}
        <details className="mt-3 group/details">
          <summary className="flex cursor-pointer items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-slate-600">
            <svg className="h-3 w-3 transition-transform group-open/details:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
            Details
          </summary>
          <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2 text-[11px] text-slate-500">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span>Confidence: <strong className="text-slate-700">{confidence}</strong></span>
              <span>Severity: <strong className="text-slate-700">{severity}</strong></span>
              {insightType && <span>Type: <strong className="text-slate-700">{insightType}</strong></span>}
            </div>
            {renderStructuredEvidence(evidence)}
          </div>
        </details>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Structured evidence
// ---------------------------------------------------------------------------

function renderStructuredEvidence(evidence: Record<string, unknown>) {
  const rows: Array<{ label: string; value: string }> = []

  if (evidence.location_name) rows.push({ label: "Location", value: String(evidence.location_name) })
  if (evidence.competitor_name) rows.push({ label: "Competitor", value: String(evidence.competitor_name) })
  if (typeof evidence.location_rating === "number") rows.push({ label: "Your rating", value: `${(evidence.location_rating as number).toFixed(1)}` })
  if (typeof evidence.competitor_rating === "number") rows.push({ label: "Competitor rating", value: `${(evidence.competitor_rating as number).toFixed(1)}` })
  if (typeof evidence.current_weekend_count === "number") rows.push({ label: "Weekend events", value: String(evidence.current_weekend_count) })
  if (typeof evidence.event_count === "number") rows.push({ label: "Events on day", value: String(evidence.event_count) })
  if (typeof evidence.date === "string") rows.push({ label: "Date", value: String(evidence.date) })

  const eventList = (evidence.sample_events ?? evidence.matched_events) as Array<Record<string, unknown>> | undefined

  if (!rows.length && !eventList?.length) return null

  return (
    <div className="mt-2 space-y-2">
      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {rows.map((r) => (
            <div key={r.label}>
              <span className="text-slate-400">{r.label}:</span>{" "}
              <span className="font-medium text-slate-700">{r.value}</span>
            </div>
          ))}
        </div>
      )}
      {eventList && eventList.length > 0 && (
        <div className="space-y-1">
          <p className="font-medium text-slate-600">Related events:</p>
          {eventList.slice(0, 3).map((ev, i) => (
            <div key={i} className="flex items-center gap-2 text-slate-500">
              <span className="h-1 w-1 shrink-0 rounded-full bg-slate-300" />
              <span className="font-medium text-slate-600">{String(ev.title ?? ev.event_title ?? "Event")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
