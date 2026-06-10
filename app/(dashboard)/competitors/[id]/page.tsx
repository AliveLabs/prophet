// Per-competitor detail — the real watched restaurant + its recent signals, scoped to
// the logged-in operator's location (Stage A port; replaces the legacy module detail).

import { notFound } from "next/navigation"
import Link from "next/link"
import { loadOperatorCompetitorDetail } from "../../operator-data"
import { loadCompetitorProof } from "../../proof-data"
import { ProofGrid, PhotoGrid } from "../../proof-grid"
import { humanizeRef } from "@/lib/skills/evidence-format"

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()
}
function fmtShortDate(dateKey: string): string {
  const d = new Date(`${dateKey.slice(0, 10)}T12:00:00`)
  return Number.isNaN(d.getTime()) ? dateKey : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export default async function CompetitorDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = await loadOperatorCompetitorDetail(id)
  if (!c) notFound()
  const { posts, photos } = await loadCompetitorProof(id)

  const meta = [
    c.rating != null ? `★ ${c.rating}${c.reviewCount != null ? ` · ${c.reviewCount.toLocaleString()} reviews` : ""}` : null,
    c.priceLevel,
    c.cuisine,
  ].filter(Boolean) as string[]

  return (
    <div className="pv-page pv-detail">
      <Link href="/competitors" className="pv-back">← Back to competitors</Link>
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
      </div>

      {posts.length ? (
        <div className="pv-section">
          <div className="pv-section-head">Their recent posts <span className="pv-section-sub">live social activity, with the numbers</span></div>
          <ProofGrid posts={posts} showEntity={false} />
        </div>
      ) : (
        <div className="pv-section">
          <div className="pv-section-head">Their recent posts <span className="pv-section-sub">live social activity</span></div>
          <div className="pv-card"><p className="pv-ev__summary">No current social activity from this competitor — their accounts are quiet or unverified. If that changes, the posts land here.</p></div>
        </div>
      )}

      {photos.length ? (
        <div className="pv-section">
          <div className="pv-section-head">Their photos <span className="pv-section-sub">what their Google presence shows</span></div>
          <PhotoGrid photos={photos} />
        </div>
      ) : null}
    </div>
  )
}
