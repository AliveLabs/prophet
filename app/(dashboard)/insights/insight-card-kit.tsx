"use client"

// The Pass — a single insight rendered as a kit play card.
//
// This REPLACES the shared <InsightCard/> presentation for the /insights feed,
// rebuilt to Concept A's structure: family-tinted icon tile, source chip,
// confidence pips, an honest metric row, the suggested play, a "Why" rolldown,
// and verbatim review quotes — composed entirely from `components/ticket`.
//
// The learning loop is PRESERVED: every status change calls the SAME wired
// `updateInsightStatusAction` server action (via the kebab-equivalent menu) and
// fires the optimistic `onStatusChange` so the feed re-buckets instantly. Dismiss
// captures a reason through <TkDismissReason/> (UX-gap: reason → learning signal)
// before writing the existing "dismissed" status.

import { useState, useTransition, useRef, useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import {
  TkPlayCard,
  TkChip,
  TkConfidence,
  TkButton,
  TkWhy,
  TkQuote,
  TkActions,
  TkDismissReason,
  useTkToast,
} from "@/components/ticket"
import { updateInsightStatusAction } from "./actions"
import type { FeedInsight } from "./insights-feed-kit"
import { FAMILY_ICON } from "../home/pass-icons"
import {
  insightFamily,
  insightChipLabel,
  insightConfLevel,
  insightQuotes,
  insightSentiment,
  insightWhyPoints,
  insightWhyLabel,
  insightWhySource,
  insightMetrics,
  insightRecs,
  URGENCY_LABEL,
} from "./insights-map"

const DISMISS_REASONS = ["Not relevant to me", "Already doing it", "This looks wrong"]
// The capture-reasons map onto the existing two negative statuses: a data-quality
// complaint flags the source as inaccurate; everything else is a plain dismiss.
function reasonToStatus(reason: string): "dismissed" | "inaccurate" {
  return reason === "This looks wrong" ? "inaccurate" : "dismissed"
}

const POSITIVE_LABEL: Record<string, string> = {
  read: "Marked read",
  todo: "Added to your to-do",
  actioned: "Marked done",
}

export function InsightCardKit({
  insight,
  onStatusChange,
}: {
  insight: FeedInsight
  onStatusChange?: (insightId: string, newStatus: string) => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const toast = useTkToast()
  const [pending, startTransition] = useTransition()
  const [reasonOpen, setReasonOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const family = insightFamily(insight)
  const level = insightConfLevel(insight.confidence)
  const quotes = insightQuotes(insight)
  const sentiment = insightSentiment(insight)
  const why = insightWhyPoints(insight)
  const metrics = insightMetrics(insight)
  const recs = insightRecs(insight)

  const status = insight.status
  const isCleared = status === "dismissed" || status === "inaccurate" || status === "snoozed"

  useEffect(() => {
    if (!menuOpen) return
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [menuOpen])

  function applyStatus(newStatus: string, toastMsg: string) {
    setMenuOpen(false)
    onStatusChange?.(insight.id, newStatus)
    const fd = new FormData()
    fd.set("insight_id", insight.id)
    fd.set("new_status", newStatus)
    fd.set("current_path", pathname)
    startTransition(async () => {
      await updateInsightStatusAction(fd)
      toast(toastMsg)
      router.refresh()
    })
  }

  function dismissWithReason(reason: string) {
    setReasonOpen(false)
    const newStatus = reasonToStatus(reason)
    applyStatus(
      newStatus,
      newStatus === "inaccurate"
        ? `Flagged as inaccurate · “${reason}” — we’ll check the source.`
        : `Dismissed · “${reason}” — we’ll learn from it.`,
    )
  }

  // ── status top-right: insights show confidence pips (no label) so the operator
  //    can weight them at a glance. A win-flag is reserved for the brief's true
  //    advantages — an insight never claims an edge it can't back. ──
  const statusEl = <TkConfidence level={level} showLabel={false} />

  // ── chip row: source family + urgency + (when cleared) the cleared state ──
  const chips = (
    <>
      <TkChip family={family}>{insightChipLabel(insight)}</TkChip>
      {insight.subjectLabel ? <span className="ins-subject">{insight.subjectLabel}</span> : null}
      <span className={`ins-urg ins-urg-${insight.urgencyLevel}`}>
        {URGENCY_LABEL[insight.urgencyLevel]}
      </span>
      {isCleared ? (
        <span className="ins-cleared-tag">
          {status === "snoozed" ? "Snoozed" : status === "inaccurate" ? "Reported" : "Dismissed"}
        </span>
      ) : status === "actioned" ? (
        <span className="ins-cleared-tag ins-done">Done</span>
      ) : status === "todo" ? (
        <span className="ins-cleared-tag ins-todo">To-do</span>
      ) : null}
    </>
  )

  // ── card body: confidence label + metrics + suggested play + sentiment + quotes + why ──
  const body = (
    <>
      <div className="ins-conf-line">
        <TkConfidence level={level} />
        <span className="ins-rel" title={`Relevance ${insight.relevanceScore}/100`}>
          Fit {insight.relevanceScore}
        </span>
      </div>

      {metrics.length ? (
        <div className="ins-metrics">
          {metrics.map((m) => (
            <span className="ins-metric" key={m}>
              {m}
            </span>
          ))}
        </div>
      ) : null}

      {recs.length ? (
        <div className="ins-recs">
          {recs.map((r, i) => (
            <div className="ins-rec" key={i}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M12 18v-5m0 0a6 6 0 1 0-3-.8c.85.5 1.5 1.3 1.5 2.3V13m3 0v.7c0 1-.65 1.8-1.5 2.3M9.5 21h5" />
              </svg>
              <div>
                <p className="ins-rec-t">{r.title}</p>
                {r.rationale ? <p className="ins-rec-r">{r.rationale}</p> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {sentiment ? (
        <div className="ins-sent" role="img" aria-label="Review sentiment split">
          {sentiment.positive > 0 ? (
            <span className="ins-sent-p">{sentiment.positive} positive</span>
          ) : null}
          {sentiment.mixed > 0 ? <span className="ins-sent-m">{sentiment.mixed} mixed</span> : null}
          {sentiment.negative > 0 ? (
            <span className="ins-sent-n">{sentiment.negative} negative</span>
          ) : null}
        </div>
      ) : null}

      {quotes.length ? (
        <div className="tk-quotes ins-quotes">
          {quotes.map((q, i) => (
            <TkQuote key={i} text={q.text} who={q.who} stars={q.stars} when={q.when} />
          ))}
        </div>
      ) : null}

      <TkWhy label={insightWhyLabel(insight)} points={why} source={insightWhySource(insight)} />

      {insight.suppressed ? (
        <p className="ins-suppressed">Shown lower — less relevant based on your feedback.</p>
      ) : null}
    </>
  )

  // ── action row: the status menu + dismiss (with reason capture) ──
  const actions = isCleared ? (
    <TkButton
      variant="ghost"
      disabled={pending}
      onClick={() => applyStatus("read", "Restored to your feed.")}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M3 7v6h6" />
        <path d="M3 13a9 9 0 1 0 3-7.7L3 8" />
      </svg>
      Undo
    </TkButton>
  ) : (
    <>
      <div className="ins-menu-wrap" ref={menuRef}>
        <TkButton
          variant="keep"
          kept={status === "actioned" || status === "todo" || status === "read"}
          disabled={pending}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M5 12l5 5L20 7" />
          </svg>
          <span className="kw">Track</span>
        </TkButton>
        {menuOpen ? (
          <div className="ins-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => applyStatus("read", POSITIVE_LABEL.read)}>
              Mark as read
            </button>
            <button type="button" role="menuitem" onClick={() => applyStatus("todo", POSITIVE_LABEL.todo)}>
              Add to to-do
            </button>
            <button type="button" role="menuitem" onClick={() => applyStatus("actioned", POSITIVE_LABEL.actioned)}>
              Mark as done
            </button>
            <button type="button" role="menuitem" onClick={() => applyStatus("snoozed", "Snoozed for later.")}>
              Do later
            </button>
          </div>
        ) : null}
      </div>
      <TkButton
        variant="dismiss"
        disabled={pending}
        aria-label="Dismiss this insight"
        aria-expanded={reasonOpen}
        onClick={() => setReasonOpen(true)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </TkButton>
    </>
  )

  return (
    <TkPlayCard
      family={family}
      icon={FAMILY_ICON[family]}
      title={insight.title}
      confidence={statusEl}
      chips={chips}
      summary={insight.summary}
      actions={null}
      className={isCleared ? "ins-card ins-card-cleared" : "ins-card"}
      style={{ position: "relative" }}
    >
      {body}
      <TkActions>{actions}</TkActions>
      {!isCleared ? (
        <TkDismissReason
          open={reasonOpen}
          reasons={DISMISS_REASONS}
          // The insights feed already routes "This looks wrong" → the data-quality `inaccurate` status
          // (reasonToStatus). The optional note box (ALT-172) is wired on the Daily Brief surface only,
          // so we keep this feed's flow unchanged (no note step) until its action carries a note too.
          noteReasons={[]}
          onSelect={dismissWithReason}
          onCancel={() => setReasonOpen(false)}
        />
      ) : null}
    </TkPlayCard>
  )
}
