// Server component: renders a real engine Brief in the editorial v5 layout.
// Round-1 wire — only WIRED interactions are shown (drills, feedback thumbs,
// tolerance slider). Save/Snooze and the live Ask answer are deferred (the
// momentum store + bounded-ask architecture aren't built), shown as honest
// previews rather than fake affordances.

import type { Brief, EnrichedRecommendation, RecipeStep } from "@/lib/skills/types"
import type { PipelineCheck } from "../proof-data"
import type { PlayAction } from "@/lib/insights/momentum"
import { playKey } from "@/lib/skills/preferences"
import { humanizeRef, humanizeLabel, distinctDomains, dedupeRefs } from "@/lib/skills/evidence-format"
import BriefFeedback from "./brief-feedback"
import PlayActionButtons from "./play-action-buttons"

const CONF_RANK = { high: 3, medium: 2, directional: 1 } as const
const CONF_LABEL = { high: "High", medium: "Medium", directional: "Directional" } as const
const KIND_LABEL: Record<EnrichedRecommendation["kind"], string> = {
  prepare: "Prepare",
  capitalize: "Capitalize",
  positioning: "Positioning",
  reputation: "Reputation",
  ops: "Operations",
}

// True per-source run outcomes (pipeline_runs) for the provenance drill.
const OUTCOME_LABEL: Record<string, string> = {
  fresh: "Fresh pull",
  served_stale: "Holding last good read",
  dormant: "Source gone quiet",
  no_data: "Nothing returned",
  partial: "Partial pull",
  failed: "Couldn't reach",
  skipped: "Skipped",
}
const OUTCOME_MARK: Record<string, string> = {
  fresh: "✓", served_stale: "◐", dormant: "◐", no_data: "—", partial: "◐", failed: "✕", skipped: "—",
}
const OUTCOME_STATE: Record<string, string> = {
  fresh: "on", served_stale: "stale", dormant: "stale", no_data: "off", partial: "stale", failed: "bad", skipped: "off",
}
function fmtCheckedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(" AM", "a").replace(" PM", "p")
  return `${day}, ${t}`
}

