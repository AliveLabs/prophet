"use client"

// "Where you stand" (ALT-262) — the head-to-head scorecard that replaces the
// retired crowd-pull comparison. Every metric here is ABSOLUTE and comparable
// across venues (stars, counts, shares) — the %-of-own-peak popular-times read
// deliberately lives in "Who's busy when" (timing), never here (magnitude).
//
// One row per metric: a FIELD STRIP — every competitor is a dot on the same
// scale, you are the patina marker — so position AND spread read at a glance
// (barely-behind vs way-behind look different, which pairwise W/L bars can't
// show). Rows sort worst-gap first: the scoreboard is a prioritized worklist.
//
// A behind-row expands into an evidence panel styled like an inline insight
// (family chip + confidence pips + driver bullets — the insight-card anatomy),
// with the Ticket chat-mark "Ask Ticket about this gap" ingress (ALT-230
// contract: /ask?q=…). Patina (--teal, "yours" in the style guide) carries the
// "you / you're ahead" identity — same semantics as the kit's H2H legend.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { RevealOnView, TkCard, TkSectionHead, TkEmptyState, TkChip, TkConfidence } from "@/components/ticket"
import type { TkConfidenceLevel } from "@/components/ticket/primitives"
import { tkcx as cx } from "@/components/ticket/primitives"
import { TicketChatMark } from "@/components/brand/ticket-chat-mark"

/* ── Serializable shapes (built server-side in operator-data) ── */
export type ScorecardPoint = {
  /** competitor id (null for you) — used for detail links */
  id: string | null
  name: string
  value: number
  /** preformatted display value, e.g. "4.6★", "31%", "1,240" */
  display: string
}

export type ScorecardMetric = {
  key: string
  label: string
  /** competitors on this scale (2+ makes a field; 1 still renders) */
  points: ScorecardPoint[]
  /** the operator's own value; null ⇒ row renders as "no read for you yet" */
  you: ScorecardPoint | null
  status: "lead" | "close" | "behind"
  /** one plain sentence, e.g. "Chick-fil-A leads · 4.7★ vs your 4.6★" */
  verdict: string
  confidence: TkConfidenceLevel
  /** observable driver facts for the expanded panel (never speculation) */
  evidence: string[]
  /** where the data comes from, for the panel footer */
  source: string
  /** deeper surface for this metric (e.g. /visibility) */
  href: string | null
}

const STATUS_LABEL: Record<ScorecardMetric["status"], string> = {
  lead: "You lead",
  close: "Close",
  behind: "They lead",
}

const CHART_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M3 3v18h18" />
    <path d="M7 14l4-4 3 3 5-6" />
  </svg>
)

/** Scale a value into 6%..94% of the strip (padding keeps markers off the edges). */
function scaleX(v: number, lo: number, hi: number): number {
  if (hi <= lo) return 50
  return 6 + ((v - lo) / (hi - lo)) * 88
}

function FieldStrip({ m }: { m: ScorecardMetric }) {
  // Precondition: the parent only renders metrics with you != null && points.length > 0,
  // so `all` is never empty — the guard keeps Math.min/max honest if that ever changes.
  const all = [...m.points.map((p) => p.value), ...(m.you ? [m.you.value] : [])]
  if (all.length === 0) return null
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const leader = m.points.reduce<ScorecardPoint | null>(
    (best, p) => (best == null || p.value > best.value ? p : best),
    null,
  )
  const youLeads = m.status === "lead"

  // The strip is decorative alongside the verdict text; the full data story is
  // spoken via the row's sr-only summary below.
  return (
    <div className="tk-sc-strip" aria-hidden="true">
      <span className="tk-sc-rail" />
      {m.points.map((p) => {
        const isLeader = !youLeads && leader != null && p.id === leader.id
        return (
          <span
            key={p.id ?? p.name}
            className={cx("tk-sc-dot", isLeader && "tk-sc-dot-lead")}
            style={{ left: `${scaleX(p.value, lo, hi).toFixed(1)}%` }}
            data-tip={p.name}
            data-tipv={p.display}
          >
            {isLeader && (
              <span className="tk-sc-dot-lbl">
                {p.name} · {p.display}
              </span>
            )}
          </span>
        )
      })}
      {m.you && (
        <>
          <span
            className="tk-sc-me"
            style={{ left: `${scaleX(m.you.value, lo, hi).toFixed(1)}%` }}
            data-tip="You"
            data-tipv={m.you.display}
          />
          {/* label is a SIBLING so it doesn't inherit the diamond's 45° rotation */}
          <span
            className="tk-sc-me-lbl"
            style={{ left: `clamp(36px, ${scaleX(m.you.value, lo, hi).toFixed(1)}%, calc(100% - 40px))` }}
          >
            You · {m.you.display}
          </span>
        </>
      )}
    </div>
  )
}

