"use client"

// THE unified insight card — one component for every surface that shows an insight:
// the home brief, the all-insights view, and /insights.
//
// The vocabulary, end to end:
//   insight  →  has a plan  →  "See the plan"  →  steps
// "Play", "move" and "action" as nouns are gone. There is one noun: insight.
//
// ONE CARD, THREE TIERS, derived from what the record can actually back:
//   plan        — a real recipe. Gets a one-line plan summary + "See the plan".
//   suggestion  — one generic line. Same container treatment, no plan promise.
//   observation — signal only. No action container at all.
// All three keep both score axes, the thumbs, the details link and the same two verbs,
// so nothing about the feedback loop depends on tier.
//
// READING ORDER (rev 3): the insight, then what to do about it, then the support for it.
// "Why we believe this" sits BELOW the plan/suggestion because it is corroboration, not
// the point. The earlier draft had it above, which inverted the hierarchy.
//
// SELF-SUFFICIENT: it pulls the kit stylesheet itself and carries its own thumbs styling,
// because the brief's `.fb-*` rules are scoped to `.ticket-brief` and a card that only
// works inside one surface is not a unified card.
//
// CONTROLLED, with an uncontrolled fallback. Pass `actions`/`vote` and the card drives the
// real server writes through the surface that mounted it; omit them and it falls back to
// local state, which is what `/preview/insight-card` uses to be reviewable with no backend.
//
// SLOTS, because the EVIDENCE a card can show depends on the record behind it. A play
// carries breakout quotes and sentiment-by-category; a raw insights row carries a metric
// row and a sentiment split. One chrome, one hierarchy, one action framework, one
// vocabulary — and each surface passes the evidence its own data actually supports through
// `support` / `sheetSupport` / `sheetExtras`. That is what keeps this a unified card
// instead of a lowest-common-denominator one.

import { useState, type ReactNode } from "react"
import { TkChip, TkConfidence, TkImpactTag, TkDrawer, TkDismissReason, TkWhy, tkcx as cx } from "@/components/ticket"
import { accentize } from "@/components/ticket/accentize"
import { DISMISS_REASONS } from "@/lib/skills/feedback-signals"
import "./unified-insight-card.css"

/* ── Tags ──────────────────────────────────────────────────────────────────
   The AXIS drives the colour:
     what   neutral grey  — where this came from. Never competes for attention.
     when   blue          — how soon it matters.
     state  green         — its status in the product ("on this week's brief").
   Red is reserved for the single soonest tier and nothing else, so it keeps meaning
   "now" instead of decorating every timing chip. Green stays on `state` only, where it
   is genuinely good news, and never on timing where it would imply "safe". */
export type InsightTagAxis = "what" | "when" | "state"

export type InsightTag = {
  axis: InsightTagAxis
  label: string
  /** `when` only: the soonest tier. The one and only red in the system. */
  urgent?: boolean
}

export type InsightPlanStep = {
  channel: string
  platforms?: string[]
  audience?: string
  window?: string
  offer?: string
  /** Direction only, never a produced asset. */
  creativeDirection?: string
  /** Customer-facing copy, in the operator's voice, never Ticket's. */
  copy?: string
  /** What has to be true before the step can run ("a wallet pass exists"). */
  dependencies?: string[]
}

export type InsightEvidence = { label: string; text: string }

export type UnifiedInsight = {
  id: string
  title: string
  why: string
  tags: InsightTag[]
  /** Both axes are LEVELS, never scores. No numerals reach the card. */
  confidence: "high" | "medium" | "directional"
  impact: "high" | "medium" | "low"
  /** Denominated basis, never an outcome. Null when nothing real is cited. */
  validation?: string | null
  evidence?: InsightEvidence[]
  whyPoints?: string[]
  plan?: InsightPlanStep[]
  suggestion?: string | null
  detailHref?: string
}

export function insightTier(i: UnifiedInsight): "plan" | "suggestion" | "observation" {
  if (i.plan && i.plan.length > 0) return "plan"
  if (i.suggestion && i.suggestion.trim()) return "suggestion"
  return "observation"
}

