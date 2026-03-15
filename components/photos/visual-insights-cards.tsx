"use client"

type InsightItem = {
  id: string
  title: string
  summary: string
  severity: string
  insight_type: string
  date_key: string
  evidence: Record<string, unknown>
  recommendations: Array<{ title?: string; rationale?: string }>
}

type CategoryDistribution = {
  competitorName: string
  categories: Record<string, number>
  total: number
}

type QualityBenchmark = {
  competitorName: string
  professionalPct: number
  styledPct: number
  total: number
}

type Props = {
  insights: InsightItem[]
  categoryDistributions: CategoryDistribution[]
  qualityBenchmarks: QualityBenchmark[]
  promoActivity: Array<{
    competitorName: string
    promoCount: number
    details: string[]
  }>
}

function SeverityDot({ severity }: { severity: string }) {
  const color =
    severity === "critical" ? "bg-destructive" :
    severity === "warning" ? "bg-signal-gold" : "bg-primary"
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />
}

export default function VisualInsightsCards({
  insights,
  categoryDistributions,
  qualityBenchmarks,
  promoActivity,
}: Props) {
  const hasDistributions = categoryDistributions.some((d) => d.total > 0)
  const hasBenchmarks = qualityBenchmarks.some((b) => b.total > 0)
  const hasPromos = promoActivity.some((p) => p.promoCount > 0)
  const hasInsights = insights.length > 0

  if (!hasDistributions && !hasBenchmarks && !hasPromos && !hasInsights) return null

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* Competitive Visual Mix */}
      {hasDistributions && (
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
              <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5H21A7.5 7.5 0 0013.5 3v7.5z" />
              </svg>
            </div>
            <h3 className="text-xs font-bold text-foreground">Visual Content Mix</h3>
          </div>

          <div className="mt-3 space-y-2.5">
            {categoryDistributions.slice(0, 4).map((dist) => {
              const topCategories = Object.entries(dist.categories)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 3)
              return (
                <div key={dist.competitorName}>
                  <p className="text-[10px] font-semibold text-muted-foreground">{dist.competitorName}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {topCategories.map(([cat, count]) => (
                      <span
                        key={cat}
                        className="rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground"
                      >
                        {cat.replace(/_/g, " ")} ({Math.round((count / dist.total) * 100)}%)
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Quality Benchmark */}
      {hasBenchmarks && (
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-precision-teal/15">
              <svg className="h-4 w-4 text-precision-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
              </svg>
            </div>
            <h3 className="text-xs font-bold text-foreground">Quality Benchmark</h3>
          </div>

          <div className="mt-3 space-y-2">
            {qualityBenchmarks.slice(0, 5).map((bm) => (
              <div key={bm.competitorName} className="flex items-center justify-between">
                <span className="max-w-[60%] truncate text-[11px] text-muted-foreground">{bm.competitorName}</span>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-16 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-precision-teal"
                      style={{ width: `${bm.professionalPct}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-[10px] font-semibold text-foreground">
                    {bm.professionalPct}%
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[9px] text-muted-foreground">% photos with professional lighting</p>
        </div>
      )}

      {/* Promotion Activity */}
      {hasPromos && (
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-destructive/15">
              <svg className="h-4 w-4 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
              </svg>
            </div>
            <h3 className="text-xs font-bold text-foreground">Promotion Activity</h3>
          </div>

          <div className="mt-3 space-y-2">
            {promoActivity.filter((p) => p.promoCount > 0).slice(0, 4).map((promo) => (
              <div key={promo.competitorName}>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-foreground">{promo.competitorName}</span>
                  <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-bold text-destructive">
                    {promo.promoCount}
                  </span>
                </div>
                {promo.details.length > 0 && (
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {promo.details[0].slice(0, 60)}{promo.details[0].length > 60 ? "..." : ""}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Visual Changes */}
      {hasInsights && (
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15">
              <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
            <h3 className="text-xs font-bold text-foreground">Recent Changes</h3>
          </div>

          <div className="mt-3 space-y-2">
            {insights.slice(0, 4).map((ins) => (
              <div key={ins.id} className="flex items-start gap-2">
                <SeverityDot severity={ins.severity} />
                <div className="min-w-0">
                  <p className="text-[11px] font-medium leading-snug text-foreground">
                    {ins.title}
                  </p>
                  <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                    {ins.summary.slice(0, 80)}{ins.summary.length > 80 ? "..." : ""}
                  </p>
                  {ins.recommendations[0]?.title && (
                    <p className="mt-1 flex items-center gap-1 text-[10px] font-medium text-signal-gold">
                      <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
                      </svg>
                      {ins.recommendations[0].title}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