export default function CompetitorScorecard({
  metrics,
  ownName,
}: {
  metrics: ScorecardMetric[]
  ownName: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState<string | null>(null)

  const withYou = metrics.filter((m) => m.you != null && m.points.length > 0)
  if (withYou.length === 0) {
    return (
      <section className="tk-comp-sec">
        <TkSectionHead
          title="Where you stand"
          sub="Head-to-head across your competitors, once both sides are read"
        />
        <TkEmptyState
          icon={CHART_ICON}
          title="We can't place you yet"
          description={`We compare ratings, reviews, visibility and listing quality across your set. Once ${ownName}'s own listing is read, you'll see where you lead and where a rival does — and what's driving it.`}
        />
      </section>
    )
  }

  const leads = withYou.filter((m) => m.status === "lead").length
  const closes = withYou.filter((m) => m.status === "close").length
  const behinds = withYou.filter((m) => m.status === "behind").length
  const worst = withYou.find((m) => m.status === "behind") // already sorted worst-first

  function toggle(key: string) {
    setOpen((cur) => (cur === key ? null : key))
  }

  function ask(m: ScorecardMetric) {
    const leader = m.points.reduce<ScorecardPoint | null>(
      (best, p) => (best == null || p.value > best.value ? p : best),
      null,
    )
    const q =
      m.status === "lead"
        ? `I'm ahead of my competitors on ${m.label.toLowerCase()} — how do I keep that lead?`
        : `${leader?.name ?? "A competitor"} beats me on ${m.label.toLowerCase()} (${leader?.display ?? ""} vs my ${m.you?.display ?? ""}). What's likely driving it, and what should I do about it?`
    router.push(`/ask?q=${encodeURIComponent(q)}`)
  }

  return (
    <section className="tk-comp-sec">
      <TkSectionHead
        title="Where you stand"
        sub="Every rival on the same scale — where you lead, where they do, and what's driving it"
      />
      <RevealOnView>
        <TkCard>
          <div className="tk-sc">
            {/* ── Verdict header ── */}
            <div className="tk-sc-verdict">
              {leads > 0 && <span className="tk-sc-tag tk-sc-tag-lead">Ahead in {leads}</span>}
              {closes > 0 && <span className="tk-sc-tag tk-sc-tag-close">Close in {closes}</span>}
              {behinds > 0 && <span className="tk-sc-tag tk-sc-tag-behind">Behind in {behinds}</span>}
              {worst && (
                <span className="tk-sc-lede">
                  Biggest gap: {worst.label.toLowerCase()}
                </span>
              )}
            </div>

            {/* ── Metric rows, worst gap first ── */}
            <div className="tk-sc-rows">
              {withYou.map((m) => {
                const isOpen = open === m.key
                const expandable = m.evidence.length > 0 || m.href != null
                // The strip is aria-hidden; this row's button speaks the story.
                const srSummary = `${m.label}: ${STATUS_LABEL[m.status]}. ${m.verdict}`
                return (
                  <div key={m.key} className={cx("tk-sc-row", isOpen && "tk-sc-row-open")}>
                    <button
                      type="button"
                      className="tk-sc-rowbtn"
                      onClick={() => expandable && toggle(m.key)}
                      aria-expanded={expandable ? isOpen : undefined}
                      aria-controls={expandable ? `tk-sc-ev-${m.key}` : undefined}
                      aria-label={srSummary}
                    >
                      <span className="tk-sc-mname">
                        {m.label}
                        <TkConfidence level={m.confidence} showLabel={false} />
                      </span>
                      <FieldStrip m={m} />
                      <span className="tk-sc-mverdict">
                        <span className={cx("tk-sc-wl", `tk-sc-wl-${m.status}`)}>{STATUS_LABEL[m.status]}</span>
                        <span className="tk-sc-vtxt">{m.verdict}</span>
                      </span>
                      {expandable && (
                        <span className={cx("tk-sc-chev", isOpen && "tk-sc-chev-on")} aria-hidden="true">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6" /></svg>
                        </span>
                      )}
                    </button>

                    {/* ── Evidence panel: inline-insight anatomy (chip + pips + drivers + ask) ── */}
                    {isOpen && (
                      <div className="tk-sc-ev" id={`tk-sc-ev-${m.key}`}>
                        <div className="tk-sc-ev-head">
                          <TkChip family="competitive">Head-to-head</TkChip>
                          <TkConfidence level={m.confidence} />
                        </div>
                        {m.evidence.length > 0 && (
                          <ul className="tk-sc-ev-points">
                            {m.evidence.map((p, i) => (
                              <li key={i}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                  <path d="M12 18v-5m0 0a6 6 0 1 0-3-.8c.85.5 1.5 1.3 1.5 2.3V13m3 0v.7c0 1-.65 1.8-1.5 2.3M9.5 21h5" />
                                </svg>
                                <span>{p}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="tk-sc-ev-actions">
                          <button type="button" className="tk-sc-ask" onClick={() => ask(m)}>
                            <TicketChatMark size={16} shape="square" />
                            Ask Ticket about this gap
                          </button>
                          {m.href && (
                            <button
                              type="button"
                              className="tk-sc-more"
                              onClick={() => router.push(m.href as string)}
                            >
                              See the full read
                            </button>
                          )}
                        </div>
                        <p className="tk-sc-ev-src">Source: {m.source}</p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <p className="tk-sc-foot">
              Every measure here is absolute and comparable across venues — stars, counts and shares, never
              popular-times percentages. Timing and rhythm live in the busy read below.
            </p>
          </div>
        </TkCard>
      </RevealOnView>
    </section>
  )
}
