// Expanded DETAIL page for one recommendation (Stage A port of /preview/today/[rank]) —
// what / how / why-we-know, resolved against the logged-in operator's own data.

import { notFound } from "next/navigation"
import Link from "next/link"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { loadOperatorContext } from "../../operator-data"
import { loadMarketProof } from "../../proof-data"
import { ProofGrid } from "../../proof-grid"
import { humanizeRef, humanizeLabel } from "@/lib/skills/evidence-format"
import type { EnrichedRecommendation } from "@/lib/skills/types"

const KIND_LABEL: Record<EnrichedRecommendation["kind"], string> = {
  prepare: "Prepare", capitalize: "Capitalize", positioning: "Positioning", reputation: "Reputation", ops: "Operations",
}
const CONF_LABEL: Record<EnrichedRecommendation["confidence"], string> = {
  high: "High", medium: "Medium", directional: "Directional",
}
const LEV_LABEL: Record<NonNullable<EnrichedRecommendation["leverage"]>["label"], string> = {
  high: "High", medium: "Medium", low: "Low",
}

export default async function PlayDetail({ params }: { params: Promise<{ rank: string }> }) {
  const { rank } = await params
  const ctx = await loadOperatorContext()
  const idx = Number.parseInt(rank, 10) - 1
  const play = ctx.brief?.plays[idx]
  if (!play) notFound()
  const proof = await loadMarketProof(6)

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

  return (
    <div className="pv-page pv-detail">
      <Link href="/home" className="pv-back">← Back to your brief</Link>
      <div className="pv-page-head">
        <span className="pv-kicker">Recommendation {String(idx + 1).padStart(2, "0")} · {KIND_LABEL[play.kind]}</span>
        <h1 className="pv-h1">{play.title}</h1>
        <p className="pv-detail__lede">{play.rationale}</p>
        <div className="pv-pills">
          <span className="pv-pill pv-pill--watch">Confidence · {CONF_LABEL[play.confidence]}</span>
          {play.leverage ? (
            <span className="pv-pill pv-pill--up">Impact · {LEV_LABEL[play.leverage.label]}{play.leverage.reach ? ` · ${play.leverage.reach}` : ""}</span>
          ) : null}
        </div>
      </div>
      <hr className="pv-rule" />

      <div className="pv-section">
        <div className="pv-section-head">How to run it <span className="pv-section-sub">your step-by-step</span></div>
        {play.recipe.map((step, i) => (
          <div className="pv-card pv-step" key={i}>
            <div className="pv-step__n">Step {i + 1}{step.channel ? ` · ${humanizeLabel(step.channel)}` : ""}</div>
            <dl className="pv-step__grid">
              {step.audience ? (<><dt>Who</dt><dd>{step.audience}</dd></>) : null}
              {step.window?.note ? (<><dt>When</dt><dd>{step.window.note}</dd></>) : null}
              {step.platforms?.length ? (<><dt>Where</dt><dd>{step.platforms.map(humanizeLabel).join(", ")}</dd></>) : null}
              {step.offer ? (<><dt>Offer</dt><dd>{step.offer}</dd></>) : null}
            </dl>
            {step.dependencies?.length ? (
              <ul className="pv-step__deps">
                {step.dependencies.map((d, j) => (<li key={j}>{d}</li>))}
              </ul>
            ) : null}
            {step.copy ? (
              <div className="pv-step__copy">
                <span className="pv-step__copy-label">Customer copy — your voice</span>
                {step.copy}
              </div>
            ) : null}
            {step.creativeDirection ? (
              <p className="pv-step__creative"><span className="pv-step__creative-label">Creative direction</span>{step.creativeDirection}</p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="pv-section">
        <div className="pv-section-head">Why we flagged this <span className="pv-section-sub">the signals behind it</span></div>
        {/* P11: the REAL cited artifacts (verbatim review quote / relational stat + "so what"),
            surfaced verbatim above the rule summaries. */}
        {play.evidence?.length ? (
          <div className="pv-card pv-cites">
            {play.evidence.map((e, i) => (
              <blockquote className="pv-cite" key={i}>
                {e.quote ? <span className="pv-cite__quote">&ldquo;{e.quote}&rdquo;</span> : null}
                {e.relativeStat ? (
                  <span className="pv-cite__stat">{e.relativeStat}{e.soWhat ? `, ${e.soWhat}` : ""}</span>
                ) : null}
                {e.rate ? (
                  <span className="pv-cite__rate">{e.rate.numerator} of {e.rate.denominator} ({e.rate.pct}%)</span>
                ) : null}
                <cite className="pv-cite__src">{humanizeRef(e.source)}{e.sourceUrl ? <> · <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer">source</a></> : null}</cite>
              </blockquote>
            ))}
          </div>
        ) : null}
        {evidence.length ? evidence.map((e, i) => (
          <div className="pv-card pv-ev" key={i}>
            <div className="pv-ev__type">{humanizeRef(e.insight_type as string)}</div>
            <div className="pv-ev__title">{e.title as string}</div>
            <p className="pv-ev__summary">{e.summary as string}</p>
          </div>
        )) : (
          <div className="pv-card pv-ev__refs">
            {play.evidenceRefs.map((r) => (<span className="pv-sig" key={r}>{humanizeRef(r)}</span>))}
          </div>
        )}
      </div>

      {proof.length ? (
        <div className="pv-section">
          <div className="pv-section-head">What the rivals are running <span className="pv-section-sub">their actual posts, and why they worked</span></div>
          <ProofGrid posts={proof} />
        </div>
      ) : null}
    </div>
  )
}
