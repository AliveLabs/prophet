"use client"

// Review Intelligence (ALT-353) — the /reviews triage body (client island).
// One island owns the whole list (same shape as insights-feed-kit) so a single
// TkToastProvider serves every card. The server page computes the bands and
// groups (reviews-map + make-good); this file only renders + wires actions.
//
// GUARDRAIL: authenticity/severity prioritize and improve RESPONSES. Nothing
// on a card suggests removing a review — the only exits are reply, make it
// right, or dismiss from YOUR list (the review itself is untouched).

import { useEffect, useState, useTransition, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import {
  TkActions,
  TkButton,
  TkCard,
  TkQuote,
  TkSectionHead,
  TkToastProvider,
  TkWhy,
  RevealOnView,
  useTkToast,
  tkcx as cx,
} from "@/components/ticket"
import { generateDraftAction, setReviewTriage, setReviewVerdict } from "./actions"
import { REVIEWS_COPY, REV_METER_FILL, type ReviewCardView, type ReviewGroups } from "./reviews-map"

/* Copy/check glyphs for the draft block's copy button (the same two-squares +
   check pair the Pass's DraftCopyBox uses; local so routes stay uncoupled). */
const COPY_ICON: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
  </svg>
)
const CHECK_ICON: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6L9 17l-5-5" />
  </svg>
)

/* Reveal-on-mount for the severity meter fill — the same ALT-177 fix the kit's
   TkRangeBar carries: a nested IntersectionObserver never fires inside an
   opacity:0 RevealOnView subtree, so gate the width on mount, never visibility. */
function useReveal(): boolean {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return shown
}

/* ── the small warm severity meter (tk-rangebar bones, band-only fill) ── */
function SeverityMeter({ severity }: { severity: ReviewCardView["severity"] }) {
  const shown = useReveal()
  if (!severity) {
    // unscored: an empty track + the "still reading" line, never a fabricated band
    return (
      <div className="tk-rev-meter-row">
        <span className="tk-rev-reading">{REVIEWS_COPY.stillReading}</span>
        <div className="tk-rangebar tk-rev-meter tk-rev-meter-empty" aria-hidden="true" />
      </div>
    )
  }
  const label = REVIEWS_COPY.severity[severity]
  return (
    <div className="tk-rev-meter-row">
      <span className={cx("tk-rev-meter-lbl", `tk-rev-sev-${severity}`)}>
        {REVIEWS_COPY.severityMeterName}: {label}
      </span>
      <div
        className={cx("tk-rangebar", "tk-rev-meter", `tk-rev-meter-${severity}`)}
        role="img"
        aria-label={`${REVIEWS_COPY.severityMeterName}: ${label}`}
      >
        <div className="tk-fill" style={{ width: shown ? `${REV_METER_FILL[severity]}%` : 0 }} />
      </div>
    </div>
  )
}

/* ── the "Needs you personally" flag (TkWinFlag treatment, rust tone) ── */
function OwnerFlag() {
  return (
    <span className="tk-rev-ownflag">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="8" r="3.4" />
        <path d="M5.5 20c.6-3.6 3.2-5.6 6.5-5.6s5.9 2 6.5 5.6" />
      </svg>
      {REVIEWS_COPY.ownerFlag}
    </span>
  )
}