function fmtDateline(dateKey: string): string {
  const d = new Date(`${dateKey}T12:00:00`)
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
}
function fmtSwept(asOf: string): string {
  const t = new Date(asOf).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  return "Last swept " + t.replace(" AM", "a").replace(" PM", "p").replace(/\s/g, "")
}
function fmtShortDate(dateKey: string): string {
  const d = new Date(`${dateKey.slice(0, 10)}T12:00:00`)
  return Number.isNaN(d.getTime()) ? dateKey : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function RecipeStepView({ step }: { step: RecipeStep }) {
  return (
    <div className="recipe-step">
      <dl className="rs-basis">
        {step.audience ? (<><dt>Who</dt><dd>{step.audience}</dd></>) : null}
        {step.window?.note ? (<><dt>When</dt><dd>{step.window.note}</dd></>) : null}
        {step.channel ? (
          <><dt>Channel</dt><dd>{humanizeLabel(step.channel)}{step.platforms?.length ? ` · ${step.platforms.map(humanizeLabel).join(", ")}` : ""}</dd></>
        ) : null}
        {step.offer ? (<><dt>Offer</dt><dd>{step.offer}</dd></>) : null}
      </dl>
      {step.dependencies?.length ? (
        <ul className="rs-deps">
          {step.dependencies.map((d, i) => (
            <li key={i}><span className="box" />{d}</li>
          ))}
        </ul>
      ) : null}
      {step.copy ? (
        <div className="rs-copy"><span className="copy-label">Customer copy — your voice</span>{step.copy}</div>
      ) : null}
      {step.creativeDirection ? (
        <p className="rs-creative"><span className="cd-label">Creative direction</span>{step.creativeDirection}</p>
      ) : null}
    </div>
  )
}

function PlayCard({
  play,
  rank,
  isLead,
  locationId,
  dateKey,
  readOnly,
  detailHrefBase,
  action,
}: {
  play: EnrichedRecommendation
  rank: number
  isLead: boolean
  locationId: string
  dateKey: string
  readOnly?: boolean
  detailHrefBase?: string
  action?: PlayAction | null
}) {
  const refs = dedupeRefs(play.evidenceRefs)
  const domains = distinctDomains(play.evidenceRefs)
  const key = playKey(play)
  return (
    <article className={`movecard${isLead ? " movecard--lead" : ""}${play.kind === "prepare" ? " movecard--prep" : ""}`}>
      <div className="movecard__rank-row">
        <span className="movecard__rank">{String(rank).padStart(2, "0")}</span>
      </div>
      <h2 className="movecard__do">{play.title}</h2>
      <p className="movecard__why">{play.rationale}</p>
      {/* one consolidated label row: kind + explicit Confidence/Impact (same system) + topic */}
      <div className="movecard__meta">
        <span className={`kind-tag kind-tag--${play.kind}`}>{KIND_LABEL[play.kind]}</span>
        <span className="metric"><span className="metric-k">Confidence</span><span className="metric-v">{CONF_LABEL[play.confidence]}</span></span>
        {play.leverage ? (
          <span className="metric"><span className="metric-k">Impact</span><span className="metric-v">{play.leverage.label}{play.leverage.reach ? ` · ${play.leverage.reach}` : ""}</span></span>
        ) : null}
        {domains.length ? <span className="topic">{domains.join(" · ")}</span> : null}
      </div>

      {play.recipe?.length ? (
        <details className="drill">
          <summary><span className="car">▸</span> The play</summary>
          <div className="drill__body">
            {play.recipe.map((step, i) => (
              <RecipeStepView key={i} step={step} />
            ))}
          </div>
        </details>
      ) : null}

      {refs.length ? (
        <details className="drill">
          <summary><span className="car">▸</span> The evidence</summary>
          <div className="drill__body">
            <div className="evidence">
              {refs.map((r) => (
                <span className="ev" key={r}>{humanizeRef(r)}</span>
              ))}
            </div>
          </div>
        </details>
      ) : null}

      <div className="movecard__foot">
        <BriefFeedback locationId={locationId} dateKey={dateKey} playKey={key} severity={play.severity ?? 0} readOnly={readOnly} />
        {!readOnly ? (
          <PlayActionButtons locationId={locationId} dateKey={dateKey} playKey={key} current={action ?? null} />
        ) : null}
        {detailHrefBase ? (
          <a className="movecard__detail" href={`${detailHrefBase}/${rank}`}>Full detail &amp; evidence →</a>
        ) : null}
      </div>
    </article>
  )
}

export default function BriefView({
  brief,
  locationId,
  competitors,
  readOnly = false,
  detailHrefBase,
  checks,
  standingAsk,
  playActions,
  weeklyMomentum = 0,
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
}) {
  const signalCount = dedupeRefs(brief.plays.flatMap((p) => p.evidenceRefs)).length
  const freshCount = (brief.coverage ?? []).filter((c) => c.present && !c.stale).length
  const leadConf = brief.plays.reduce<EnrichedRecommendation["confidence"]>(
    (best, p) => (CONF_RANK[p.confidence] > CONF_RANK[best] ? p.confidence : best),
    "directional",
  )
  // The acted-on loop: snoozed/dismissed plays collapse into a compact "cleared"
  // strip; saved + untouched plays stay in the active stack (saved keeps its badge).
  const actions = playActions ?? {}
  const ranked = brief.plays.map((play, i) => ({ play, rank: i + 1, action: actions[playKey(play)] ?? null }))
  const active = ranked.filter((r) => r.action !== "snoozed" && r.action !== "dismissed")
  const cleared = ranked.filter((r) => r.action === "snoozed" || r.action === "dismissed")

  return (
    <div className="ticket-brief">
      <div className="home-grid">
        {/* ── LEFT: the brief ── */}
        <div className="brief-main">
          <header className="brief-head">
            <span className="kicker">Your Brief</span>
            <span className="dateline-mono">{fmtDateline(brief.dateKey)} · {fmtSwept(brief.asOf)}</span>
          </header>
          <hr className="rule-ink" />

          <div className="brief-lead">
            <h1 className="brief-hed">{brief.headline}</h1>
            <p className="brief-deck">{brief.deck}</p>
            <p className="brief-synth">
              Synthesized from <b>{signalCount} signal{signalCount === 1 ? "" : "s"}</b>
              {competitors.length ? <> across <b>{competitors.length} competitor{competitors.length === 1 ? "" : "s"}</b></> : null}
              {" · Confidence: "}{CONF_LABEL[leadConf]}
              {brief.fallback ? " · Served from your last good brief" : ""}
            </p>
          </div>

          <div className="zone zone--do">
            <div className="zone-head">
              <span className="zh">Recommendations <span className="count">{active.length}</span></span>
              {weeklyMomentum > 0 ? (
                <span className="momentum">You&apos;ve acted on <b>{weeklyMomentum}</b> play{weeklyMomentum === 1 ? "" : "s"} this week</span>
              ) : null}
            </div>
            {active.map(({ play, rank, action }, i) => (
              <PlayCard
                key={playKey(play)}
                play={play}
                rank={rank}
                isLead={i === 0}
                locationId={locationId}
                dateKey={brief.dateKey}
                readOnly={readOnly}
                detailHrefBase={detailHrefBase}
                action={action}
              />
            ))}
            {cleared.length ? (
              <div className="cleared-strip">
                <span className="cleared-strip__label">Cleared today</span>
                {cleared.map(({ play, action }) => (
                  <span className="cleared-item" key={playKey(play)}>
                    <span className="cleared-item__title">{play.title}</span>
                    {!readOnly ? (
                      <PlayActionButtons locationId={locationId} dateKey={brief.dateKey} playKey={playKey(play)} current={action} />
                    ) : (
                      <span className="cleared-item__state">{action === "snoozed" ? "Snoozed" : "Dismissed"}</span>
                    )}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {/* ── RIGHT: Ask (lead) → what we checked (credibility) ──
            Tuning moved to Settings (explicit refresh, not live); competitor
            management moved to the Competitors page. ── */}
        <aside className="rail-col">
          {/* Ask Ticket leads the rail: the answer-first anchor. Live — links to /ask;
              shows the morning standing answer when one is pinned. */}
          <div className="rail-card ask-card">
            <div className="rail-head"><span>Ask Ticket</span>{readOnly ? <span className="rail-tag">Preview</span> : <a className="rail-tag rail-tag--link" href="/ask">Open →</a>}</div>
            {standingAsk ? (
              <div className="ask-standing">
                <div className="ask-standing__q">{standingAsk.question}</div>
                <p className="ask-standing__a">{standingAsk.answer}</p>
                <span className="ask-standing__meta">Your standing question · re-ran with this morning&apos;s brief</span>
              </div>
            ) : (
              <>
                {readOnly ? (
                  <div className="ask-field">
                    <input type="text" placeholder="Ask about your market…" aria-label="Ask Ticket (preview)" disabled />
                  </div>
                ) : (
                  <a className="ask-field ask-field--link" href="/ask" aria-label="Ask Ticket">
                    <span>Ask about your market…</span>
                  </a>
                )}
                <div className="chips">
                  {readOnly ? (
                    <>
                      <span className="chip">Who&apos;s undercutting me?</span>
                      <span className="chip">What changed this week?</span>
                      <span className="chip">Before the weekend?</span>
                    </>
                  ) : (
                    <>
                      <a className="chip chip--link" href="/ask">Who&apos;s undercutting me?</a>
                      <a className="chip chip--link" href="/ask">What changed this week?</a>
                      <a className="chip chip--link" href="/ask">Before the weekend?</a>
                    </>
                  )}
                </div>
                <p className="ask-foot">Domain-locked. Answers come only from your market and competitor data, never the open web.{readOnly ? " Coming soon." : ""}</p>
              </>
            )}
          </div>

          {/* What we checked — credibility module: which live streams fed today's brief,
              how fresh each is, and what we couldn't reach. Source-by-source provenance is
              prod-wired later; the honest fresh/aging/not-reached states are real now. */}
          {brief.coverage?.length ? (
            <div className="rail-card check-card">
              <div className="rail-head">
                <span>What we checked</span>
                <span className="check-count">{freshCount} of {brief.coverage.length} fresh</span>
              </div>
              <ul className="coverage">
                {brief.coverage.map((c) => {
                  const state = !c.present ? "off" : c.stale ? "stale" : "on"
                  const mark = !c.present ? "—" : c.stale ? "◐" : "✓"
                  const status = !c.present
                    ? (c.detail ?? "Not reached")
                    : c.stale
                      ? (c.asOf ? `As of ${fmtShortDate(c.asOf)}` : (c.detail ?? "Aging"))
                      : (c.detail ?? "Fresh")
                  return (
                    <li key={c.label} className={`cov cov--${state}`}>
                      <span className="cov-mark">{mark}</span>
                      <span className="cov-label">{c.label}</span>
                      <span className="cov-detail">{status}</span>
                    </li>
                  )
                })}
              </ul>
              <details className="check-prov">
                <summary><span className="car">▸</span> How we read this</summary>
                <div className="check-prov__body">
                  <p><b>Fresh</b> means we checked it in this sweep. <b>Aging</b> means we&apos;re holding the last good read until new data lands. <b>Not reached</b> means we couldn&apos;t pull it this time — so nothing in today&apos;s brief leans on it.</p>
                  {checks?.length ? (
                    <ul className="check-runs">
                      {checks.map((c) => (
                        <li key={c.pipeline} className={`check-run check-run--${OUTCOME_STATE[c.outcome] ?? "off"}`}>
                          <span className="check-run__mark">{OUTCOME_MARK[c.outcome] ?? "—"}</span>
                          <span className="check-run__label">{c.label}</span>
                          <span className="check-run__what">
                            {OUTCOME_LABEL[c.outcome] ?? c.outcome}{c.reason ? ` — ${c.reason}` : ""} · {fmtCheckedAt(c.at)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </details>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  )
}
