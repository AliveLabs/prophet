import {
  getSourceCategory,
  SOURCE_LABELS,
  SOURCE_COLORS,
  type SourceCategory,
} from "@/lib/insights/scoring"
import KebabMenu from "@/components/insights/kebab-menu"

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
  subjectLabel?: string
  searchParams?: Record<string, string>
  onStatusChange?: (insightId: string, newStatus: string) => void
}

// ---------------------------------------------------------------------------
// Urgency badge config
// ---------------------------------------------------------------------------

const URGENCY_STYLES = {
  critical: { bg: "bg-destructive/15", text: "text-destructive", ring: "ring-destructive/30", label: "High Priority", barColor: "bg-destructive" },
  warning: { bg: "bg-signal-gold/15", text: "text-signal-gold", ring: "ring-signal-gold/30", label: "Medium", barColor: "bg-signal-gold" },
  info: { bg: "bg-muted", text: "text-muted-foreground", ring: "ring-border", label: "Low", barColor: "bg-precision-teal" },
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

function IconSocial({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
    </svg>
  )
}

const SOURCE_ICONS: Record<SourceCategory, typeof IconCompetitors> = {
  competitors: IconCompetitors,
  events: IconEvents,
  seo: IconSeo,
  social: IconSocial,
  content: IconContent,
  photos: IconPhotos,
  traffic: IconTraffic,
}

const STATUS_BADGES: Record<string, { bg: string; text: string; label: string }> = {
  read: { bg: "bg-primary/15", text: "text-primary", label: "Read" },
  todo: { bg: "bg-signal-gold/15", text: "text-signal-gold", label: "To-Do" },
  actioned: { bg: "bg-precision-teal/15", text: "text-precision-teal", label: "Done" },
  snoozed: { bg: "bg-muted", text: "text-muted-foreground", label: "Snoozed" },
  dismissed: { bg: "bg-destructive/15", text: "text-destructive", label: "Dismissed" },
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
  id,
  title,
  summary,
  insightType,
  competitorId,
  confidence,
  severity,
  status,
  relevanceScore,
  urgencyLevel,
  suppressed,
  evidence,
  recommendations,
  subjectLabel,
  onStatusChange,
}: InsightCardProps) {
  const source = getSourceCategory(insightType ?? "", competitorId ?? null)
  const sourceColors = SOURCE_COLORS[source]
  const SourceIcon = SOURCE_ICONS[source]
  const urgencyStyle = URGENCY_STYLES[urgencyLevel]
  const metrics = extractMetrics(evidence, insightType)
  const isDismissed = status === "dismissed"
  const statusBadge = STATUS_BADGES[status]

  return (
    <div
      className={`group relative rounded-lg border bg-card transition hover:shadow-md ${
        isDismissed
          ? "border-border opacity-50"
          : status === "actioned"
            ? "border-precision-teal/30 bg-precision-teal/5"
            : status === "todo"
              ? "border-signal-gold/30 bg-signal-gold/5"
              : suppressed
                ? "border-border opacity-60"
                : "border-border"
      }`}
    >
      {/* Top bar: source badge + status + score + kebab */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold ${sourceColors.bg} ${sourceColors.text}`}>
            <SourceIcon className="h-3 w-3" />
            {SOURCE_LABELS[source]}
          </span>

          {subjectLabel && (
            <span className="text-[11px] text-muted-foreground">{subjectLabel}</span>
          )}

          {statusBadge && status !== "new" && (
            <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${statusBadge.bg} ${statusBadge.text}`}>
              {statusBadge.label}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] font-bold ring-1 ${urgencyStyle.bg} ${urgencyStyle.text} ${urgencyStyle.ring}`}
            title={`Relevance score: ${relevanceScore}/100 — based on ${severity} severity, ${confidence} confidence, and your feedback history`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${urgencyStyle.barColor}`} />
            {urgencyStyle.label}
            <span className="opacity-60">{relevanceScore}</span>
          </span>

          <KebabMenu insightId={id} currentStatus={status} onStatusChange={onStatusChange} />
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        <h3 className="text-sm font-semibold leading-snug text-foreground">
          {title}
        </h3>

        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {summary}
        </p>

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

        {recommendations.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {recommendations.slice(0, 2).map((rec, i) => {
              const recTitle = String((rec as Record<string, unknown>)?.title ?? "")
              const recRationale = String((rec as Record<string, unknown>)?.rationale ?? "")
              if (!recTitle) return null
              return (
                <div key={i} className="flex items-start gap-2 rounded-lg bg-secondary px-3 py-2">
                  <IconLightBulb className="mt-0.5 h-3 w-3 shrink-0 text-signal-gold" />
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-foreground">{recTitle}</p>
                    {recRationale && (
                      <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{recRationale}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {suppressed && (
          <p className="mt-2 text-[10px] italic text-muted-foreground">
            Less relevant based on your feedback
          </p>
        )}

        <details className="mt-3 group/details">
          <summary className="flex cursor-pointer items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground">
            <svg className="h-3 w-3 transition-transform group-open/details:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
            Details
          </summary>
          <div className="mt-2 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-[11px] text-muted-foreground">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span>Confidence: <strong className="text-foreground">{confidence}</strong></span>
              <span>Severity: <strong className="text-foreground">{severity}</strong></span>
              {insightType && <span>Type: <strong className="text-foreground">{insightType}</strong></span>}
            </div>
            {renderStructuredEvidence(evidence, insightType)}
          </div>
        </details>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Structured evidence
// ---------------------------------------------------------------------------

function StarRating({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <svg
          key={star}
          className={`h-3 w-3 ${star <= rating ? "text-signal-gold" : "text-border"}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </span>
  )
}

function renderReviewEvidence(evidence: Record<string, unknown>) {
  const themes = evidence.themes as Array<{ theme?: string; sentiment?: string; examples?: string[] }> | undefined
  const sampleReviews = evidence.sampleReviews as Array<{ rating?: number; text?: string; author?: string; date?: string }> | undefined
  const counts = evidence.sentimentCounts as { positive?: number; negative?: number; mixed?: number } | undefined

  if (!themes?.length && !sampleReviews?.length) return null

  return (
    <div className="mt-2 space-y-3">
      {counts && (counts.positive || counts.negative || counts.mixed) ? (
        <div className="flex items-center gap-3 text-[10px]">
          {(counts.positive ?? 0) > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-precision-teal/15 px-2 py-0.5 font-semibold text-precision-teal">
              <span className="h-1.5 w-1.5 rounded-full bg-precision-teal" />
              {counts.positive} positive
            </span>
          )}
          {(counts.negative ?? 0) > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 font-semibold text-destructive">
              <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
              {counts.negative} negative
            </span>
          )}
          {(counts.mixed ?? 0) > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-signal-gold/15 px-2 py-0.5 font-semibold text-signal-gold">
              <span className="h-1.5 w-1.5 rounded-full bg-signal-gold" />
              {counts.mixed} mixed
            </span>
          )}
        </div>
      ) : null}

      {themes && themes.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Key themes</p>
          {themes.slice(0, 4).map((t, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                t.sentiment === "positive" ? "bg-precision-teal" :
                t.sentiment === "negative" ? "bg-destructive" : "bg-signal-gold"
              }`} />
              <div className="min-w-0">
                <span className="text-[11px] font-medium text-foreground">{t.theme}</span>
                {t.examples?.[0] && (
                  <p className="mt-0.5 text-[10px] italic leading-snug text-muted-foreground">
                    &ldquo;{t.examples[0].slice(0, 80)}{t.examples[0].length > 80 ? "..." : ""}&rdquo;
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {sampleReviews && sampleReviews.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Sample reviews</p>
          {sampleReviews.slice(0, 3).map((r, i) => (
            <div key={i} className="rounded-lg border border-border bg-secondary/50 px-3 py-2">
              <div className="flex items-center gap-2">
                {typeof r.rating === "number" && <StarRating rating={r.rating} />}
                {r.author && <span className="text-[10px] font-medium text-muted-foreground">{r.author}</span>}
                {r.date && <span className="text-[10px] text-muted-foreground">{r.date}</span>}
              </div>
              {r.text && (
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {r.text.slice(0, 150)}{r.text.length > 150 ? "..." : ""}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function renderStructuredEvidence(evidence: Record<string, unknown>, insightType?: string) {
  if (insightType === "review_themes" || insightType === "review_velocity") {
    return renderReviewEvidence(evidence)
  }

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
              <span className="text-muted-foreground">{r.label}:</span>{" "}
              <span className="font-medium text-foreground">{r.value}</span>
            </div>
          ))}
        </div>
      )}
      {eventList && eventList.length > 0 && (
        <div className="space-y-1">
          <p className="font-medium text-muted-foreground">Related events:</p>
          {eventList.slice(0, 3).map((ev, i) => (
            <div key={i} className="flex items-center gap-2 text-muted-foreground">
              <span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
              <span className="font-medium text-foreground">{String(ev.title ?? ev.event_title ?? "Event")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
