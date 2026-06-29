// The Pass — the full play DETAIL page (deep dive of ONE recommendation),
// REBUILT to Concept A's structure. Stage A port of /preview/today/[rank].
//
// STRUCTURE rebuild (not a reskin): a page-title chrome + back link → a 2-col
// TkHero lead (the play, its chips, lede, key comparative viz + impact) → kit
// SectionHead'd TkCard sections for the PLAN (recipe steps), the EVIDENCE
// (verbatim TkQuotes + cited artifacts + the resolved grounding insights), the
// "why we're confident" rolldown, the head-to-head, and the rivals' real posts.
//
// Server component — data fetching, the RLS-scoped insights query, and the
// type-level evidence filtering are UNCHANGED. Presentation only is re-authored
// onto the shared components/ticket kit. Honest mapping: %/estimated/"you vs set"
// framing, verbatim quotes, real engagement counts — never POS/$/covers.

import type { CSSProperties } from "react"
import { notFound } from "next/navigation"
import Link from "next/link"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { loadOperatorContext } from "../../operator-data"
import { loadMarketProof } from "../../proof-data"
import { humanizeRef, humanizeLabel } from "@/lib/skills/evidence-format"
import {
  RevealOnView,
  TkSectionHead,
  TkCard,
  TkSoftPanel,
  TkHero,
  TkChip,
  TkConfidence,
  TkImpactTag,
  TkWinFlag,
  TkQuote,
  TkWhy,
  TkH2HBars,
  TkSentimentRows,
} from "@/components/ticket"
import { PlayProofGrid } from "./play-proof-grid"
import { FAMILY_ICON } from "../pass-icons"
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
  playShowsRivalPosts,
} from "../pass-map"
import { playHeadToHead, leverageLabel, kindLabel } from "./detail-map"
import "./detail.css"

