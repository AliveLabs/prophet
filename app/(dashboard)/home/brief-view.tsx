// Server component: renders a real engine Brief in the editorial v5 layout.
// Round-1 wire — only WIRED interactions are shown (drills, feedback thumbs,
// tolerance slider). Save/Snooze and the live Ask answer are deferred (the
// momentum store + bounded-ask architecture aren't built), shown as honest
// previews rather than fake affordances.

import type { Brief, EnrichedRecommendation, RecipeStep } from "@/lib/skills/types"
import { playKey } from "@/lib/skills/preferences"
import BriefFeedback from "./brief-feedback"
import ToleranceSlider from "./tolerance-slider"

const CONF_RANK = { high: 3, medium: 2, directional: 1 } as const
const CONF_LABEL = { high: "High", medium: "Medium", directional: "Directional" } as const
const KIND_LABEL: Record<EnrichedRecommendation["kind"], string> = {
  prepare: "Prepare",
  capitalize: "Capitalize",
  positioning: "Positioning",
  reputation: "Reputation",
  ops: "Operations",
}

function fmtDateline(dateKey: string): string {
  const d = new Date(`${dateKey}T12:00:00`)
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
}
function fmtSwept(asOf: string): string {
  const t = new Date(asOf).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  return "Swept " + t.replace(" AM", "a").replace(" PM", "p").replace(/\s/g, "")
}
function fmtShortDate(dateKey: string): string {
  const d = new Date(`${dateKey.slice(0, 10)}T12:00:00`)
  return Number.isNaN(d.getTime()) ? dateKey : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}
function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
/** "events.new_high_signal_event:event" -> "Events · new high signal event" */
function humanizeRef(ref: string): string {
  const base = ref.split(":")[0]
  const [domain, ...rest] = base.split(".")
  const detail = rest.join(" ").replace(/[_.]+/g, " ").trim()
  return detail ? `${titleCase(domain)} · ${detail}` : titleCase(domain)
}
function distinctDomains(refs: string[]): string[] {
  return Array.from(new Set(refs.map((r) => titleCase(r.split(".")[0]))))
}
function dedupeRefs(refs: string[]): string[] {
  return Array.from(new Set(refs.map((r) => r.split(":")[0])))
}

function ConfChip({ confidence }: { confidence: EnrichedRecommendation["confidence"] }) {
  return (
    <span className={`conf conf--${confidence}`}>
      <span className="pip"><i></i><i></i><i></i></span>
      {CONF_LABEL[confidence]}
    </span>
  )
}

