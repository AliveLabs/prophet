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
import { generateDraftAction, setReviewTriage } from "./actions"
import {
  REVIEWS_COPY,
  genuineMarkerPct,
  sentimentMarkerPct,
  type ReviewCardView,
  type ReviewGroups,
} from "./reviews-map"

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

/* Reveal-on-mount for the spectrum markers — the same ALT-177 fix the kit's
   TkRangeBar carries: a nested IntersectionObserver never fires inside an
   opacity:0 RevealOnView subtree, so gate the marker on mount, never visibility. */
function useReveal(): boolean {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return shown
}

/* ── a spectrum bar (ALT-359/360): fixed gradient track + position marker ──
   The track never changes; only the marker plots this review's read. `pct`
   null = no read yet (genuine bar pre-scoring) → the "still reading" line. */
function Spectrum({
  kind,
  pct,
  reading,
}: {
  kind: "sentiment" | "genuine"
  /** 0..100 marker position, or null for "still reading" */
  pct: number | null
  /** accessible reading of the marker position (band words, never a number) */
  reading: string
}) {
  const shown = useReveal()
  const copy = REVIEWS_COPY.spectrum[kind]
  if (pct == null) {
    return (
      <div className="tk-rev-spec-row">
        <span className="tk-rev-spec-lbl">{copy.label}</span>
        <span className="tk-rev-reading">{REVIEWS_COPY.stillReading}</span>
        <div className={cx("tk-rev-spec", `tk-rev-spec-${kind}`, "tk-rev-spec-empty")} aria-hidden="true" />
      </div>
    )
  }
  return (
    <div className="tk-rev-spec-row">
      <span className="tk-rev-spec-lbl">{copy.label}</span>
      <div
        className={cx("tk-rev-spec", `tk-rev-spec-${kind}`)}
        role="img"
        aria-label={`${copy.label}: ${reading}`}
      >
        <span
          className="tk-rev-spec-marker"
          style={{ left: `${pct}%`, opacity: shown ? 1 : 0 }}
          aria-hidden="true"
        />
      </div>
      <span className="tk-rev-spec-ends" aria-hidden="true">
        <span>{copy.left}</span>
        <span>{copy.right}</span>
      </span>
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
  // Drafting gets its OWN transition so a slow model call doesn't read as the
  // triage buttons being busy. localDraft = this session's freshest generation;
  // it wins over the persisted draftText until the refreshed row catches up.
  const [drafting, startDrafting] = useTransition()
  const [localDraft, setLocalDraft] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // ALT-361 — the operator's per-draft make-good switch. Default ON: the
  // generosity slider exists to be felt. Only rendered when the recommendation
  // actually carries an offer.
  const [includeOffer, setIncludeOffer] = useState(true)
  const hasOffer = review.scored && review.tier != null && review.tier !== "respond"

  const open = review.triageStatus === "open"
  const draftText = localDraft ?? review.draftText

  function draftReply() {
    startDrafting(async () => {
      const res = await generateDraftAction(review.id, { includeOffer: hasOffer && includeOffer })
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

  // Right rail: the read (two spectrum bars + recommended action + owner flag).
  // The sentiment bar ALWAYS plots (star anchor pre-scoring); the genuine bar
  // shows "still reading" until the pass has written a real read (fail-soft,
  // never fabricated).
  const rail = (
    <div className="tk-rev-rail">
      <Spectrum
        kind="sentiment"
        pct={sentimentMarkerPct(review.sentimentValue)}
        reading={REVIEWS_COPY.spectrum.sentiment.bands[review.sentimentBand]}
      />
      <Spectrum
        kind="genuine"
        pct={review.genuineValue != null ? genuineMarkerPct(review.genuineValue) : null}
        reading={review.genuineness ? REVIEWS_COPY.spectrum.genuine.bands[review.genuineness] : ""}
      />
      {review.scored && review.tier ? (
        <span className={cx("tk-rev-act", `tk-rev-act-${review.tier}`)}>
          {REVIEWS_COPY.tiers[review.tier]}
        </span>
      ) : null}
      {review.ownerAttention ? <OwnerFlag /> : null}
    </div>
  )

  // ALT-361 — quiet checkbox beside the draft controls; rendered only when the
  // recommendation carries a concrete offer for it to include.
  const offerToggle = hasOffer ? (
    <label className="tk-rev-offer">
      <input
        type="checkbox"
        checked={includeOffer}
        disabled={drafting || pending}
        onChange={(e) => setIncludeOffer(e.target.checked)}
      />
      {REVIEWS_COPY.actions.includeOffer}
    </label>
  ) : null

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
          {offerToggle}
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
            {!draftText ? offerToggle : null}
            <TkButton variant="keep" disabled={pending} onClick={() => triage("responded")}>
              {REVIEWS_COPY.actions.markHandled}
            </TkButton>
            <TkButton variant="dismiss" disabled={pending} onClick={() => triage("dismissed")}>
              {REVIEWS_COPY.actions.dismiss}
            </TkButton>
          </TkActions>
        ) : (
          <TkActions className="tk-rev-actions">
            <TkButton variant="ghost" disabled={pending} onClick={() => triage("open")}>
              {REVIEWS_COPY.actions.reopen}
            </TkButton>
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