/* Counts read as words so no numeral appears in a summary line. */
const COUNT_WORD = ["no", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"]
function countWord(n: number): string {
  return COUNT_WORD[n] ?? String(n)
}

/**
 * The plan's one-line summary, COMPOSED DETERMINISTICALLY from the steps that already
 * exist. No model call, so adding this line costs nothing per brief. It names the step
 * count and the channels, which is the honest answer to "what does this involve".
 */
export function planSummary(plan: InsightPlanStep[]): string {
  const channels = [...new Set(plan.map((s) => s.channel.trim()).filter(Boolean))]
  // Channel labels are kept VERBATIM. An earlier version lowercased the first letter of
  // every channel after the first, to read more like a sentence, and turned "Google
  // Business Profile" into "google Business Profile". A brand name mid-sentence keeps its
  // capital, and no rule short of a proper-noun list can tell the two cases apart.
  const list =
    channels.length <= 1
      ? channels[0] ?? "one channel"
      : `${channels.slice(0, -1).join(", ")} and ${channels[channels.length - 1]}`
  const step = plan.length === 1 ? "step" : "steps"
  return `${countWord(plan.length)} ${step}: ${list}.`
}

export type InsightVerdict = "good" | "bad"

/** The two server writes a surface owns. Omit to run the card uncontrolled (preview). */
export type InsightCardActions = {
  /** true = kept · false = dismissed · null = untouched. */
  kept: boolean | null
  pending?: boolean
  onKeep: () => void
  onDismiss: (reason: string, note?: string) => void
  onUndo: () => void
  /** Reasons that open the optional free-text note step before confirming (ALT-172). */
  noteReasons?: string[]
}

export type InsightCardVote = {
  picked: InsightVerdict | null
  onVote: (verdict: InsightVerdict) => void
}

/* ── Thumbs. On EVERY tier: this is the signal that tunes insight scope and
   preferences, so it cannot be something only actionable cards carry. ── */
function Thumbs({ picked, onVote }: { picked: InsightVerdict | null; onVote: (v: InsightVerdict) => void }) {
  if (picked) {
    return (
      <span className="uic-fb-sent">
        {picked === "good" ? "Noted, more like this" : "Noted, less like this"}
      </span>
    )
  }
  return (
    <span className="uic-fb">
      <span className="uic-fb-label">Helpful?</span>
      <button type="button" className="uic-fb-btn" aria-label="Helpful" onClick={() => onVote("good")}>
        {/* Explicit width/height: the kit reset sets svg display:block with no size, so an
            attribute-less icon collapses to 0 by 0. */}
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z" />
          <path d="M7 10l4.2-7.1a1.6 1.6 0 0 1 2.9 1.2L13.3 9H19a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 20H7z" />
        </svg>
      </button>
      <button type="button" className="uic-fb-btn" aria-label="Not helpful" onClick={() => onVote("bad")}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M7 14V3H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1z" />
          <path d="M7 14l4.2 7.1a1.6 1.6 0 0 0 2.9-1.2L13.3 15H19a2 2 0 0 0 2-2.3l-1.2-7A2 2 0 0 0 17.8 4H7z" />
        </svg>
      </button>
    </span>
  )
}

/** Uncontrolled thumbs, for the preview route: same markup, local state. */
function LocalThumbs() {
  const [picked, setPicked] = useState<InsightVerdict | null>(null)
  return <Thumbs picked={picked} onVote={setPicked} />
}

function StepDetail({ step, n }: { step: InsightPlanStep; n: number }) {
  return (
    <li className="uic-step">
      <span className="uic-step-i" aria-hidden="true">{n}</span>
      <div className="uic-step-body">
        <div className="uic-step-head">
          {step.channel}
          {step.platforms?.length ? <span className="uic-step-plats">{step.platforms.join(" · ")}</span> : null}
        </div>
        <dl className="uic-step-fields">
          {step.audience && (<><dt>Who</dt><dd>{step.audience}</dd></>)}
          {step.window && (<><dt>When</dt><dd>{step.window}</dd></>)}
          {step.offer && (<><dt>Offer</dt><dd>{step.offer}</dd></>)}
          {step.creativeDirection && (<><dt>Look</dt><dd>{step.creativeDirection}</dd></>)}
          {step.dependencies?.length ? (
            <>
              <dt>Needs</dt>
              <dd>
                <ul className="uic-step-deps">
                  {step.dependencies.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              </dd>
            </>
          ) : null}
        </dl>
        {step.copy && (
          <div className="uic-copy">
            <span className="uic-copy-label">Copy you can use, in your voice</span>
            <p>{step.copy}</p>
          </div>
        )}
      </div>
    </li>
  )
}

export default function UnifiedInsightCard({
  insight,
  variant = "default",
  photo,
  initialKept = null,
  actions,
  vote,
  readOnly = false,
  flag,
  support,
  sheetSupport,
  sheetExtras,
}: {
  insight: UnifiedInsight
  variant?: "lead" | "default"
  /** lead-only: the hero image canvas. The brief's only visual relief, so it stays. */
  photo?: ReactNode
  /** Uncontrolled seed. Ignored once `actions` is passed. */
  initialKept?: boolean | null
  /** The wired keep/dismiss/undo writes. Omit → local state (preview). */
  actions?: InsightCardActions
  /** The wired thumbs write. Omit → local state (preview). */
  vote?: InsightCardVote
  /** Read-only surfaces (marketing preview) drop the card verbs but keep the plan. */
  readOnly?: boolean
  /** Additive framing beside the two scores, e.g. the win-flag. NEVER replaces a score. */
  flag?: ReactNode
  /** Rich evidence for THIS record, rendered on the card under the action region. */
  support?: ReactNode
  /** Rich evidence inside the side sheet, expanded. */
  sheetSupport?: ReactNode
  /** Anything the sheet needs after the evidence, e.g. drafted copy or a keep/dismiss pair. */
  sheetExtras?: ReactNode
}) {
  const [localKept, setLocalKept] = useState<boolean | null>(initialKept)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [reasonOpen, setReasonOpen] = useState(false)
  const tier = insightTier(insight)

  const kept = actions ? actions.kept : localKept
  const pending = actions?.pending ?? false
  const keep = actions ? actions.onKeep : () => setLocalKept((v) => (v === true ? null : true))
  const undo = actions ? actions.onUndo : () => setLocalKept(null)
  const dismiss = actions
    ? actions.onDismiss
    : (_reason: string, _note?: string) => setLocalKept(false)

  /* Order: soonest timing, then timing, then what, then state.
     The four chip fills sit inside a narrow luminance band, so colour alone was not
     making the soonest tier stand out. Reading position does: putting it first means it
     is the first thing scanned, which is a stronger prominence lever than hue for a
     reader skimming a list. */
  const orderedTags = [
    ...insight.tags.filter((t) => t.axis === "when" && t.urgent),
    ...insight.tags.filter((t) => t.axis === "when" && !t.urgent),
    ...insight.tags.filter((t) => t.axis === "what"),
    ...insight.tags.filter((t) => t.axis === "state"),
  ]

  const evidenceBlock = insight.evidence?.length ? (
    <div className="uic-evidence">
      {insight.evidence.map((e, i) => (
        <blockquote key={i} className="uic-cite">
          <p>{e.text}</p>
          <cite>{e.label}</cite>
        </blockquote>
      ))}
    </div>
  ) : null

  const detailsLabel = tier === "observation" ? "Full details" : "Full details & evidence"

  return (
    <>
      <article
        className={cx("uic", `uic-${variant}`, kept === false && "uic-dismissed")}
        style={{ position: "relative" }}
      >
        {variant === "lead" && photo ? <div className="uic-photo">{photo}</div> : null}

        <div className="uic-main">
          {/* ── Meta. A two-column GRID, not a flex row: the tags wrap inside column one
                 and the scores are anchored in column two, so a long or third chip can
                 never push confidence and impact onto their own line. ── */}
          <div className="uic-meta">
            <div className="uic-tags">
              {orderedTags.map((t, i) => (
                <span
                  key={`${t.axis}-${i}`}
                  className={cx("uic-tag", `uic-tag-${t.axis}`, t.urgent && "uic-tag-urgent")}
                >
                  {t.label}
                </span>
              ))}
            </div>
            <div className="uic-scores">
              {/* Both axes ALWAYS render. `flag` is additive framing beside them, never a
                  substitute for one — the prior bug on the brief was an advantage play
                  showing only the flag, so its two scores vanished from the card. */}
              <TkConfidence level={insight.confidence} name="Confidence" />
              <TkImpactTag level={insight.impact} name="Impact" />
              {flag}
            </div>
          </div>

          <h3 className="uic-title">{accentize(insight.title)}</h3>

          {insight.validation && <p className="uic-validation">{insight.validation}</p>}

          <p className="uic-why">{insight.why}</p>

          {/* ── What to do. Both tiers share ONE container treatment: a plan gets its
                 derived one-line summary with "See the plan" pinned right inside the
                 same box, so the button is visibly tied to the summary it opens. A
                 suggestion gets the identical box with no button. ── */}
          {tier === "plan" && (
            <div className="uic-do">
              <div className="uic-do-text">
                <div className="uic-region-label">The plan</div>
                <p className="uic-do-line">{planSummary(insight.plan!)}</p>
              </div>
              {/* PRIMARY, not secondary: this is the main action on a card that has a
                  plan, and once secondary became a neutral --ledger fill the card had no
                  accented action anywhere. Sits on the --card-2 container, so the rust
                  fill reads clearly against a slightly recessed ground. */}
              <button type="button" className="uic-btn uic-btn-primary uic-do-btn" onClick={() => setSheetOpen(true)}>
                See the plan
              </button>
            </div>
          )}

          {tier === "suggestion" && (
            <div className="uic-do">
              <div className="uic-do-text">
                {/* Singular: it signals one sentence, not a plan. */}
                <div className="uic-region-label">Suggested next step</div>
                <p className="uic-do-line">{insight.suggestion}</p>
              </div>
            </div>
          )}

          {/* ── Support, BELOW what to do. Corroboration, not the point.
                 `support` is the surface's own evidence for this record (review quotes, a
                 sentiment breakdown, a rival's post); the why-rolldown closes the block. ── */}
          {support}
          {insight.whyPoints?.length ? (
            <TkWhy label="Why we believe this" points={insight.whyPoints} />
          ) : null}

          {/* ── Card actions. Keep is a two-frame toggle; Dismiss leaves the row once
                 resolved. A read-only surface drops both — there is nothing to write. ── */}
          {readOnly ? null : (
            <div className="uic-actions">
              <button
                type="button"
                className={cx("uic-btn", kept === true ? "uic-btn-toggle-on" : "uic-btn-tertiary")}
                aria-pressed={kept === true}
                disabled={pending}
                onClick={kept === true ? undo : keep}
              >
                {kept === true ? "Kept" : "Keep"}
              </button>
              {kept === true ? null : kept === false ? (
                <>
                  <span className="uic-state-dismissed">Dismissed</span>
                  <button type="button" className="uic-btn uic-btn-tertiary" disabled={pending} onClick={undo}>
                    Undo
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="uic-btn uic-btn-tertiary uic-btn-danger"
                  disabled={pending}
                  onClick={() => setReasonOpen(true)}
                  aria-expanded={reasonOpen}
                >
                  Dismiss
                </button>
              )}
            </div>
          )}

          {/* ── Footer: details link left, thumbs right. Both on every tier.
                 No href ⇒ no link. A dead `#` anchor is a promise the card can't keep. ── */}
          <div className="uic-foot">
            {insight.detailHref ? (
              <a className="uic-detail-link" href={insight.detailHref}>
                {detailsLabel} &rarr;
              </a>
            ) : (
              <span />
            )}
            {vote ? <Thumbs picked={vote.picked} onVote={vote.onVote} /> : <LocalThumbs />}
          </div>
        </div>

        {readOnly ? null : (
          <TkDismissReason
            open={reasonOpen}
            reasons={DISMISS_REASONS.map((r) => r.label)}
            noteReasons={actions?.noteReasons ?? []}
            onSelect={(reason, note) => { setReasonOpen(false); dismiss(reason, note) }}
            onCancel={() => setReasonOpen(false)}
          />
        )}
      </article>

      {tier === "plan" && (
        <TkDrawer
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          wide
          portal
          chip={<TkChip family="competitive">{orderedTags[0]?.label ?? "Insight"}</TkChip>}
          // accentize HERE too, not only on the card face. The sheet is a SECOND place the
          // title renders, and passing it raw leaks the synthesis prompt's `[[markup]]`
          // brackets straight to the operator. Caught by opening the sheet in review.
          title={accentize(insight.title)}
        >
          <p className="tk-muted">{insight.why}</p>
          {insight.validation && <p className="uic-validation">{insight.validation}</p>}
          <div className="uic-sheet-plan">
            <div className="uic-region-label">The plan</div>
            <ol className="uic-steps">
              {insight.plan!.map((s, i) => <StepDetail key={i} step={s} n={i + 1} />)}
            </ol>
          </div>
          {sheetSupport}
          {evidenceBlock}
          {insight.whyPoints?.length ? (
            <TkWhy label="Why we believe this" points={insight.whyPoints} defaultOpen />
          ) : null}
          {sheetExtras}
        </TkDrawer>
      )}
    </>
  )
}
