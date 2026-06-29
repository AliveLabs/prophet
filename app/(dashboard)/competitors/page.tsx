// Competitors — "The Set": the watched competitive set as a nav destination AND the
// home for managing watched entities (contract §7). Rebuilt to The Pass: the page-title
// chrome stays on-system (.pv-page/.pv-page-head), the BODY is re-authored with the kit
// (a roster of rival cards + the add/discover flows). Real names, ratings, and signal
// counts for the logged-in operator's location — data wiring unchanged.

import Link from "next/link"
import { loadOperatorContext, tierLabel } from "../operator-data"
import { TkSoftPanel } from "@/components/ticket"
import CompetitorRoster from "./competitor-roster"
import "./competitors.css"

export default async function CompetitorsPage() {
  const ctx = await loadOperatorContext()
  return (
    <div className="pv-page tk-comp">
      <div className="pv-page-head">
        <span className="pv-kicker">Your market</span>
        <h1 className="pv-h1">The Set</h1>
        <p className="pv-sub">
          The places we watch for you{ctx.city ? ` around ${ctx.city}` : ""}. We track their pricing,
          reviews, social, and menus, and surface anything that moves into your brief.
        </p>
      </div>
      <hr className="pv-rule" />

      <CompetitorRoster
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

      <TkSoftPanel className="tk-comp-sec" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          style={{ flex: "none", marginTop: 2, color: "var(--ink-3)" }}
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8h.01M11 12h1v4h1" />
        </svg>
        <p style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55, margin: 0 }}>
          Manage <b>your own</b> social handles on <Link href="/social" style={{ color: "var(--rust-deep)", fontWeight: 600 }}>Social</Link>.
          To fix or add the accounts we watch for a competitor, open their file and edit{" "}
          <b>Watched accounts</b> — a wrong handle means we read the wrong account.
        </p>
      </TkSoftPanel>
    </div>
  )
}