export default async function PlayDetail({ params }: { params: Promise<{ rank: string }> }) {
  const { rank } = await params
  const ctx = await loadOperatorContext()
  const idx = Number.parseInt(rank, 10) - 1
  const play = ctx.brief?.plays[idx]
  if (!play) notFound()
  // ALT-176: only load + show rivals' posts when they're evidence for THIS play
  // (social/competitive plays), not as a blanket tack-on under every insight.
  const showRivalPosts = playShowsRivalPosts(play)
  const proof = showRivalPosts ? await loadMarketProof(6) : []

  // resolve evidenceRefs -> the real grounded insights behind this play (user-scoped, RLS)
  const types = Array.from(new Set(play.evidenceRefs.map((r) => r.split(":")[0])))
  const sb = await createServerSupabaseClient()
  const { data: rows } = await sb
    .from("insights")
    .select("insight_type, title, summary, confidence, evidence, date_key")
    .eq("location_id", ctx.locationId)
    .in("insight_type", types)
    .order("date_key", { ascending: false })
  // Refs are TYPE-level — show the most recent signals of those types, a couple per type.
  const perType = new Map<string, number>()
  const evidence = (rows ?? []).filter((r) => {
    const t = r.insight_type as string
    const n = perType.get(t) ?? 0
    if (n >= 2) return false
    perType.set(t, n + 1)
    return true
  }).slice(0, 5)

  // ── honest presentation mapping ──
  const family = playFamily(play)
  const advantage = isAdvantage(play)
  const quotes = playQuotes(play, 4)
  const sentiment = playSentiment(play)
  const h2h = playHeadToHead(play)
  const whyPoints = playWhyPoints(play)
  const whySource = playWhySource(play)
  const lev = leverageLabel(play)
  const estimate = play.presentation?.estimate
  const signalCount = Array.from(new Set(play.evidenceRefs.map((r) => r.split(":")[0]))).length
  const titleId = "pd-hero-title"

  // The cited inline artifacts that aren't plain quotes (relational stats + rates).
  const citedFacts = (play.evidence ?? []).filter((e) => e.relativeStat || e.rate)

  return (
    <div className="pv-page tk-kit pd-page">
      {/* ── PAGE-TITLE CHROME (on-system; body is rebuilt to the kit below) ── */}
      <Link href="/home" className="pv-back">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <path d="M19 12H5M11 18l-6-6 6-6" />
        </svg>
        Back to your brief
      </Link>
      <div className="pv-page-head pd-head">
        <span className="pv-kicker">
          Play {String(idx + 1).padStart(2, "0")} · {kindLabel(play)}
        </span>
        <h1 className="pv-h1">{play.title}</h1>
      </div>

      {/* ── HERO LEAD — the play, its standing, and the comparative read ── */}
      <RevealOnView className="pd-hero-wrap">
        <TkHero
          title={play.title}
          titleId={titleId}
          chips={
            <>
              <TkChip family={family}>{playChipLabel(play)}</TkChip>
              <TkConfidence level={confLevel(play.confidence)} />
              <TkImpactTag level={impactLevel(play)} />
              {advantage ? <TkWinFlag /> : null}
            </>
          }
          lede={play.rationale}
          photo={<DetailHeroCanvas family={family} label={ctx.locationName} />}
          venueChip={
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M12 21s-7-5.5-7-11a7 7 0 1 1 14 0c0 5.5-7 11-7 11z" />
                <circle cx="12" cy="10" r="2.5" />
              </svg>
              {ctx.locationName}
            </>
          }
        >
          {/* the at-a-glance read strip: confidence · impact · signals (ALT-167).
              Confidence + Impact are two SEPARATE scores and BOTH always render — Impact
              no longer hides when a play carries no sized leverage (the prior bug); it
              falls back to the engine's default tier via impactLabel(). `reach` is an
              optional extra shown only when the play actually carries it. */}
          <div className="pd-meta-strip">
            <div className="pd-meta">
              <span className="pd-meta-k">Confidence</span>
              <span className="pd-meta-v">{confLabel(play.confidence)}</span>
            </div>
            <div className="pd-meta">
              <span className="pd-meta-k">Impact</span>
              <span className="pd-meta-v">
                {impactLabel(play)}
                {lev?.reach ? <span className="pd-meta-reach"> · {lev.reach}</span> : null}
              </span>
            </div>
            <div className="pd-meta">
              <span className="pd-meta-k">Grounded in</span>
              <span className="pd-meta-v">
                {signalCount} signal{signalCount === 1 ? "" : "s"}
              </span>
            </div>
          </div>

          {estimate ? (
            <TkSoftPanel className="pd-estimate">
              <span className="pd-estimate-tag">Estimated reach</span>
              <span className="pd-estimate-v">{estimate.value}</span>
              <span className="pd-estimate-basis">{estimate.basis}</span>
            </TkSoftPanel>
          ) : null}
        </TkHero>
      </RevealOnView>

      {/* ── HEAD-TO-HEAD — you vs the set, when the play carries it ── */}
      {h2h ? (
        <section className="pd-section">
          <TkSectionHead title="You vs the set" sub="Where you stand on the metrics behind this play" />
          <RevealOnView>
            <TkCard className="pd-card">
              <TkH2HBars
                rows={h2h}
                note="Lead direction is measured; the exact values sit beside each bar."
              />
            </TkCard>
          </RevealOnView>
        </section>
      ) : null}

      {/* ── HOW TO RUN IT — the real recipe steps ── */}
      {play.recipe?.length ? (
        <section className="pd-section">
          <TkSectionHead title="How to run it" sub="Your step-by-step" />
          <RevealOnView className="pd-steps" stagger>
            {play.recipe.map((step, i) => {
              const channelLine = step.channel
                ? `${humanizeLabel(step.channel)}${step.platforms?.length ? ` · ${step.platforms.map(humanizeLabel).join(", ")}` : ""}`
                : null
              return (
                <div key={i} style={{ "--tk-i": i } as CSSProperties}>
                  <TkCard className="pd-step">
                    <div className="tk-plan-step">
                      <span className="tk-pn">{i + 1}</span>
                      <div className="tk-pb pd-pb">
                        <h5>{step.audience || `Step ${i + 1}`}</h5>
                        {step.window?.note ? <p className="pd-step-when">{step.window.note}</p> : null}
                        {channelLine ? <p className="pd-step-meta">{channelLine}</p> : null}
                        {step.offer ? <p className="pd-step-meta">Offer · {step.offer}</p> : null}
                        {step.dependencies?.length ? (
                          <ul className="pd-step-deps">
                            {step.dependencies.map((d, j) => (
                              <li key={j}>{d}</li>
                            ))}
                          </ul>
                        ) : null}
                        {step.creativeDirection ? (
                          <p className="pd-step-meta">
                            <span className="pd-step-meta-k">Creative direction</span>
                            {step.creativeDirection}
                          </p>
                        ) : null}
                        {step.copy ? (
                          <div className="pd-copy">
                            <span className="pd-copy-label">Customer copy — your voice</span>
                            <p className="pd-copy-body">{step.copy}</p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </TkCard>
                </div>
              )
            })}
          </RevealOnView>
        </section>
      ) : null}

      {/* ── WHY WE FLAGGED THIS — verbatim cited evidence ── */}
      <section className="pd-section">
        <TkSectionHead title="Why we flagged this" sub="The signals behind it" />

        {/* sentiment-by-category breakdown (when this is a review-grounded play) */}
        {sentiment ? (
          <RevealOnView>
            <TkCard className="pd-card">
              <TkSentimentRows
                caption="Negative sentiment by category"
                captionRight="recent reviews"
                rows={sentiment}
              />
            </TkCard>
          </RevealOnView>
        ) : null}

        {/* verbatim review quotes — the actual source text, never paraphrased */}
        {quotes.length ? (
          <RevealOnView className="pd-quotes" stagger>
            {quotes.map((q, i) => (
              <div key={i} style={{ "--tk-i": i } as CSSProperties}>
                <TkQuote text={q.text} who={q.who} stars={q.stars} when={q.when} />
              </div>
            ))}
          </RevealOnView>
        ) : null}

        {/* cited relational facts / rates (the "so what" framing) */}
        {citedFacts.length ? (
          <RevealOnView className="pd-facts" stagger>
            {citedFacts.map((e, i) => (
              <div key={i} style={{ "--tk-i": i } as CSSProperties}>
                <TkSoftPanel className="pd-fact">
                  {e.relativeStat ? (
                    <span className="pd-fact-stat">
                      {e.relativeStat}
                      {e.soWhat ? <span className="pd-fact-sowhat"> — {e.soWhat}</span> : null}
                    </span>
                  ) : null}
                  {e.rate ? (
                    <span className="pd-fact-rate">
                      <b className="tk-mono">
                        {e.rate.numerator} of {e.rate.denominator}
                      </b>{" "}
                      ({e.rate.pct}%)
                    </span>
                  ) : null}
                  <cite className="pd-fact-src">
                    {humanizeRef(e.source)}
                    {e.sourceUrl ? (
                      <>
                        {" · "}
                        <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer">
                          source
                        </a>
                      </>
                    ) : null}
                  </cite>
                </TkSoftPanel>
              </div>
            ))}
          </RevealOnView>
        ) : null}

        {/* the resolved grounding insights (most-recent signals of each ref type) */}
        {evidence.length ? (
          <RevealOnView className="pd-signals" stagger>
            {evidence.map((e, i) => (
              <div key={i} style={{ "--tk-i": i } as CSSProperties}>
                <TkCard className="pd-signal">
                  <span className="pd-signal-type">{humanizeRef(e.insight_type as string)}</span>
                  <h4 className="pd-signal-title">{e.title as string}</h4>
                  <p className="pd-signal-sum">{e.summary as string}</p>
                </TkCard>
              </div>
            ))}
          </RevealOnView>
        ) : (
          <RevealOnView>
            <TkSoftPanel className="pd-refs">
              <span className="pd-refs-lbl">Grounded in</span>
              <div className="pd-refs-chips">
                {play.evidenceRefs.map((r) => (
                  <span className="pd-ref-chip" key={r}>
                    {humanizeRef(r)}
                  </span>
                ))}
              </div>
            </TkSoftPanel>
          </RevealOnView>
        )}

        {/* the "why we're confident" rolldown (structured basis → kit accordion) */}
        <RevealOnView className="pd-why-wrap">
          <TkWhy label={whyLabel(play)} points={whyPoints} source={whySource} defaultOpen />
        </RevealOnView>
      </section>

      {/* ── WHAT THE RIVALS ARE RUNNING — their real posts + why they worked ── */}
      {proof.length ? (
        <section className="pd-section">
          <TkSectionHead
            title="What the rivals are running"
            sub="Their actual posts, and why they landed"
          />
          <RevealOnView>
            <PlayProofGrid posts={proof} />
          </RevealOnView>
        </section>
      ) : null}
    </div>
  )
}

/* ── The hero's gradient canvas (server-safe, presentational) — a painterly
   multi-hue field over the kit .tk-photo surface, scaling to any location type.
   Page-local twin of the flagship's PassHeroCanvas (which lives in the home
   flagship folder we must not edit). */
function DetailHeroCanvas({ family, label }: { family: ReturnType<typeof playFamily>; label?: string }) {
  const FAMILY_HUE: Record<string, string> = {
    competitive: "var(--slate)",
    reputation: "var(--rust)",
    social: "var(--gold)",
    menu: "var(--teal)",
    grassroots: "var(--teal)",
  }
  const hue = FAMILY_HUE[family] ?? "var(--rust)"
  return (
    <div className="tk-photo pd-hero-canvas" data-label={label} aria-hidden="true">
      <svg
        className="tk-stadium pd-hero-art"
        viewBox="0 0 400 380"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        style={{ "--pd-hue": hue } as CSSProperties}
      >
        <defs>
          <radialGradient id="pd-glow" cx="24%" cy="10%" r="92%">
            <stop offset="0%" stopColor="var(--pd-hue)" stopOpacity="0.55" />
            <stop offset="55%" stopColor="var(--pd-hue)" stopOpacity="0.12" />
            <stop offset="100%" stopColor="transparent" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect x="0" y="0" width="400" height="380" fill="url(#pd-glow)" />
        <g fill="none" stroke="rgba(255,255,255,.10)" strokeWidth="2">
          <path d="M-20 250 Q120 170 220 230 T420 200" />
          <path d="M-20 300 Q140 230 240 280 T420 250" />
          <path d="M-20 200 Q100 120 200 180 T420 150" />
        </g>
        <g className="pd-hero-mark" fill="rgba(255,255,255,.20)">
          <circle cx="120" cy="210" r="2" />
          <circle cx="170" cy="190" r="2" />
          <circle cx="225" cy="205" r="2" />
          <circle cx="285" cy="225" r="2" />
        </g>
      </svg>
      <div className="pd-hero-fam" aria-hidden="true">
        {FAMILY_ICON[family]}
      </div>
      <div className="tk-veil" />
    </div>
  )
}
