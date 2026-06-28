"use client"

// The Pass — the interactive play card island (hero + grid variants).
//
// Owns the client-only affordances Concept A needs (the ACT drawer, the
// dismiss-reason popover) while PRESERVING the wired learning loop:
//   KEEP    → setPlayAction({ action: "saved", play })   (positive signal + persists)
//   DISMISS → setPlayAction({ action: "dismissed" })      (visibility-only, cross-day cooldown)
//   thumbs  → <BriefFeedback/> (writes brief_feedback)
// These are the SAME server-action calls/keys as the prior play-action-buttons.tsx —
// only the button presentation changes (kit buttons instead of pill text buttons).

import { useState, useTransition, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import {
  TkHero,
  TkPlayCard,
  TkButton,
  TkChip,
  TkConfidence,
  TkWinFlag,
  TkWhy,
  TkQuote,
  TkSentimentRows,
  TkDrawer,
  TkDismissReason,
  TkActions,
  useTkToast,
} from "@/components/ticket"
import type { EnrichedRecommendation, RecipeStep } from "@/lib/skills/types"
import type { PlayAction } from "@/lib/insights/momentum"
import { setPlayAction } from "./brief-actions"
import BriefFeedback from "./brief-feedback"
import { humanizeLabel } from "@/lib/skills/evidence-format"
import { FAMILY_ICON, ACT_ICON, KEEP_ICON, DISMISS_ICON, UNDO_ICON } from "./pass-icons"
import {
  playFamily,
  playChipLabel,
  confLevel,
  confLabel,
  isAdvantage,
  playQuotes,
  playSentiment,
  playWhyPoints,
  playWhySource,
  whyLabel,
} from "./pass-map"

/* ── The drawer body: the real recipe steps + any drafted customer copy ── */
function RecipeStepView({ step, n }: { step: RecipeStep; n: number }) {
  const channelLine = step.channel
    ? `${humanizeLabel(step.channel)}${step.platforms?.length ? ` · ${step.platforms.map(humanizeLabel).join(", ")}` : ""}`
    : null
  return (
    <div className="tk-plan-step">
      <span className="tk-pn">{n}</span>
      <div className="tk-pb">
        {step.audience ? <h5>{step.audience}</h5> : <h5>Step {n}</h5>}
        {step.window?.note ? <p>{step.window.note}</p> : null}
        {channelLine ? <p className="pass-step-meta">{channelLine}</p> : null}
        {step.offer ? <p className="pass-step-meta">Offer · {step.offer}</p> : null}
        {step.dependencies?.length ? (
          <ul className="pass-step-deps">
            {step.dependencies.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        ) : null}
        {step.creativeDirection ? (
          <p className="pass-step-meta">Direction · {step.creativeDirection}</p>
        ) : null}
      </div>
    </div>
  )
}

function DraftCopyBox({ label, text }: { label: string; text: string }) {
  const toast = useTkToast()
  function copy() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(text)
    }
    toast("Copied to clipboard.")
  }
  return (
    <div className="tk-draft-box">
      <div className="tk-db-head">
        {label}
        <button type="button" className="tk-copy-btn" onClick={copy}>
          Copy
        </button>
      </div>
      <div className="tk-db-body">{text}</div>
    </div>
  )
}

