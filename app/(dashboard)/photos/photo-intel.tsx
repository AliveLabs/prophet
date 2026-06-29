"use client"

// The Pass — Photos visual-intelligence panels (page-local rebuild).
//
// Re-implements the presentation of the shared components/photos/visual-insights-cards.tsx
// with the Pass kit (TkCard panels + TkSentimentRows bars), so it reads like the rest of
// the product. The shared component is left untouched (file-lane rule). Data shape + the
// honest %-framing ("% of photos…", "you vs competitor") are preserved exactly.

import { TkCard, TkSentimentRows } from "@/components/ticket"

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

type PromoActivity = {
  competitorName: string
  promoCount: number
  details: string[]
}

type Props = {
  insights: InsightItem[]
  categoryDistributions: CategoryDistribution[]
  qualityBenchmarks: QualityBenchmark[]
  promoActivity: PromoActivity[]
}

const REC_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.4 14.4 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
  </svg>
)

function PanelHead({
  tone,
  icon,
  title,
}: {
  tone: "rep" | "teal" | "gold" | "slate"
  icon: React.ReactNode
  title: string
}) {
  return (
    <div className="photos-panel-head">
      <span className={`photos-panel-ic tk-icon-${tone}`} aria-hidden="true">
        {icon}
      </span>
      <h4>{title}</h4>
    </div>
  )
}

export default function PhotoIntel({
  insights,
  categoryDistributions,
  qualityBenchmarks,
  promoActivity,
}: Props) {
  const hasDistributions = categoryDistributions.some((d) => d.total > 0)
  const hasBenchmarks = qualityBenchmarks.some((b) => b.total > 0)
  const promos = promoActivity.filter((p) => p.promoCount > 0)
  const hasPromos = promos.length > 0
  const hasInsights = insights.length > 0

  if (!hasDistributions && !hasBenchmarks && !hasPromos && !hasInsights) return null

  // Quality benchmark → kit sentiment-row bars (honest: % of photos with pro lighting).
  const benchRows = qualityBenchmarks
    .filter((b) => b.total > 0)
    .slice(0, 5)
    .map((b) => ({
      label: b.competitorName,
      width: b.professionalPct,
      value: `${b.professionalPct}%`,
      tone: (b.professionalPct >= 50 ? "ok" : b.professionalPct >= 25 ? "warn" : "bad") as
        | "ok"
        | "warn"
        | "bad",
      tip: `${b.competitorName} · professional lighting`,
      tipValue: `${b.professionalPct}% of ${b.total} photos`,
    }))

  return (
    <div className="photos-intel">
      {/* Visual content mix */}
      {hasDistributions && (
        <TkCard>
          <PanelHead
            tone="rep"
            title="Visual content mix"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
                <path d="M10.5 6a7.5 7.5 0 1 0 7.5 7.5h-7.5V6z" />
                <path d="M13.5 10.5H21A7.5 7.5 0 0 0 13.5 3v7.5z" />
              </svg>
            }
          />
          <div>
            {categoryDistributions
              .filter((d) => d.total > 0)
              .slice(0, 4)
              .map((dist) => {
                const top = Object.entries(dist.categories)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 3)
                return (
                  <div className="photos-mix-comp" key={dist.competitorName}>
                    <div className="photos-mix-name">{dist.competitorName}</div>
                    <div className="photos-mix-cats">
                      {top.map(([cat, count]) => (
                        <span className="photos-mix-cat" key={cat}>
                          {cat.replace(/_/g, " ")} · {Math.round((count / dist.total) * 100)}%
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })}
          </div>
          <p className="photos-panel-foot">Share of each competitor&apos;s analyzed photos, by subject.</p>
        </TkCard>
      )}

      {/* Quality benchmark (you vs competitors, % framing) */}
      {hasBenchmarks && (
        <TkCard>
          <PanelHead
            tone="teal"
            title="Quality benchmark"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
                <path d="M11.48 3.5a.56.56 0 0 1 1.04 0l2.12 5.11c.08.2.27.33.48.35l5.52.44c.5.04.7.66.32.99l-4.2 3.6a.56.56 0 0 0-.19.56l1.29 5.38a.56.56 0 0 1-.84.61l-4.73-2.88a.56.56 0 0 0-.58 0l-4.73 2.88a.56.56 0 0 1-.84-.61l1.29-5.38a.56.56 0 0 0-.19-.56l-4.2-3.6a.56.56 0 0 1 .32-.99l5.52-.44c.21-.02.4-.15.48-.35L11.48 3.5z" />
              </svg>
            }
          />
          <TkSentimentRows
            caption="Professional lighting"
            captionRight="% of photos"
            rows={benchRows}
          />
          <p className="photos-panel-foot">Higher = more photos shot with professional lighting.</p>
        </TkCard>
      )}

      {/* Promotion activity */}
      {hasPromos && (
        <TkCard>
          <PanelHead
            tone="rep"
            title="Promotion activity"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
                <path d="M9.57 3H5.25A2.25 2.25 0 0 0 3 5.25v4.32c0 .6.24 1.17.66 1.59l9.58 9.58c.7.7 1.78.87 2.6.33a18.1 18.1 0 0 0 5.23-5.22c.54-.83.37-1.91-.33-2.61L11.16 3.66A2.25 2.25 0 0 0 9.57 3z" />
                <path d="M6 6h.01v.01H6V6z" />
              </svg>
            }
          />
          <div>
            {promos.slice(0, 4).map((promo) => (
              <div className="photos-promo-row" key={promo.competitorName}>
                <div className="photos-promo-top">
                  <span className="photos-promo-name">{promo.competitorName}</span>
                  <span className="photos-promo-count">
                    {promo.promoCount} promo{promo.promoCount === 1 ? "" : "s"}
                  </span>
                </div>
                {promo.details[0] && (
                  <p className="photos-promo-detail">
                    {promo.details[0].slice(0, 72)}
                    {promo.details[0].length > 72 ? "…" : ""}
                  </p>
                )}
              </div>
            ))}
          </div>
          <p className="photos-panel-foot">Promotional content detected in competitor photos.</p>
        </TkCard>
      )}

      {/* Recent visual changes */}
      {hasInsights && (
        <TkCard>
          <PanelHead
            tone="gold"
            title="Recent visual changes"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
                <path d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0zm-9 3.75h.01v.01H12v-.01z" />
              </svg>
            }
          />
          <div>
            {insights.slice(0, 4).map((ins) => {
              const sev =
                ins.severity === "critical"
                  ? "photos-sev-critical"
                  : ins.severity === "warning"
                    ? "photos-sev-warning"
                    : "photos-sev-info"
              return (
                <div className="photos-change-row" key={ins.id}>
                  <span className={`photos-sev-dot ${sev}`} aria-hidden="true" />
                  <div>
                    <p className="photos-change-title">{ins.title}</p>
                    <p className="photos-change-sum">
                      {ins.summary.slice(0, 96)}
                      {ins.summary.length > 96 ? "…" : ""}
                    </p>
                    {ins.recommendations[0]?.title && (
                      <span className="photos-change-rec">
                        {REC_ICON}
                        {ins.recommendations[0].title}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </TkCard>
      )}
    </div>
  )
}
