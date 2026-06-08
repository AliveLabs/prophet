// Per-competitor detail — the real watched restaurant + its recent signals (the
// insights tagged to this competitor). Replaces the old "competitive summary" label
// soup with the actual restaurant and what we've seen move. Provenance + richer proof
// (their posts/photos/numbers) is prod-wired later.

import { notFound } from "next/navigation"
import { connection } from "next/server"
import Link from "next/link"
import { loadCompetitorDetail } from "../../preview-data"
import { humanizeRef } from "@/lib/skills/evidence-format"

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()
}
function fmtShortDate(dateKey: string): string {
  const d = new Date(`${dateKey.slice(0, 10)}T12:00:00`)
  return Number.isNaN(d.getTime()) ? dateKey : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export default async function CompetitorDetail({ params }: { params: Promise<{ id: string }> }) {
  await connection()
  const { id } = await params
  const c = await loadCompetitorDetail(id)
  if (!c) notFound()

  const meta = [
    c.rating != null ? `★ ${c.rating}${c.reviewCount != null ? ` · ${c.reviewCount.toLocaleString()} reviews` : ""}` : null,
    c.priceLevel,
    c.cuisine,
  ].filter(Boolean) as string[]

  return (
    <div className="pv-page pv-detail">
      <Link href="/preview/competitors" className="pv-back">← Back to competitors</Link>
      <div className="pv-comp-head">
        <span className="pv-comp-head__mark">{initials(c.name)}</span>
        <div>
          <span className="pv-kicker">Watched competitor</span>
          <h1 className="pv-h1">{c.name}</h1>
          {meta.length ? <p className="pv-comp-head__meta">{meta.join("  ·  ")}</p> : null}
          {c.address ? <p className="pv-comp-head__addr">{c.address}</p> : null}
        </div>
      </div>
      <hr className="pv-rule" />

      <div className="pv-section">
        <div className="pv-section-head">What we&apos;re seeing <span className="pv-section-sub">recent signals from this competitor</span></div>
        {c.insights.length ? c.insights.map((s, i) => (
          <div className="pv-card pv-ev" key={i}>
            <div className="pv-ev__type">{humanizeRef(s.type)}{s.dateKey ? ` · ${fmtShortDate(s.dateKey)}` : ""}</div>
            <div className="pv-ev__title">{s.title}</div>
            {s.summary ? <p className="pv-ev__summary">{s.summary}</p> : null}
          </div>
        )) : (
          <div className="pv-card"><p className="pv-ev__summary">No signals tracked yet for this competitor. We&apos;ll surface activity here as it moves.</p></div>
        )}
        <p className="pv-soon">Richer proof — their actual posts, photos, and the numbers behind each signal — is coming with the production data wiring.</p>
      </div>
    </div>
  )
}