function RecipeStepView({ step }: { step: RecipeStep }) {
  return (
    <div className="recipe-step">
      <dl className="rs-basis">
        {step.audience ? (<><dt>Who</dt><dd>{step.audience}</dd></>) : null}
        {step.window?.note ? (<><dt>When</dt><dd>{step.window.note}</dd></>) : null}
        {step.channel ? (
          <><dt>Channel</dt><dd>{step.channel}{step.platforms?.length ? ` · ${step.platforms.join(", ")}` : ""}</dd></>
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
}: {
  play: EnrichedRecommendation
  rank: number
  isLead: boolean
  locationId: string
  dateKey: string
  readOnly?: boolean
}) {
  const refs = dedupeRefs(play.evidenceRefs)
  const domains = distinctDomains(play.evidenceRefs)
  const key = playKey(play)
  return (
    <article className={`movecard${isLead ? " movecard--lead" : ""}${play.kind === "prepare" ? " movecard--prep" : ""}`}>
      <div className="movecard__rank-row">
        <span className="movecard__rank">DO {String(rank).padStart(2, "0")}</span>
        <span className={`kind-tag kind-tag--${play.kind}`}>{KIND_LABEL[play.kind]}</span>
      </div>
      <h2 className="movecard__do">{play.title}</h2>
      <p className="movecard__why">{play.rationale}</p>
      <div className="movecard__meta">
        <ConfChip confidence={play.confidence} />
        {play.leverage ? (
          <span className="lev">
            Impact: {play.leverage.label}
            {play.leverage.reach ? <span className="reach"> · {play.leverage.reach}</span> : null}
          </span>
        ) : null}
        {domains.length ? <span className="src">{domains.join(" · ")}</span> : null}
      </div>

      {play.recipe?.length ? (
        <details className="drill">
          <summary><span className="car">▸</span> The play <span className="hint">how to run it</span></summary>
          <div className="drill__body">
            {play.recipe.map((step, i) => (
              <RecipeStepView key={i} step={step} />
            ))}
          </div>
        </details>
      ) : null}

      {refs.length ? (
        <details className="drill">
          <summary><span className="car">▸</span> The evidence <span className="hint">what it&apos;s grounded in</span></summary>
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
        <BriefFeedback locationId={locationId} dateKey={dateKey} playKey={key} readOnly={readOnly} />
      </div>
    </article>
  )
}

export default function BriefView({
  brief,
  locationId,
  locationName,
  competitors,
  brandTolerance,
  readOnly = false,
}: {
  brief: Brief
  locationId: string
  locationName: string
  competitors: string[]
  brandTolerance: number
  readOnly?: boolean
}) {
  const signalCount = dedupeRefs(brief.plays.flatMap((p) => p.evidenceRefs)).length
  const leadConf = brief.plays.reduce<EnrichedRecommendation["confidence"]>(
    (best, p) => (CONF_RANK[p.confidence] > CONF_RANK[best] ? p.confidence : best),
    "directional",
  )

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
              <span className="zh">What to do <span className="count">{brief.plays.length}</span></span>
              <span className="zone-sub">Each carries its reason. Drill in for the play and the evidence.</span>
            </div>
            {brief.plays.map((play, i) => (
              <PlayCard
                key={playKey(play)}
                play={play}
                rank={i + 1}
                isLead={i === 0}
                locationId={locationId}
                dateKey={brief.dateKey}
                readOnly={readOnly}
              />
            ))}
          </div>
        </div>

        {/* ── RIGHT: bearings, tolerance, ask preview, on-watch ── */}
        <aside className="rail-col">
          <div className="rail-bearings">
            <div className="rail-bearing">
              <span className="b-label">To act on</span>
              <span className="b-val">{brief.plays.length} new</span>
            </div>
            <div className="rail-bearing">
              <span className="b-label">Watching</span>
              <span className="b-val">{competitors.length} nearby</span>
            </div>
            <div className="rail-bearing">
              <span className="b-label">Confidence</span>
              <span className={`b-val${leadConf === "high" ? " good" : ""}`}>{CONF_LABEL[leadConf]}</span>
            </div>
            <div className="rail-bearing">
              <span className="b-label">Last swept</span>
              <span className="b-val">{fmtSwept(brief.asOf).replace("Swept ", "")}</span>
            </div>
          </div>

          {brief.coverage?.length ? (
            <div className="rail-card">
              <div className="rail-head"><span>What we checked</span></div>
              <ul className="coverage">
                {brief.coverage.map((c) => {
                  const state = !c.present ? "off" : c.stale ? "stale" : "on"
                  const mark = !c.present ? "—" : c.stale ? "◐" : "✓"
                  const detail = c.present && c.stale && c.asOf ? `stale · ${fmtShortDate(c.asOf)}` : c.detail
                  return (
                    <li key={c.label} className={`cov cov--${state}`}>
                      <span className="cov-mark">{mark}</span>
                      <span className="cov-label">{c.label}</span>
                      {detail ? <span className="cov-detail">{detail}</span> : null}
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}

          <div className="rail-card">
            <div className="rail-head"><span>Tune your briefs</span></div>
            <ToleranceSlider locationId={locationId} initial={brandTolerance} readOnly={readOnly} />
          </div>

          <div className="rail-card ask-card">
            <div className="rail-head"><span>Ask Ticket</span><span className="rail-tag">Preview</span></div>
            <div className="ask-field">
              <input type="text" placeholder="Ask about your market…" aria-label="Ask Ticket (coming soon)" disabled />
            </div>
            <div className="chips">
              <span className="chip">Who&apos;s undercutting me?</span>
              <span className="chip">What changed this week?</span>
              <span className="chip">Before the weekend?</span>
            </div>
            <p className="ask-foot">Domain-locked. Answers will come only from your market and competitor data, never the open web. Coming soon.</p>
          </div>

          {competitors.length ? (
            <div className="rail-card">
              <div className="rail-head"><span>On watch</span></div>
              <div className="reach">
                {competitors.map((c, i) => (
                  <span className="r" key={`${c}-${i}`}>{c}</span>
                ))}
                <span className="r r--own">{locationName}</span>
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  )
}
