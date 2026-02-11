import type { ReactNode } from "react"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type InsightCardProps = {
  title: string
  summary: string
  insightType?: string
  confidence: string
  severity: string
  status: string
  evidence: Record<string, unknown>
  recommendations: Array<Record<string, unknown>>
  actions: ReactNode
  /** Who this insight is about */
  subjectLabel?: string
  accent?: "location" | "competitor" | "event"
}

// ---------------------------------------------------------------------------
// Icons (inline SVG, zero deps)
// ---------------------------------------------------------------------------

function IconCalendar({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
    </svg>
  )
}

function IconUsers({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  )
}

function IconMapPin({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
    </svg>
  )
}

function IconLightBulb({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
    </svg>
  )
}

function IconChevron({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Accent config
// ---------------------------------------------------------------------------

const ACCENT = {
  event: {
    border: "border-l-violet-500",
    icon: IconCalendar,
    label: "Event",
    labelClass: "bg-violet-50 text-violet-700",
    pillClass: "bg-violet-50 text-violet-700",
    recBg: "bg-violet-50/60",
  },
  competitor: {
    border: "border-l-emerald-500",
    icon: IconUsers,
    label: "Competitor",
    labelClass: "bg-emerald-50 text-emerald-700",
    pillClass: "bg-emerald-50 text-emerald-700",
    recBg: "bg-emerald-50/60",
  },
  location: {
    border: "border-l-indigo-500",
    icon: IconMapPin,
    label: "Location",
    labelClass: "bg-indigo-50 text-indigo-700",
    pillClass: "bg-indigo-50 text-indigo-700",
    recBg: "bg-indigo-50/60",
  },
} as const

const SEVERITY_DOT: Record<string, string> = {
  info: "bg-sky-400",
  warning: "bg-amber-400",
  critical: "bg-rose-500",
}

// ---------------------------------------------------------------------------
// Metric pill extraction
// ---------------------------------------------------------------------------

function extractMetrics(evidence: Record<string, unknown>, insightType?: string): string[] {
  const pills: string[] = []

  // Event counts
  if (typeof evidence.current_weekend_count === "number") {
    pills.push(`${evidence.current_weekend_count} weekend events`)
  }
  if (typeof evidence.pct_change === "number") {
    pills.push(`+${evidence.pct_change}%`)
  }
  if (typeof evidence.event_count === "number") {
    pills.push(`${evidence.event_count} events`)
  }
  if (typeof evidence.date === "string") {
    pills.push(evidence.date)
  }

  // Ratings
  if (typeof evidence.location_rating === "number") {
    pills.push(`You: ${(evidence.location_rating as number).toFixed(1)} stars`)
  }
  if (typeof evidence.competitor_rating === "number") {
    pills.push(`Comp: ${(evidence.competitor_rating as number).toFixed(1)} stars`)
  }

  // Deltas
  if (typeof evidence.delta === "number" && insightType?.includes("cadence")) {
    pills.push(`+${evidence.delta} events`)
  }

  // Rating / review changes
  if (typeof evidence.field === "string" && typeof evidence.delta === "number") {
    if (evidence.field === "rating") {
      pills.push(`${(evidence.delta as number) > 0 ? "+" : ""}${evidence.delta} rating`)
    }
    if (evidence.field === "reviewCount") {
      pills.push(`${(evidence.delta as number) > 0 ? "+" : ""}${evidence.delta} reviews`)
    }
  }

  // Matched keywords
  const kws = evidence.matched_keywords as string[] | undefined
  if (kws?.length) {
    pills.push(kws.slice(0, 2).join(", "))
  }

  return pills.slice(0, 4) // max 4 pills
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function InsightCard({
  title,
  summary,
  insightType,
  confidence,
  severity,
  status,
  evidence,
  recommendations,
  actions,
  subjectLabel,
  accent: accentProp,
}: InsightCardProps) {
  // Derive accent from insightType if not explicitly set
  const accent: "event" | "competitor" | "location" = accentProp ??
    (insightType?.startsWith("events.") ? "event" : "competitor")

  const cfg = ACCENT[accent]
  const Icon = cfg.icon
  const severityDot = SEVERITY_DOT[severity] ?? SEVERITY_DOT.info
  const metrics = extractMetrics(evidence, insightType)

  return (
    <div className={`rounded-xl border border-slate-200 border-l-4 ${cfg.border} bg-white p-4 text-slate-900`}>
      {/* Header row: icon + title + severity dot + actions */}
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex-shrink-0 rounded-lg p-1.5 ${cfg.labelClass}`}>
          <Icon className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold leading-snug text-slate-900">
              {title}
            </h3>
            <span
              className={`h-2 w-2 flex-shrink-0 rounded-full ${severityDot}`}
              title={`${severity} severity, ${confidence} confidence`}
            />
          </div>

          {/* Subject label */}
          {subjectLabel && (
            <span className="mt-0.5 inline-block text-xs text-slate-400">
              {subjectLabel}
            </span>
          )}

          {/* Summary */}
          <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
            {summary}
          </p>

          {/* Metric pills */}
          {metrics.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {metrics.map((pill) => (
                <span
                  key={pill}
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${cfg.pillClass}`}
                >
                  {pill}
                </span>
              ))}
            </div>
          )}

          {/* Recommendations – compact action cards */}
          {recommendations.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {recommendations.slice(0, 2).map((rec, i) => {
                const recTitle = String((rec as Record<string, unknown>)?.title ?? "")
                const recRationale = String((rec as Record<string, unknown>)?.rationale ?? "")
                return (
                  <div
                    key={i}
                    className={`flex items-start gap-2 rounded-lg ${cfg.recBg} px-3 py-2`}
                  >
                    <IconLightBulb className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-500" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800">
                        {recTitle}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                        {recRationale}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Expandable details (replaces raw JSON dump) */}
          <details className="mt-3 group">
            <summary className="flex cursor-pointer items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-600">
              <IconChevron className="h-3 w-3 transition-transform group-open:rotate-180" />
              View details
            </summary>
            <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2 text-xs text-slate-500">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span>Confidence: <strong className="text-slate-700">{confidence}</strong></span>
                <span>Severity: <strong className="text-slate-700">{severity}</strong></span>
                <span>Status: <strong className="text-slate-700">{status}</strong></span>
                {insightType && (
                  <span>Type: <strong className="text-slate-700">{insightType}</strong></span>
                )}
              </div>

              {/* Structured evidence summary */}
              {renderStructuredEvidence(evidence)}
            </div>
          </details>
        </div>

        {/* Actions: small buttons in the top-right */}
        <div className="flex flex-shrink-0 items-center gap-1">
          {actions}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Structured evidence renderer (replaces raw JSON)
// ---------------------------------------------------------------------------

function renderStructuredEvidence(evidence: Record<string, unknown>) {
  const rows: Array<{ label: string; value: string }> = []

  if (evidence.location_name) rows.push({ label: "Location", value: String(evidence.location_name) })
  if (evidence.competitor_name) rows.push({ label: "Competitor", value: String(evidence.competitor_name) })
  if (typeof evidence.location_rating === "number") rows.push({ label: "Your rating", value: `${(evidence.location_rating as number).toFixed(1)} stars` })
  if (typeof evidence.competitor_rating === "number") rows.push({ label: "Competitor rating", value: `${(evidence.competitor_rating as number).toFixed(1)} stars` })
  if (typeof evidence.current_weekend_count === "number") rows.push({ label: "Weekend events (now)", value: String(evidence.current_weekend_count) })
  if (typeof evidence.previous_weekend_count === "number") rows.push({ label: "Weekend events (before)", value: String(evidence.previous_weekend_count) })
  if (typeof evidence.event_count === "number") rows.push({ label: "Events on day", value: String(evidence.event_count) })
  if (typeof evidence.date === "string") rows.push({ label: "Date", value: evidence.date })
  if (typeof evidence.current_count === "number") rows.push({ label: "Current associations", value: String(evidence.current_count) })
  if (typeof evidence.previous_count === "number") rows.push({ label: "Previous associations", value: String(evidence.previous_count) })

  // Sample events
  const samples = evidence.sample_events as Array<Record<string, unknown>> | undefined
  const matchedEvents = evidence.matched_events as Array<Record<string, unknown>> | undefined
  const eventList = samples ?? matchedEvents

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
          {eventList.slice(0, 4).map((ev, i) => {
            const evTitle = String(ev.title ?? ev.event_title ?? "Event")
            const evDate = String(ev.startDatetime ?? ev.start ?? ev.event_date ?? "")
            const evVenue = String(ev.venue_name ?? "")
            return (
              <div key={i} className="flex items-center gap-2 text-slate-500">
                <span className="h-1 w-1 flex-shrink-0 rounded-full bg-slate-300" />
                <span className="font-medium text-slate-600">{evTitle}</span>
                {evDate && <span className="text-slate-400">{evDate}</span>}
                {evVenue && <span className="text-slate-400">@ {evVenue}</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