/* ── The play card ──────────────────────────────────────────────────────── */
export function PassPlayCard({
  play,
  rank,
  isLead,
  locationId,
  dateKey,
  playKey,
  current,
  readOnly = false,
  detailHref,
  heroPhoto,
  heroVenueChip,
}: {
  play: EnrichedRecommendation
  rank: number
  isLead: boolean
  locationId: string
  dateKey: string
  playKey: string
  current: PlayAction | null
  readOnly?: boolean
  detailHref?: string
  /** lead-only: the hero canvas + venue chip */
  heroPhoto?: ReactNode
  heroVenueChip?: ReactNode
}) {
  const router = useRouter()
  const toast = useTkToast()
  const [pending, startTransition] = useTransition()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [reasonOpen, setReasonOpen] = useState(false)

  const family = playFamily(play)
  const advantage = isAdvantage(play)
  const quotes = playQuotes(play)
  const sentiment = playSentiment(play)
  const whyPoints = playWhyPoints(play)
  const whySource = playWhySource(play)
  const titleId = `pass-play-${rank}`

  // ── learning-loop actions (unchanged calls/keys) ──
  function keep() {
    if (readOnly) return
    startTransition(async () => {
      const res = await setPlayAction({ locationId, dateKey, playKey, action: "saved", play })
      if (res.ok) {
        toast("Saved to your kept plays — “I’m on this”.")
        router.refresh()
      }
    })
  }
  function dismissWithReason(reason: string) {
    setReasonOpen(false)
    if (readOnly) return
    startTransition(async () => {
      // The stored action stays "dismissed" — the server's existing contract (visibility +
      // cross-day cooldown, NOT a learning weight). The reason is captured for the UX toast;
      // persisting the reason as a signal needs a server-side field (noted in the return).
      const res = await setPlayAction({ locationId, dateKey, playKey, action: "dismissed" })
      if (res.ok) {
        toast(`Dismissed · “${reason}” — we’ll learn from it.`)
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

  const kept = current === "saved"

  // ── the ACT verb adapts to the family (Concept A's verbs) ──
  const ACT_VERB: Record<string, string> = {
    social: "Draft a post",
    menu: "Make it the hero",
    grassroots: "Draft the outreach",
    reputation: "See the fix",
    competitive: "See the play",
  }
  const actVerb = ACT_VERB[family] ?? "See the play"

  // ── the confidence / win-flag status shown top-right ──
  const status = advantage ? (
    <TkWinFlag />
  ) : (
    <TkConfidence level={confLevel(play.confidence)} />
  )

  // Hero toprow: family chip + confidence pips (+ win-flag when we're ahead).
  const chips = (
    <>
      <TkChip family={family}>{playChipLabel(play)}</TkChip>
      <TkConfidence level={confLevel(play.confidence)} />
      {advantage ? <TkWinFlag /> : null}
    </>
  )

  // ── shared inner content (viz + quotes + why) ──
  const body = (
    <>
      {sentiment ? (
        <TkSentimentRows
          caption="Negative sentiment by category"
          captionRight="recent reviews"
          rows={sentiment}
        />
      ) : null}
      {quotes.length ? (
        <div className="tk-quotes pass-quotes">
          {quotes.map((q, i) => (
            <TkQuote key={i} text={q.text} who={q.who} stars={q.stars} when={q.when} />
          ))}
        </div>
      ) : null}
      <TkWhy label={whyLabel(play)} points={whyPoints} source={whySource} />
    </>
  )

  // ── the action row (kit buttons; same wiring) ──
  const actions = readOnly ? (
    <TkButton variant="act" onClick={() => setDrawerOpen(true)}>
      {ACT_ICON} {actVerb}
    </TkButton>
  ) : current ? (
    <>
      <TkButton variant="act" onClick={() => setDrawerOpen(true)}>
        {ACT_ICON} {actVerb}
      </TkButton>
      <span className="pass-kept-state">{kept ? "Kept" : "Removed"}</span>
      <TkButton variant="ghost" disabled={pending} onClick={undo}>
        {UNDO_ICON} Undo
      </TkButton>
    </>
  ) : (
    <>
      <TkButton variant="act" onClick={() => setDrawerOpen(true)}>
        {ACT_ICON} {actVerb}
      </TkButton>
      <TkButton variant="keep" kept={kept} disabled={pending} onClick={keep} aria-label="Keep this play">
        {KEEP_ICON} <span className="kw">Keep</span>
      </TkButton>
      <TkButton
        variant="dismiss"
        disabled={pending}
        onClick={() => setReasonOpen(true)}
        aria-label="Dismiss this play"
        aria-expanded={reasonOpen}
      >
        {DISMISS_ICON}
      </TkButton>
    </>
  )

  // thumbs sit alongside the actions — the wired brief_feedback signal.
  const foot = (
    <div className="pass-foot">
      <TkActions>{actions}</TkActions>
      <div className="pass-foot-right">
        <BriefFeedback
          locationId={locationId}
          dateKey={dateKey}
          playKey={playKey}
          severity={play.severity ?? 0}
          readOnly={readOnly}
        />
        {detailHref ? (
          <a className="pass-detail-link" href={detailHref}>
            Full detail &amp; evidence &rarr;
          </a>
        ) : null}
      </div>
    </div>
  )

  // the dismiss-reason popover is positioned inside the (relative) card
  const reasonPopover = !readOnly && !current ? (
    <TkDismissReason open={reasonOpen} onSelect={dismissWithReason} onCancel={() => setReasonOpen(false)} />
  ) : null

  // ── the drawer (ACT plan + draft) — shared by both variants ──
  const draftStep = play.recipe?.find((s) => s.copy)
  const drawer = (
    <TkDrawer
      open={drawerOpen}
      onClose={() => setDrawerOpen(false)}
      chip={<TkChip family={family}>{playChipLabel(play)} · {confLabel(play.confidence)}</TkChip>}
      title={play.title}
    >
      <p className="tk-muted">{play.rationale}</p>
      {play.recipe?.length ? (
        <div className="pass-plan-steps">
          {play.recipe.map((step, i) => (
            <RecipeStepView key={i} step={step} n={i + 1} />
          ))}
        </div>
      ) : (
        <p className="tk-muted">
          The full play unlocks as we gather more on this signal. The evidence below is what it&apos;s built on.
        </p>
      )}
      {draftStep?.copy ? <DraftCopyBox label="Customer copy — your voice" text={draftStep.copy} /> : null}
      {!readOnly && !current ? (
        <TkActions>
          <TkButton
            variant="keep"
            kept={kept}
            disabled={pending}
            onClick={() => {
              keep()
              setDrawerOpen(false)
            }}
          >
            {KEEP_ICON} Keep this play
          </TkButton>
        </TkActions>
      ) : null}
    </TkDrawer>
  )

  if (isLead) {
    return (
      <>
        <TkHero
          title={play.title}
          titleId={titleId}
          chips={chips}
          lede={play.rationale}
          photo={heroPhoto}
          venueChip={heroVenueChip}
          actions={null}
          style={{ position: "relative" }}
        >
          {body}
          {foot}
          {reasonPopover}
        </TkHero>
        {drawer}
      </>
    )
  }

  return (
    <>
      <TkPlayCard
        family={family}
        icon={FAMILY_ICON[family]}
        title={play.title}
        confidence={status}
        chips={<TkChip family={family}>{playChipLabel(play)}</TkChip>}
        summary={play.rationale}
        onTitleClick={() => setDrawerOpen(true)}
        actions={null}
        style={{ position: "relative" }}
      >
        {body}
        {foot}
        {reasonPopover}
      </TkPlayCard>
      {drawer}
    </>
  )
}
