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
  TkImpactTag,
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
import { DISMISS_REASONS, dismissReasonCode } from "@/lib/skills/feedback-signals"
import { setPlayAction } from "./brief-actions"
import BriefFeedback from "./brief-feedback"
import { humanizeLabel } from "@/lib/skills/evidence-format"
import { ACT_ICON, KEEP_ICON, DISMISS_ICON, UNDO_ICON, COPY_ICON, CHECK_ICON } from "./pass-icons"
import {
  playFamily,
  playChipLabel,
  confLevel,
  confLabel,
  impactLevel,
  impactLabel,
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
  const [copied, setCopied] = useState(false)
  function copy() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(text)
    }
    setCopied(true)
    toast("Copied to clipboard.")
    window.setTimeout(() => setCopied(false), 1600)
  }
  return (
    <div className="tk-draft-box">
      <div className="tk-db-head">
        {label}
        {/* Two-overlapping-squares copy glyph (Claude-desktop style), top-right (ALT-168c). */}
        <button
          type="button"
          className={`tk-copy-btn${copied ? " tk-copied" : ""}`}
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy to clipboard"}
        >
          {copied ? CHECK_ICON : COPY_ICON}
          <span>{copied ? "Copied" : "Copy"}</span>
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
  extraChips,
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
  /** ALT-184h: page-specific framing chips (e.g. the pool's "Top this week" + recency stamp)
   *  appended after the category chip — the card design stays shared, the framing stays local */
  extraChips?: ReactNode
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
  function dismissWithReason(reason: string, note?: string) {
    setReasonOpen(false)
    if (readOnly) return
    startTransition(async () => {
      // The stored action stays "dismissed" (the server's visibility + cross-day-cooldown contract is
      // unchanged), but the chosen reason now rides along as a stable CODE: the server persists it and
      // the rollup composes feedback-signals `dismissed:<code>`, so the reason — not the bare Remove —
      // is what the engine learns from. Unknown label → undefined → a bare, no-signal dismissal.
      // ALT-172: "this looks wrong" carries an optional note captured as DATA-QUALITY feedback (it does
      // NOT reweight the model — that reason is neutral in the band) so we phrase its toast accordingly.
      const code = dismissReasonCode(reason)
      const res = await setPlayAction({
        locationId,
        dateKey,
        playKey,
        action: "dismissed",
        reason: code,
        note,
      })
      if (res.ok) {
        toast(
          code === "looks_wrong"
            ? "Thanks — we’ll check the source data behind this."
            : `Dismissed · “${reason}” — we’ll learn from it.`,
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

  const kept = current === "saved"

  // ── the primary CTA label (ALT-166) ──
  // ONE consistent label across every play card, regardless of family. The old
  // family-specific verbs ("Draft a post" / "Make it the hero" / "Draft the outreach")
  // read inconsistently and didn't scale; the drawer header already carries the play's
  // own title + family chip, so the button only needs to name the action: open the play.
  const actVerb = "See the play"

  // ── the two scores shown top-right (ALT-167) ──
  // Confidence and impact are SEPARATE axes and BOTH always render. The win-flag is
  // ADDITIVE framing ("you're winning") — it must never REPLACE the confidence score
  // (the prior bug: an advantage play showed only the flag, so its confidence + impact
  // vanished from the card entirely). Order: confidence · impact · (win-flag when ahead).
  const status = (
    <>
      <TkConfidence level={confLevel(play.confidence)} />
      <TkImpactTag level={impactLevel(play)} />
      {advantage ? <TkWinFlag /> : null}
    </>
  )

  // Hero toprow mirrors the same two-score read (+ win-flag when we're ahead).
  const chips = (
    <>
      <TkChip family={family}>{playChipLabel(play)}</TkChip>
      <TkConfidence level={confLevel(play.confidence)} />
      <TkImpactTag level={impactLevel(play)} />
      {advantage ? <TkWinFlag /> : null}
    </>
  )

  // ── shared inner content (viz + quotes + why) ──
  // The evidence stack owns its own vertical rhythm (pass-evidence) so the bar graph,
  // review quotes, and the why-rolldown each get real breathing room instead of being
  // crammed together by the card's tight base gap (ALT-180).
  //
  // ALT-179: the reinforcing detail (the sentiment bar graph + the verbatim review quotes) is
  // what makes a card blow out the grid. On a non-lead GRID card we tuck it behind a "See more"
  // disclosure so one card can't dominate the view — the full version always lives one click away
  // in "Full details & evidence" (and the drawer). The lead/hero is the flagship spotlight, so it
  // keeps everything inline.
  const reinforcing = (sentiment || quotes.length) ? (
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
            <TkQuote key={i} text={q.text} who={q.who} stars={q.stars} when={q.when} sentiment={q.sentiment} />
          ))}
        </div>
      ) : null}
    </>
  ) : null

  const body = (
    <div className="pass-evidence">
      {isLead ? (
        reinforcing
      ) : reinforcing ? (
        <details className="pass-seemore">
          <summary>
            <span className="pass-seemore-car" aria-hidden="true">▸</span>
            <span className="pass-seemore-open">See the evidence</span>
            <span className="pass-seemore-close">Hide the evidence</span>
          </summary>
          <div className="pass-seemore-body">{reinforcing}</div>
        </details>
      ) : null}
      <TkWhy label={whyLabel(play)} points={whyPoints} source={whySource} />
    </div>
  )

  // ── the action row (kit buttons; same wiring) ──
  // ALT-253f: "See the play" acts on the RECOMMENDATION; Keep/Dismiss (or the kept/
  // dismissed state + Undo) act on the CARD — the two groups get their own wrapper
  // so a gap can separate them instead of reading as one undifferentiated row.
  const actions = readOnly ? (
    <span className="pass-actions-play">
      <TkButton variant="act" onClick={() => setDrawerOpen(true)}>
        {ACT_ICON} {actVerb}
      </TkButton>
    </span>
  ) : current ? (
    <>
      <span className="pass-actions-play">
        <TkButton variant="act" onClick={() => setDrawerOpen(true)}>
          {ACT_ICON} {actVerb}
        </TkButton>
      </span>
      <span className="pass-actions-card">
        <span className="pass-kept-state">{kept ? "Kept" : "Dismissed"}</span>
        <TkButton variant="ghost" disabled={pending} onClick={undo}>
          {UNDO_ICON} Undo
        </TkButton>
      </span>
    </>
  ) : (
    <>
      <span className="pass-actions-play">
        <TkButton variant="act" onClick={() => setDrawerOpen(true)}>
          {ACT_ICON} {actVerb}
        </TkButton>
      </span>
      <span className="pass-actions-card">
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
          {DISMISS_ICON} <span className="kw">Dismiss</span>
        </TkButton>
      </span>
    </>
  )

  // Footer (ALT-253d): the action row anchors to the BOTTOM of the card; below it, a
  // footer line puts "Full details & evidence" on the LEFT and the "helpful" thumbs
  // module on the RIGHT (reverses the prior ALT-168b left/right split).
  const foot = (
    <div className="pass-foot">
      <TkActions>{actions}</TkActions>
      <div className="pass-foot-line">
        {detailHref ? (
          <a className="pass-detail-link" href={detailHref}>
            Full details &amp; evidence &rarr;
          </a>
        ) : (
          <span />
        )}
        <BriefFeedback
          locationId={locationId}
          dateKey={dateKey}
          playKey={playKey}
          severity={play.severity ?? 0}
          readOnly={readOnly}
        />
      </div>
    </div>
  )

  // the dismiss-reason popover is positioned inside the (relative) card
  const reasonPopover = !readOnly && !current ? (
    <TkDismissReason
      open={reasonOpen}
      reasons={DISMISS_REASONS.map((r) => r.label)}
      onSelect={dismissWithReason}
      onCancel={() => setReasonOpen(false)}
    />
  ) : null

  // ── the drawer (ACT plan + draft) — shared by both variants ──
  const draftStep = play.recipe?.find((s) => s.copy)
  const drawer = (
    <TkDrawer
      open={drawerOpen}
      onClose={() => setDrawerOpen(false)}
      wide
      portal
      chip={<TkChip family={family}>{playChipLabel(play)} · {confLabel(play.confidence)} confidence · {impactLabel(play)} impact</TkChip>}
      title={play.title}
    >
      <p className="tk-muted">{play.rationale}</p>
      {/* Evidence — the SAME grounding shown on the card, surfaced here (expanded) so the
          drawer is a complete "why + how" on every surface. Matters most on the pool, whose
          cards have no /home/[rank] detail page: the drawer is their full evidence view. */}
      <div className="pass-drawer-evidence">
        {reinforcing}
        <TkWhy label={whyLabel(play)} points={whyPoints} source={whySource} defaultOpen />
      </div>
      {play.recipe?.length ? (
        <div className="pass-plan-steps">
          {play.recipe.map((step, i) => (
            <RecipeStepView key={i} step={step} n={i + 1} />
          ))}
        </div>
      ) : (
        <p className="tk-muted">The full step-by-step unlocks as we gather more on this signal.</p>
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
        title={play.title}
        confidence={status}
        chips={
          <>
            <TkChip family={family}>{playChipLabel(play)}</TkChip>
            {extraChips}
          </>
        }
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
