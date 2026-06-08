// Competitors page — the watched set, elevated from a module to a nav destination AND
// the home for competitor management (add/remove moved off the brief's "On watch" rail).
// Real names + ratings + signal counts from the branch; each links to a per-competitor
// detail. Management interactivity lives in the CompetitorList client component.

import { loadPreviewContext, tierLabel } from "../preview-data"
import CompetitorList from "./competitor-list"

export default async function PreviewCompetitors() {
  const ctx = await loadPreviewContext()
  return (
    <div className="pv-page">
      <div className="pv-page-head">
        <span className="pv-kicker">Your market</span>
        <h1 className="pv-h1">Competitors</h1>
        <p className="pv-sub">The places we watch for you{ctx.city ? ` around ${ctx.city}` : ""}. We track their pricing, reviews, social, and menus, and surface anything that moves into your brief.</p>
      </div>
      <hr className="pv-rule" />

      <CompetitorList
        initial={ctx.competitors.map((c) => ({
          id: c.id,
          name: c.name,
          rating: c.rating,
          reviewCount: c.reviewCount,
          signalCount: c.signalCount,
          topSignals: c.topSignals,
        }))}
        tierLabel={tierLabel(ctx.tier)}
      />
    </div>
  )
}
