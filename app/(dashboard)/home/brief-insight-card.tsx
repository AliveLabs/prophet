"use client"

// The home brief's insight card: <UnifiedInsightCard/> with the REAL writes attached.
//
// This is the wiring layer, and it is deliberately thin. The card owns the chrome, the
// hierarchy, the tier logic and the button framework; `unified-insight-adapter.ts` owns the
// translation from a play; this file owns only the three things a surface can own — which
// server action fires, what the toast says, and which evidence blocks this record supports.
//
// The learning loop is the SAME one PassPlayCard wired, call for call and key for key:
//   KEEP    → setPlayAction({ action: "saved", play })   positive signal + persists the play
//   DISMISS → setPlayAction({ action: "dismissed", reason, note })   reason IS the signal
//   UNDO    → setPlayAction({ action: null })
//   thumbs  → submitPlayFeedback({ verdict, severity })  writes brief_feedback
// Nothing about the loop changed here. Only the presentation did.
//
// NO CAPABILITY WAS DROPPED in the swap. Everything the old card showed still shows, passed
// through the card's evidence slots: the sentiment-by-category bars, the verbatim review
// quotes, the win-flag, both Ask entry points, the drafted customer copy with its copy
// button, and every recipe-step field including dependencies.

import { useState, useTransition, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import {
  TkWinFlag,
  TkQuote,
  TkSentimentRows,
  AskTicket,
  askStepQuestion,
  askEvidenceQuestion,
  useTkToast,
} from "@/components/ticket"
import UnifiedInsightCard from "@/components/insights/unified-insight-card"
import type { EnrichedRecommendation } from "@/lib/skills/types"
import type { PlayAction } from "@/lib/insights/momentum"
import type { Verdict } from "@/lib/skills/preferences"
import { dismissReasonCode } from "@/lib/skills/feedback-signals"
import { setPlayAction, submitPlayFeedback } from "./brief-actions"
import { playToUnifiedInsight } from "./unified-insight-adapter"
import { playQuotes, playSentiment, isAdvantage } from "./pass-map"
import { DraftCopyBox } from "./draft-copy-box"

export function BriefInsightCard({
  play,
  isLead,
  locationId,
  dateKey,
  playKey,
  current,
  readOnly = false,
  detailHref,
  heroPhoto,
  stateLabel,
}: {
  play: EnrichedRecommendation
  isLead: boolean
  locationId: string
  dateKey: string
  playKey: string
  current: PlayAction | null
  readOnly?: boolean
  detailHref?: string
  /** lead-only: the hero image canvas. */
  heroPhoto?: ReactNode
  /** A surface-specific state chip, e.g. the pool's "Top this week". */
  stateLabel?: string
}) {
  const router = useRouter()
  const toast = useTkToast()
  const [pending, startTransition] = useTransition()
  const [voted, setVoted] = useState<Verdict | null>(null)

  // `dateKey` is the brief's own day, which is exactly the "today" the timing chips should
  // be measured against — a brief read on Friday still describes Thursday's windows.
  const insight = playToUnifiedInsight(play, {
    todayKey: dateKey,
    detailHref,
    stateLabel,
    id: playKey,
  })

  const quotes = playQuotes(play)
  const sentiment = playSentiment(play)
  const advantage = isAdvantage(play)

  function keep() {
    if (readOnly) return
    startTransition(async () => {
      const res = await setPlayAction({ locationId, dateKey, playKey, action: "saved", play })
      if (res.ok) {
        toast("Saved to your kept insights: “I’m on this”.")
        router.refresh()
      }
    })
  }

  function dismiss(reason: string, note?: string) {
    if (readOnly) return
    startTransition(async () => {
      // The stored action stays "dismissed" (the server's visibility + cross-day-cooldown
      // contract is unchanged); the chosen reason rides along as a stable CODE, so the
      // reason — not the bare dismissal — is what the engine learns from. "This looks wrong"
      // carries an optional note as DATA-QUALITY feedback and does NOT reweight the model,
      // so its confirmation is worded differently.
      const code = dismissReasonCode(reason)
      const res = await setPlayAction({ locationId, dateKey, playKey, action: "dismissed", reason: code, note })
      if (res.ok) {
        toast(
          code === "looks_wrong"
            ? "Thanks. We’ll check the source data behind this."
            : `Dismissed · “${reason}”. We’ll learn from it.`,
        )
        router.refresh()
      }
    })
  }

  function undo() {
    if (readOnly) return
    startTransition(async () => {
      const res = await setPlayAction({ locationId, dateKey, playKey, action: null })
      if (res.ok) router.refresh()
    })
  }

  function onVote(verdict: Verdict) {
    if (voted) return
    setVoted(verdict)
    if (readOnly) return
    startTransition(() => {
      void submitPlayFeedback({ locationId, dateKey, playKey, verdict, severity: play.severity ?? 0 })
    })
  }

  // ── The evidence this record supports ──
  const reinforcing = (sentiment || quotes.length) ? (
    <>
      {sentiment ? (
        <TkSentimentRows caption="What your reviews talk about" captionRight="share of recent reviews" rows={sentiment} />
      ) : null}
      {quotes.length ? (
        <div className="tk-quotes pass-quotes">
          {quotes.map((q, i) => (
            <TkQuote key={i} text={q.text} who={q.who} stars={q.stars} when={q.when} sentiment={q.sentiment} />
          ))}
        </div>
      ) : null}
    </>
  ) : null

  // ALT-179: the reinforcing detail is what makes a card blow out the grid. The lead is the
  // flagship spotlight and keeps it inline; a grid card tucks it behind a disclosure so one
  // card can't dominate the view. The full version is always one click away in the side sheet.
  const support = reinforcing ? (
    <div className="pass-evidence">
      {isLead ? (
        reinforcing
      ) : (
        <details className="pass-seemore">
          <summary>
            <span className="pass-seemore-car" aria-hidden="true">▸</span>
            <span className="pass-seemore-open">See the evidence</span>
            <span className="pass-seemore-close">Hide the evidence</span>
          </summary>
          <div className="pass-seemore-body">{reinforcing}</div>
        </details>
      )}
    </div>
  ) : null

  const sheetSupport = (
    <div className="pass-drawer-evidence">
      {reinforcing}
      {/* ALT-259: ONE section-level Ask about the evidence (never per-signal — avoids clutter). */}
      <div className="pass-ask-evidence">
        <AskTicket variant="inline" label="Ask about this evidence" question={askEvidenceQuestion(play.title)} />
      </div>
    </div>
  )

  // ALT-259: a step-level Ask, for the operator part-way through running the plan. Anchored
  // to the first step that names an audience, so the question it asks is a real one.
  const askStepIndex = (play.recipe ?? []).findIndex((s) => s.audience)
  const draftStep = play.recipe?.find((s) => s.copy)
  const sheetExtras = (
    <>
      {askStepIndex >= 0 ? (
        <div className="pass-ask-evidence">
          <AskTicket
            variant="inline"
            label="Ask about a step"
            question={askStepQuestion(play.title, askStepIndex + 1, play.recipe?.[askStepIndex]?.audience)}
          />
        </div>
      ) : null}
      {draftStep?.copy ? <DraftCopyBox label="Customer copy — your voice" text={draftStep.copy} /> : null}
    </>
  )

  return (
    <UnifiedInsightCard
      insight={insight}
      variant={isLead ? "lead" : "default"}
      photo={heroPhoto}
      readOnly={readOnly}
      // The win-flag is ADDITIVE framing beside the two scores — it never replaces one.
      flag={advantage ? <TkWinFlag /> : null}
      actions={
        readOnly
          ? undefined
          : {
              kept: current === "saved" ? true : current === "dismissed" || current === "snoozed" ? false : null,
              pending,
              onKeep: keep,
              onDismiss: dismiss,
              onUndo: undo,
              noteReasons: ["This looks wrong"],
            }
      }
      vote={readOnly ? undefined : { picked: voted, onVote }}
      support={support}
      sheetSupport={sheetSupport}
      sheetExtras={sheetExtras}
    />
  )
}
