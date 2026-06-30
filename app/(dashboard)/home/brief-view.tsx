// The Pass — the flagship daily brief, REBUILT to Concept A's structure.
//
// This is a STRUCTURE rebuild (not a reskin): a brief header → a 2-col HERO for
// the #1 play → a grid of play CARDS → weighted WIDGETS → a credibility right-rail,
// all composed from the shared `components/ticket` kit. The REAL engine Brief is
// mapped HONESTLY (no POS/$/covers — %/estimated/"you vs competitor" language).
//
// Server component: it pulls no new data (page.tsx owns fetching) and keeps the same
// prop signature. Interactivity (ACT drawer, dismiss-reason popover, keep/dismiss/
// thumbs) lives in the <PassPlayCard/> client island, which reuses the SAME wired
// server actions (setPlayAction / submitPlayFeedback) — the learning loop is intact.

import type { CSSProperties } from "react"
import type { Brief, EnrichedRecommendation } from "@/lib/skills/types"
import type { PipelineCheck } from "../proof-data"
import type { PlayAction } from "@/lib/insights/momentum"
import Link from "next/link"
import { playKey } from "@/lib/skills/preferences"
import { dedupeRefs, distinctDomains } from "@/lib/skills/evidence-format"
import {
  RevealOnView,
  TkSectionHead,
  TkCard,
  TkWidgetGrid,
  TkWidget,
  TkStillLearning,
  TkToastProvider,
  TkTooltipLayer,
} from "@/components/ticket"
import { PassPlayCard } from "./pass-play-card"
import { PassAskWidget } from "./pass-ask-widget"
import { PassClearedUndo } from "./pass-cleared-undo"
import { PassHeroCanvas } from "./pass-hero-canvas"
import { playFamily, confLabel } from "./pass-map"
import ListingCheck from "@/components/imagery/listing-check"
import TheShelf from "@/components/imagery/the-shelf"
import type { PhotoRow, CompetitorPhotoGroup } from "@/lib/places/listing-audit"

const CONF_RANK = { high: 3, medium: 2, directional: 1 } as const

function fmtDateline(dateKey: string): string {
  const d = new Date(`${dateKey}T12:00:00`)
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}
function fmtSwept(asOf: string): string {
  return new Date(asOf).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}
