"use client"

// The Pass — page-local re-implementation of the social insight feed.
//
// Replaces the shared <InsightFeed/> + <InsightCard/> presentation with the kit
// (TkPlayCard-style cards, TkChip families, TkConfidence pips, TkWhy rolldowns).
// The LEARNING LOOP is preserved verbatim: each card mounts the shared
// <KebabMenu/> which calls updateInsightStatusAction (mark read / to-do / done /
// dismiss / report) — the exact same server action and status contract as prod.
// Relevance scoring is already done server-side; we only change presentation.
//
// Honest framing only — %/estimated/"you vs competitor", no invented $/covers.

import { useState, useMemo, type CSSProperties, type ReactNode } from "react"
import {
  TkChip,
  TkConfidence,
  TkWhy,
  TkQuote,
  RevealOnView,
  type TkConfidenceLevel,
} from "@/components/ticket"
import KebabMenu from "@/components/insights/kebab-menu"
import type { FeedInsight } from "@/components/insights/insight-feed"

const HIDDEN_STATUSES = new Set(["dismissed", "snoozed", "inaccurate"])

function confLevel(c: string): TkConfidenceLevel {
  const v = c.toLowerCase()
  if (v === "high") return "high"
  if (v === "medium" || v === "moderate") return "medium"
  return "directional"
}

const STATUS_LABEL: Record<string, string> = {
  read: "Read",
  todo: "To-Do",
  actioned: "Done",
}

function urgencyChipLabel(u: FeedInsight["urgencyLevel"]): string {
  if (u === "critical") return "High priority"
  if (u === "warning") return "Worth a look"
  return "FYI"
}

// Pull a couple of honest, %-framed metric pills out of evidence.
function metricPills(evidence: Record<string, unknown>): string[] {
  const pills: string[] = []
  const e = evidence
  if (typeof e.pct_change === "number") pills.push(`${e.pct_change > 0 ? "+" : ""}${e.pct_change}%`)
  if (typeof e.location_engagement === "number" && typeof e.competitor_engagement === "number") {
    pills.push(`You ${(e.location_engagement as number).toFixed(1)}% vs ${(e.competitor_engagement as number).toFixed(1)}%`)
  }
  if (typeof e.follower_gap === "number") pills.push(`${e.follower_gap > 0 ? "+" : ""}${e.follower_gap} followers`)
  const kws = e.matched_keywords as string[] | undefined
  if (kws?.length) pills.push(kws.slice(0, 2).join(", "))
  return pills.slice(0, 3)
}

// Sample quotes (review-style) the engine sometimes attaches to a social insight.
function evidenceQuotes(evidence: Record<string, unknown>): Array<{ text: string; who?: string }> {
  const samples = evidence.sampleReviews as Array<{ text?: string; author?: string }> | undefined
  if (!samples?.length) return []
  return samples
    .slice(0, 2)
    .filter((s) => s.text)
    .map((s) => ({ text: s.text!.slice(0, 160), who: s.author }))
}

function InsightItem({ insight }: { insight: FeedInsight }) {
  const pills = metricPills(insight.evidence)
  const quotes = evidenceQuotes(insight.evidence)
  const recs = insight.recommendations
    .map((r) => ({
      title: String((r as Record<string, unknown>)?.title ?? ""),
      rationale: String((r as Record<string, unknown>)?.rationale ?? ""),
    }))
    .filter((r) => r.title)

  const whyPoints: ReactNode[] = [
    `Relevance ${insight.relevanceScore}/100 — from ${insight.severity} severity and ${insight.confidence} confidence.`,
    ...recs.slice(0, 2).map((r) => (r.rationale ? `${r.title} — ${r.rationale}` : r.title)),
  ]

  const statusBadge = STATUS_LABEL[insight.status]

  return (
    <article className={`sp-ins tk-pcard sp-ins-${insight.urgencyLevel}`} style={{ position: "relative" }}>
      <div className="sp-ins-top">
        <div className="sp-ins-chips">
          <TkChip family="social">Social</TkChip>
          <span className={`sp-ins-urg sp-ins-urg-${insight.urgencyLevel}`}>
            {urgencyChipLabel(insight.urgencyLevel)}
          </span>
          {statusBadge ? <span className="sp-ins-status">{statusBadge}</span> : null}
        </div>
        <div className="sp-ins-actions">
          <TkConfidence level={confLevel(insight.confidence)} showLabel={false} />
          <KebabMenu insightId={insight.id} currentStatus={insight.status} />
        </div>
      </div>

      <h4 className="sp-ins-title">{insight.title}</h4>
      <p className="tk-pc-sum sp-ins-sum">{insight.summary}</p>

      {pills.length > 0 && (
        <div className="sp-ins-pills">
          {pills.map((p) => (
            <span key={p} className="sp-ins-pill">{p}</span>
          ))}
        </div>
      )}

      {quotes.length > 0 && (
        <div className="tk-quotes sp-ins-quotes">
          {quotes.map((q, i) => (
            <TkQuote key={i} text={q.text} who={q.who} />
          ))}
        </div>
      )}

      <TkWhy
        label="Why we surfaced this"
        points={whyPoints}
        source={`${insight.subjectLabel} · social signals`}
      />
    </article>
  )
}

export default function SocialInsightsPass({ insights }: { insights: FeedInsight[] }) {
  const [showAll, setShowAll] = useState(false)

  const visible = useMemo(
    () => insights.filter((i) => !HIDDEN_STATUSES.has(i.status)),
    [insights],
  )

  if (visible.length === 0) return null

  const LIMIT = 6
  const shown = showAll ? visible : visible.slice(0, LIMIT)
  const remaining = visible.length - shown.length

  return (
    <div className="sp-insights">
      <RevealOnView className="tk-grid sp-ins-grid" stagger>
        {shown.map((insight, i) => (
          <div key={insight.id} style={{ "--tk-i": i } as CSSProperties}>
            <InsightItem insight={insight} />
          </div>
        ))}
      </RevealOnView>

      {remaining > 0 && (
        <button type="button" className="sp-showmore" onClick={() => setShowAll(true)}>
          <span aria-hidden="true">▾</span> Show {remaining} more insight{remaining === 1 ? "" : "s"}
        </button>
      )}
      {showAll && visible.length > LIMIT && (
        <button type="button" className="sp-showmore" onClick={() => setShowAll(false)}>
          <span aria-hidden="true">▴</span> Show less
        </button>
      )}
    </div>
  )
}
