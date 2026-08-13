"use client"

// The /insights surface's insight card: <UnifiedInsightCard/> with the REAL writes attached.
//
// This is the wiring layer, and it is deliberately thin — the same split the home brief
// uses (brief-insight-card.tsx): the card owns the chrome, hierarchy, tier logic and the
// button framework; `insight-row-adapter.ts` owns the translation from a stored row; this
// file owns only the three things a surface can own — which server action fires, what the
// toast says, and which evidence blocks this record supports.
//
// It REPLACES the old <InsightCardKit/> and retires two rule violations with it:
//   · the "Fit 74" numeral (scores are word levels; ranking numbers never render), and
//   · the Track / Read / Add to to-do / Mark as done / Do later verb set. Keep and
//     Dismiss are the only verbs, same as every other insight surface.
//
// The writes:
//   KEEP    → updateInsightStatusAction status "todo"  (the existing "I'm on this"
//             lifecycle status — shows in Pinned, counts as a positive signal)
//   DISMISS → status "dismissed", or "inaccurate" when the reason is the data-quality
//             complaint ("This looks wrong") — the same reason→status routing the old
//             card used, so the ops review queue keeps its signal
//   UNDO    → status "new" (and the server clears the row's user_feedback)
//   thumbs  → submitInsightFeedback(verdict) — user_feedback + preference weight only,
//             NEVER a status change. This is the per-insight feedback action the old
//             card's ALT-184f note said this surface was missing.

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import UnifiedInsightCard, { type InsightVerdict } from "@/components/insights/unified-insight-card"
import { TkQuote, TkCompetitorLink, SocialChannelChip, useTkToast } from "@/components/ticket"
import { dismissReasonCode } from "@/lib/skills/feedback-signals"
import { updateInsightStatusAction, submitInsightFeedback } from "./actions"
import { insightRowToUnifiedInsight, insightKeptState } from "./insight-row-adapter"
import {
  insightQuotes,
  insightSentiment,
  insightMetrics,
  insightDateStamp,
} from "./insights-map"
import type { FeedInsight } from "./insights-feed-kit"

export function InsightRowCard({
  insight,
  onStatusChange,
}: {
  insight: FeedInsight
  onStatusChange?: (insightId: string, newStatus: string) => void
}) {
  const router = useRouter()
  const toast = useTkToast()
  const [pending, startTransition] = useTransition()
  const [voted, setVoted] = useState<InsightVerdict | null>(null)

  const unified = insightRowToUnifiedInsight(insight)
  const kept = insightKeptState(insight.status)

  const quotes = insightQuotes(insight)
  const sentiment = insightSentiment(insight)
  const metrics = insightMetrics(insight)

  function applyStatus(newStatus: string, toastMsg: string | null) {
    onStatusChange?.(insight.id, newStatus)
    const fd = new FormData()
    fd.set("insight_id", insight.id)
    fd.set("new_status", newStatus)
    startTransition(async () => {
      await updateInsightStatusAction(fd)
      if (toastMsg) toast(toastMsg)
      router.refresh()
    })
  }

  function keep() {
    applyStatus("todo", "Saved to your kept insights: “I’m on this”.")
  }

  function dismiss(reason: string) {
    // Same routing the old card used: the data-quality complaint flags the SOURCE as
    // inaccurate (ops review queue); everything else is a plain dismiss the preference
    // loop learns from.
    const code = dismissReasonCode(reason)
    if (code === "looks_wrong") {
      applyStatus("inaccurate", "Thanks. We’ll check the source data behind this.")
    } else {
      applyStatus("dismissed", `Dismissed · “${reason}”. We’ll learn from it.`)
    }
  }

  function undo() {
    applyStatus("new", null)
  }

  function onVote(verdict: InsightVerdict) {
    if (voted) return
    setVoted(verdict)
    startTransition(() => {
      void submitInsightFeedback({ insightId: insight.id, verdict })
    })
  }

  // ── The evidence this record supports, passed through the card's support slot.
  //    A detector row carries metric pills, a sentiment split and verbatim review
  //    quotes — none of which a play has, which is exactly why the card takes
  //    surface-specific evidence instead of one fixed block. ──
  const hasMeta = Boolean(insight.subjectLabel) || Boolean(insight.evidence?.platform)
  const support = (
    <div className="ins-row-support">
      {metrics.length ? (
        <div className="ins-metrics">
          {metrics.map((m) => (
            <span className="ins-metric" key={m}>
              {m}
            </span>
          ))}
        </div>
      ) : null}

      {sentiment ? (
        <div className="ins-sent" role="img" aria-label="Review sentiment split">
          {sentiment.positive > 0 ? <span className="ins-sent-p">{sentiment.positive} positive</span> : null}
          {sentiment.mixed > 0 ? <span className="ins-sent-m">{sentiment.mixed} mixed</span> : null}
          {sentiment.negative > 0 ? <span className="ins-sent-n">{sentiment.negative} negative</span> : null}
        </div>
      ) : null}

      {quotes.length ? (
        <div className="tk-quotes ins-quotes">
          {quotes.map((q, i) => (
            <TkQuote key={i} text={q.text} who={q.who} stars={q.stars} when={q.when} />
          ))}
        </div>
      ) : null}

      {/* Provenance line: who this is about (ALT-192 keeps the competitor link), which
          social channel (ALT-372), and when it was generated (ALT-293). */}
      <div className="ins-row-meta">
        {hasMeta ? (
          <>
            <SocialChannelChip platform={(insight.evidence?.platform as string | undefined) ?? null} />
            {insight.subjectLabel ? (
              <span className="ins-subject">
                <TkCompetitorLink id={insight.competitorId} name={insight.subjectLabel} />
              </span>
            ) : null}
          </>
        ) : null}
        <span className="ins-seen">{insightDateStamp(insight.dateKey)}</span>
      </div>

      {insight.suppressed ? (
        <p className="ins-suppressed">Shown lower: less relevant based on your feedback.</p>
      ) : null}
    </div>
  )

  return (
    <UnifiedInsightCard
      insight={unified}
      actions={{
        kept,
        pending,
        onKeep: keep,
        onDismiss: dismiss,
        onUndo: undo,
        // No note step on this surface: updateInsightStatusAction carries no note field,
        // and promising a box whose text goes nowhere would be worse than not asking.
        noteReasons: [],
      }}
      vote={{ picked: voted, onVote }}
      support={support}
    />
  )
}