function fmtShortDate(dateKey?: string | null): string {
  if (!dateKey) return ""
  const d = new Date(`${dateKey.slice(0, 10)}T12:00:00`)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export default function BriefView({
  brief,
  locationId,
  locationName,
  competitors,
  readOnly = false,
  detailHrefBase,
  checks,
  standingAsk,
  playActions,
  weeklyMomentum = 0,
  ownPhotos = [],
  hasListing = false,
  shelfCompetitors = [],
}: {
  brief: Brief
  locationId: string
  locationName: string
  competitors: string[]
  readOnly?: boolean
  detailHrefBase?: string
  checks?: PipelineCheck[]
  standingAsk?: { question: string; answer: string } | null
  playActions?: Record<string, PlayAction>
  weeklyMomentum?: number
  /** ALT-160 listing-imagery modules — own-listing photo rows + per-competitor groups. */
  ownPhotos?: PhotoRow[]
  hasListing?: boolean
  shelfCompetitors?: CompetitorPhotoGroup[]
}) {
  const allRefs = brief.plays.flatMap((p) => p.evidenceRefs)
  const signalCount = dedupeRefs(allRefs).length
  // The distinct high-level sources behind today's plays — the detail the "Signals read" tile
  // expands to show (ALT-181), so the count says WHY it matters instead of being a dead number.
  const signalSources = distinctDomains(allRefs)
  const coverage = brief.coverage ?? []
  const freshCount = coverage.filter((c) => c.present && !c.stale).length
  const leadConf = brief.plays.reduce<EnrichedRecommendation["confidence"]>(
    (best, p) => (CONF_RANK[p.confidence] > CONF_RANK[best] ? p.confidence : best),
    "directional",
  )

  // The acted-on loop (unchanged): Removed (dismissed)/legacy-snoozed collapse into a
  // "cleared" strip; Kept (saved) + untouched plays stay in the active stack.
  const actions = playActions ?? {}
  const ranked = brief.plays.map((play, i) => ({ play, rank: i + 1, action: actions[playKey(play)] ?? null }))
  const active = ranked.filter((r) => r.action !== "snoozed" && r.action !== "dismissed")
  const cleared = ranked.filter((r) => r.action === "snoozed" || r.action === "dismissed")

  const SPINE_MAX = 5
  const lead = active[0] ?? null
  const gridPlays = active.slice(1, SPINE_MAX)
  const rest = active.slice(SPINE_MAX)

  // First-run / empty → the full "still learning" state (no plays at all).
  const lowData = active.length === 0
  // Fallback brief (served from last-good after a model failure) — keep the plays
  // but flag it honestly with a banner so the operator knows it isn't a fresh sweep.
  const isFallback = brief.fallback === true && !lowData

  // ── At-a-glance widgets (honest, %-framed) ──
  const wonCount = brief.plays.filter((p) => p.presentation?.advantage === true).length

  const card = (play: EnrichedRecommendation, rank: number, action: PlayAction | null, isLead: boolean) => (
    <PassPlayCard
      key={playKey(play)}
      play={play}
      rank={rank}
      isLead={isLead}
      locationId={locationId}
      dateKey={brief.dateKey}
      playKey={playKey(play)}
      current={action}
      readOnly={readOnly}
      detailHref={detailHrefBase ? `${detailHrefBase}/${rank}` : undefined}
      heroPhoto={isLead ? <PassHeroCanvas family={playFamily(play)} label={locationName} /> : undefined}
    />
  )

  return (
    <TkToastProvider>
      <div className="ticket-brief tk-kit">
        <TkTooltipLayer />

        {/* ── BRIEF HEADER ── */}
        <RevealOnView as="header" className="pass-brief-head">
          <div className="pass-brief-head-text">
            <div className="tk-eyebrow">Daily brief · {fmtDateline(brief.dateKey)}</div>
            {/* The ONE editorial flourish (Fraunces) — the lead headline only. */}
            <h1 className="pass-headline">{brief.headline}</h1>
            {brief.deck ? <p className="pass-deck">{brief.deck}</p> : null}
            <p className="pass-synth">
              Synthesized from <b>{signalCount} signal{signalCount === 1 ? "" : "s"}</b>
              {competitors.length ? (
                <> across <b>{competitors.length} competitor{competitors.length === 1 ? "" : "s"}</b></>
              ) : null}
              {" · "}Confidence <b>{confLabel(leadConf)}</b>
              {brief.fallback ? " · holding your last good brief" : ""}
            </p>
          </div>
          <div className="pass-brief-meta">
            <span className="pass-count-badge">
              <span className="pass-count-n">{active.length}</span>
              <span className="pass-count-lbl">
                Play{active.length === 1 ? "" : "s"}
                <br />
                today
              </span>
            </span>
            <span className="pass-run-note">
              <span className="pass-dot" aria-hidden="true" />
              Refreshed overnight · {fmtSwept(brief.asOf)}
            </span>
          </div>
        </RevealOnView>

        {lowData ? (
          /* ── FIRST-RUN / LOW-DATA STATE ── */
          <RevealOnView className="pass-firstrun">
            <TkStillLearning
              days={Math.max(1, freshCount)}
              target={Math.max(coverage.length, 6)}
              title="Still reading your market"
              description={
                brief.fallback
                  ? "We're holding your last good brief while tonight's data lands — fresh plays return on the next sweep."
                  : "We're gathering enough signal to be honest about your standing. Your first plays land as the picture fills in."
              }
            />
          </RevealOnView>
        ) : (
          <>
            {/* ── FALLBACK BANNER (last-good brief; honest, not faked) ── */}
            {isFallback ? (
              <div className="pass-fallback-banner" role="status">
                <span className="pass-dot" aria-hidden="true" />
                Holding your last good brief while tonight&apos;s data lands — fresh plays return on the next sweep.
              </div>
            ) : null}

            {/* ── HERO (lead play, rank 1) ── */}
            {lead ? (
              <RevealOnView className="pass-hero-wrap">
                {card(lead.play, lead.rank, lead.action, true)}
              </RevealOnView>
            ) : null}

            {/* ── PLAY GRID (remaining plays) ── */}
            {gridPlays.length ? (
              <>
                <TkSectionHead
                  title="More plays today"
                  sub="Ranked by relevance"
                  className="pass-sec"
                />
                <RevealOnView className="tk-grid pass-grid" stagger>
                  {gridPlays.map(({ play, rank, action }, i) => (
                    <div key={playKey(play)} style={{ "--tk-i": i } as CSSProperties}>
                      {card(play, rank, action, false)}
                    </div>
                  ))}
                </RevealOnView>
              </>
            ) : null}

            {/* ── "N more moves" collapse ── */}
            {rest.length ? (
              <details className="pass-more">
                <summary>
                  <span className="pass-more-car" aria-hidden="true">▸</span>{" "}
                  {rest.length} more move{rest.length === 1 ? "" : "s"} this week
                </summary>
                <div className="tk-grid pass-grid pass-more-grid">
                  {rest.map(({ play, rank, action }) => (
                    <div key={playKey(play)}>{card(play, rank, action, false)}</div>
                  ))}
                </div>
              </details>
            ) : null}

            {/* ── "Cleared today" strip (dismissed/snoozed) ── */}
            {cleared.length ? (
              <div className="pass-cleared">
                <span className="pass-cleared-lbl">Cleared today</span>
                <div className="pass-cleared-items">
                  {cleared.map(({ play, action }) => (
                    <span className="pass-cleared-item" key={playKey(play)}>
                      <span className="pass-cleared-title">{play.title}</span>
                      {!readOnly ? (
                        <PassClearedUndo
                          locationId={locationId}
                          dateKey={brief.dateKey}
                          playKey={playKey(play)}
                          state={action === "snoozed" ? "Snoozed" : "Dismissed"}
                        />
                      ) : (
                        <span className="pass-cleared-state">
                          {action === "snoozed" ? "Snoozed" : "Dismissed"}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {/* ── See-all-insights link (ALT-184a) — at the END of the brief's insights, near
                "Cleared today", not orphaned at the bottom of the whole page. ── */}
            <Link className="pass-pool-link" href="/home/pool">
              See all insights in your pool &rarr;
            </Link>

            {/* ── AT-A-GLANCE WIDGETS ── */}
            <TkSectionHead title="At a glance" sub="Weighted widgets · your week" className="pass-sec" />
            <RevealOnView>
              <TkWidgetGrid>
                <TkWidget
                  tone="rust"
                  size="wide"
                  label="Signals read"
                  value={String(signalCount)}
                  sub="distinct sources behind today's plays — tap to see them"
                  expand={
                    <>
                      <p className="pass-sig-why">
                        Every play today is grounded in these live sources. More distinct sources means a
                        wider read of your market — fewer means we leaned on what was fresh this sweep.
                      </p>
                      {signalSources.length ? (
                        <ul className="pass-sig-list">
                          {signalSources.map((s) => (
                            <li key={s}>{s}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="pass-sig-why">No grounded sources on this brief yet.</p>
                      )}
                    </>
                  }
                  spark={
                    <svg viewBox="0 0 120 60" preserveAspectRatio="none" aria-hidden="true">
                      <path
                        d="M0 50 L30 46 L55 40 L75 18 L95 10 L120 22"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                      />
                    </svg>
                  }
                />
                <TkWidget
                  tone="teal"
                  label="You're winning"
                  value={wonCount > 0 ? `${wonCount} play${wonCount === 1 ? "" : "s"}` : "—"}
                  sub={wonCount > 0 ? "advantages to press" : "no clear edge yet"}
                  data-tip="Plays where you lead the set"
                  data-tipv={`${wonCount} advantage${wonCount === 1 ? "" : "s"}`}
                />
                <TkWidget
                  tone="slate"
                  label="Acted this week"
                  value={String(weeklyMomentum)}
                  sub={weeklyMomentum > 0 ? "plays you're on" : "kept or acted — none yet"}
                  data-tip="Plays you kept or acted on in the last 7 days"
                  data-tipv={`${weeklyMomentum} this week`}
                />
                <TkWidget
                  tone="gold"
                  label="Competitors"
                  value={String(competitors.length)}
                  sub="tracked in your set"
                  data-tip="Competitors in your watched set"
                  data-tipv={`${competitors.length} tracked`}
                />
                <TkWidget
                  tone="slate"
                  label="Coverage fresh"
                  value={coverage.length ? `${freshCount}/${coverage.length}` : "—"}
                  sub="signal streams checked this sweep"
                  data-tip="Live signal streams that returned fresh data"
                  data-tipv={coverage.length ? `${freshCount} of ${coverage.length} fresh` : "no coverage yet"}
                />
              </TkWidgetGrid>
            </RevealOnView>
          </>
        )}

        {/* ── LISTING IMAGERY (ALT-160) — your Google-listing photos: a storefront
            check + a you-vs-set Shelf. Sits below the at-a-glance widgets and above
            the credibility rail. Both modules self-hide when there's nothing honest
            to show, so they never clutter a brief without listing data. ── */}
        {!readOnly && (
          <>
            <ListingCheck photos={ownPhotos} hasPlaceId={hasListing} />
            <TheShelf ownPhotos={ownPhotos} competitors={shelfCompetitors} />
          </>
        )}

        {/* ── CREDIBILITY RAIL (Ask + what we checked) ── */}
        <div className="pass-rail">
          <RevealOnView className="pass-rail-col">
            {/* Ask Ticket — live link; shows the morning standing answer when pinned. */}
            <TkCard className="pass-ask-card">
              <div className="pass-rail-head">
                <span>Ask Ticket</span>
                {readOnly ? (
                  <span className="pass-rail-tag">Preview</span>
                ) : (
                  <a className="pass-rail-tag pass-rail-link" href="/ask">
                    Open &rarr;
                  </a>
                )}
              </div>
              {standingAsk ? (
                <div className="pass-ask-standing">
                  <div className="pass-ask-q">{standingAsk.question}</div>
                  <p className="pass-ask-a">{standingAsk.answer}</p>
                  <span className="pass-ask-meta">
                    Your standing question · re-ran with this morning&apos;s brief
                  </span>
                </div>
              ) : readOnly ? (
                /* Preview surface: non-interactive, no navigation (ALT-183 wiring is live-only). */
                <>
                  <div className="pass-ask-field" aria-hidden="true">
                    <span>Ask about your market…</span>
                  </div>
                  <div className="pass-ask-chips">
                    <span className="pass-ask-chip">Who&apos;s undercutting me?</span>
                    <span className="pass-ask-chip">What changed this week?</span>
                    <span className="pass-ask-chip">Before the weekend?</span>
                  </div>
                  <p className="pass-ask-foot">
                    Domain-locked. Answers come only from your market and competitor data, never the open web.
                    {" Coming soon."}
                  </p>
                </>
              ) : (
                /* Live: a REAL input — type + Enter (or a chip) navigates to /ask?q= which
                   prefills and auto-runs the answer (client island). */
                <PassAskWidget />
              )}
            </TkCard>

            {/* What we checked — credibility module (fresh / aging / not-reached). */}
            {coverage.length ? (
              <TkCard className="pass-check-card">
                <div className="pass-rail-head">
                  <span>What we checked</span>
                  <span className="pass-check-count">
                    {freshCount} of {coverage.length} fresh
                  </span>
                </div>
                <ul className="pass-coverage">
                  {coverage.map((c) => {
                    const state = !c.present ? "off" : c.stale ? "stale" : "on"
                    const mark = !c.present ? "—" : c.stale ? "◐" : "✓"
                    const status = !c.present
                      ? c.detail ?? "Not reached"
                      : c.stale
                        ? c.asOf
                          ? `As of ${fmtShortDate(c.asOf)}`
                          : c.detail ?? "Aging"
                        : c.detail ?? "Fresh"
                    return (
                      <li key={c.label} className={`pass-cov pass-cov-${state}`}>
                        <span className="pass-cov-mark">{mark}</span>
                        <span className="pass-cov-label">{c.label}</span>
                        <span className="pass-cov-detail">{status}</span>
                      </li>
                    )
                  })}
                </ul>
                <details className="pass-prov">
                  <summary>
                    <span className="pass-more-car" aria-hidden="true">▸</span> How we read this
                  </summary>
                  <div className="pass-prov-body">
                    <p>
                      <b>Fresh</b> means we checked it in this sweep. <b>Aging</b> means we&apos;re holding the
                      last good read until new data lands. <b>Not reached</b> means we couldn&apos;t pull it this
                      time — so nothing in today&apos;s brief leans on it.
                    </p>
                    {checks?.length ? (
                      <ul className="pass-check-runs">
                        {checks.map((c) => (
                          <li key={c.pipeline} className="pass-check-run">
                            <span className="pass-check-run-label">{c.label}</span>
                            <span className="pass-check-run-what">
                              {c.outcome}
                              {c.reason ? ` — ${c.reason}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </details>
              </TkCard>
            ) : null}

            {/* Position-over-time still-learning teaser (kept honest, not faked). */}
            {!lowData && coverage.length < 4 ? (
              <TkStillLearning
                days={Math.max(1, freshCount)}
                target={Math.max(coverage.length, 6)}
                title="Trend charts unlock with more history"
                description="We'll show how your standing moves once there's enough history to be honest about it."
              />
            ) : null}
          </RevealOnView>
        </div>

      </div>
    </TkToastProvider>
  )
}