/* ── one review card ────────────────────────────────────────────────── */
function ReviewCard({ review }: { review: ReviewCardView }) {
  const router = useRouter()
  const toast = useTkToast()
  const [pending, startTransition] = useTransition()
  const [verdictOpen, setVerdictOpen] = useState(false)
  // Drafting gets its OWN transition so a slow model call doesn't read as the
  // triage buttons being busy. localDraft = this session's freshest generation;
  // it wins over the persisted draftText until the refreshed row catches up.
  const [drafting, startDrafting] = useTransition()
  const [localDraft, setLocalDraft] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const open = review.triageStatus === "open"
  const draftText = localDraft ?? review.draftText

  function draftReply() {
    startDrafting(async () => {
      const res = await generateDraftAction(review.id)
      if (res.ok && res.draft) {
        setLocalDraft(res.draft)
        router.refresh()
      } else {
        // No draft is a real outcome (the server never fabricates one): the
        // operator writes their own, or just tries again.
        toast(res.error || REVIEWS_COPY.toasts.draftError)
      }
    })
  }

  function copyDraft() {
    if (!draftText) return
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(draftText)
    }
    setCopied(true)
    toast(REVIEWS_COPY.toasts.copied)
    window.setTimeout(() => setCopied(false), 1600)
  }

  function triage(status: "open" | "responded" | "dismissed") {
    startTransition(async () => {
      const res = await setReviewTriage({ reviewId: review.id, status })
      if (res.ok) {
        toast(
          status === "responded"
            ? REVIEWS_COPY.toasts.handled
            : status === "dismissed"
              ? REVIEWS_COPY.toasts.dismissed
              : REVIEWS_COPY.toasts.reopened,
        )
        router.refresh()
      } else {
        toast(REVIEWS_COPY.toasts.error)
      }
    })
  }

  function verdict(v: "genuine" | "not_genuine") {
    setVerdictOpen(false)
    startTransition(async () => {
      const res = await setReviewVerdict({ reviewId: review.id, verdict: v })
      if (res.ok) {
        toast(REVIEWS_COPY.toasts.verdict)
        router.refresh()
      } else {
        toast(REVIEWS_COPY.toasts.error)
      }
    })
  }

  // Right rail: the read (meter + genuineness + recommended action + owner flag).
  // Unscored rows render neutrally — no chip, no recommendation (fail-soft, never
  // fabricated); the meter slot carries the "still reading" line instead.
  const rail = (
    <div className="tk-rev-rail">
      <SeverityMeter severity={review.scored ? review.severity : null} />
      {review.scored && review.genuineness ? (
        <span className={cx("tk-rev-chip", `tk-rev-chip-${review.genuineness}`)}>
          {REVIEWS_COPY.genuineness[review.genuineness]}
        </span>
      ) : null}
      {review.scored && review.tier ? (
        <span className={cx("tk-rev-act", `tk-rev-act-${review.tier}`)}>
          {REVIEWS_COPY.tiers[review.tier]}
        </span>
      ) : null}
      {review.ownerAttention ? <OwnerFlag /> : null}
    </div>
  )

  // The verdict affordance: a quiet prompt that expands to the two options; once
  // set, the call reads back with a "Change" reopen (display adjusts next render).
  const verdictBlock = (
    <div className="tk-rev-verdict">
      {review.operatorVerdict && !verdictOpen ? (
        <>
          <span className="tk-rev-verdict-state">
            {review.operatorVerdict === "genuine"
              ? REVIEWS_COPY.verdict.setGenuine
              : REVIEWS_COPY.verdict.setNotGenuine}
          </span>
          <TkButton variant="ghost" disabled={pending} onClick={() => setVerdictOpen(true)}>
            {REVIEWS_COPY.verdict.change}
          </TkButton>
        </>
      ) : verdictOpen ? (
        <>
          <span className="tk-rev-verdict-state">{REVIEWS_COPY.verdict.prompt}</span>
          <TkButton variant="ghost" disabled={pending} onClick={() => verdict("genuine")}>
            {REVIEWS_COPY.verdict.genuine}
          </TkButton>
          <TkButton variant="ghost" disabled={pending} onClick={() => verdict("not_genuine")}>
            {REVIEWS_COPY.verdict.notGenuine}
          </TkButton>
          <TkButton variant="ghost" disabled={pending} onClick={() => setVerdictOpen(false)}>
            {REVIEWS_COPY.verdict.cancel}
          </TkButton>
        </>
      ) : (
        <TkButton
          variant="ghost"
          disabled={pending}
          aria-expanded={verdictOpen}
          onClick={() => setVerdictOpen(true)}
        >
          {REVIEWS_COPY.verdict.prompt}
        </TkButton>
      )}
    </div>
  )

  const googleLink = review.googleMapsUri ? (
    <a
      className="tk-maplink"
      href={review.googleMapsUri}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${REVIEWS_COPY.actions.openInGoogle} (opens in a new tab)`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <path d="M15 3h6v6M10 14L21 3" />
      </svg>
      {REVIEWS_COPY.actions.openInGoogle}
    </a>
  ) : null

  // The suggested reply (ALT-354): tk-draft-box bones from the kit stylesheet,
  // copy button in the head (the Pass's DraftCopyBox pattern), regenerate + the
  // Google link in the foot so the paste destination sits right beside the text.
  const draftBlock = draftText ? (
    <div className="tk-rev-draft tk-draft-box">
      <div className="tk-db-head">
        {REVIEWS_COPY.draft.label}
        <button
          type="button"
          className={cx("tk-copy-btn", copied && "tk-copied")}
          onClick={copyDraft}
          aria-label={copied ? REVIEWS_COPY.draft.copied : REVIEWS_COPY.draft.copy}
        >
          {copied ? CHECK_ICON : COPY_ICON}
          <span>{copied ? REVIEWS_COPY.draft.copied : REVIEWS_COPY.draft.copy}</span>
        </button>
      </div>
      <div className="tk-db-body">{draftText}</div>
      <div className="tk-rev-draft-foot">
        <span className="tk-rev-draft-hint">{REVIEWS_COPY.draft.hint}</span>
        <div className="tk-rev-draft-tools">
          <TkButton variant="ghost" disabled={drafting || pending} onClick={draftReply}>
            {drafting ? REVIEWS_COPY.actions.drafting : REVIEWS_COPY.draft.again}
          </TkButton>
          {googleLink}
        </div>
      </div>
    </div>
  ) : null

  return (
    <TkCard className="tk-rev-card">
      <div className="tk-rev-grid">
        <div className="tk-rev-main">
          {!open ? (
            <span className={cx("tk-rev-state", `tk-rev-state-${review.triageStatus}`)}>
              {review.triageStatus === "responded"
                ? REVIEWS_COPY.states.responded
                : REVIEWS_COPY.states.dismissed}
            </span>
          ) : null}
          <TkQuote
            text={review.text ?? REVIEWS_COPY.noText}
            who={review.authorFirst}
            stars={review.stars ?? undefined}
            when={review.when ?? undefined}
          />
          {review.scored && review.whyPoints.length > 0 ? (
            <TkWhy
              label={REVIEWS_COPY.whyLabel}
              points={review.whyPoints}
              source={REVIEWS_COPY.whySource}
            />
          ) : null}
        </div>
        {rail}
      </div>
      {draftBlock}
      <div className="tk-rev-foot">
        {open ? (
          <TkActions className="tk-rev-actions">
            {/* Once a draft exists, the block's "Draft again" owns regeneration;
                the primary button retires instead of duplicating it. */}
            {!draftText ? (
              <TkButton variant="act" disabled={drafting || pending} onClick={draftReply}>
                {drafting ? REVIEWS_COPY.actions.drafting : REVIEWS_COPY.actions.draftReply}
              </TkButton>
            ) : null}
            <TkButton variant="keep" disabled={pending} onClick={() => triage("responded")}>
              {REVIEWS_COPY.actions.markHandled}
            </TkButton>
            <TkButton variant="dismiss" disabled={pending} onClick={() => triage("dismissed")}>
              {REVIEWS_COPY.actions.dismiss}
            </TkButton>
            {verdictBlock}
          </TkActions>
        ) : (
          <TkActions className="tk-rev-actions">
            <TkButton variant="ghost" disabled={pending} onClick={() => triage("open")}>
              {REVIEWS_COPY.actions.reopen}
            </TkButton>
            {verdictBlock}
          </TkActions>
        )}
        {/* the Google link lives beside the draft once one exists */}
        {draftText ? null : googleLink}
      </div>
    </TkCard>
  )
}

/* ── the triage body: three sections, calm order ───────────────────── */
export default function ReviewsTriage({ groups }: { groups: ReviewGroups }) {
  const { attention, secondLook, handled } = groups
  return (
    <TkToastProvider>
      <div className="rev-body">
        {attention.length > 0 ? (
          <RevealOnView as="section" className="rev-sec" threshold={0}>
            <TkSectionHead
              title={REVIEWS_COPY.sections.attention.title}
              sub={REVIEWS_COPY.sections.attention.sub}
            />
            <div className="rev-list">
              {attention.map((r) => (
                <ReviewCard key={r.id} review={r} />
              ))}
            </div>
          </RevealOnView>
        ) : null}

        {secondLook.length > 0 ? (
          <RevealOnView as="section" className="rev-sec rev-sec-quiet" threshold={0}>
            <TkSectionHead
              title={REVIEWS_COPY.sections.secondLook.title}
              sub={REVIEWS_COPY.sections.secondLook.sub}
            />
            <div className="rev-list">
              {secondLook.map((r) => (
                <ReviewCard key={r.id} review={r} />
              ))}
            </div>
          </RevealOnView>
        ) : null}

        {handled.length > 0 ? (
          <RevealOnView as="section" className="rev-sec rev-sec-handled" threshold={0}>
            <TkSectionHead
              title={REVIEWS_COPY.sections.handled.title}
              sub={REVIEWS_COPY.sections.handled.sub}
            />
            <div className="rev-list">
              {handled.map((r) => (
                <ReviewCard key={r.id} review={r} />
              ))}
            </div>
          </RevealOnView>
        ) : null}
      </div>
    </TkToastProvider>
  )
}
