// Competitors — the watched set as a nav destination AND the home for competitor
// management (Stage A port; replaces the legacy analyst module page, preserved in git
// history). Real names, ratings, signal counts for the logged-in operator's location.

import Link from "next/link"
import { loadOperatorContext, tierLabel } from "../operator-data"
import CompetitorList from "./competitor-list"

export default async function CompetitorsPage() {
  const ctx = await loadOperatorContext()
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
        locationId={ctx.locationId}
      />

      <p className="pv-handles-pointer">
        Manage your own social handles on <Link href="/social">Social</Link>. To fix or add the
        accounts we watch for a competitor, open them and edit <b>Social handles</b> — a wrong
        handle means we read the wrong account.
      </p>
    </div>
  )
}
