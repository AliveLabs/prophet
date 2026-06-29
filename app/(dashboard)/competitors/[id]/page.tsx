// Per-competitor detail — "the file" on one watched rival, rebuilt to The Pass.
//
// STRUCTURE rebuild (contract §0): the page-title chrome stays on-system; the BODY is
// re-authored with the kit — a TkHero lead (real Places photo when we have one), kit
// section heads, signal cards, live posts as TkSocialEmbed, the watched-accounts roster,
// and a photos grid. Empty/"quiet" sections render TkEmptyState. All loaders unchanged.

import type { CSSProperties } from "react"
import { notFound } from "next/navigation"
import Link from "next/link"
import { loadOperatorCompetitorDetail, resolveOperator } from "../../operator-data"
import { loadCompetitorProof, loadCompetitorHandles } from "../../proof-data"
import {
  RevealOnView,
  TkHero,
  TkCard,
  TkChip,
  TkSectionHead,
  TkEmptyState,
} from "@/components/ticket"
import { CompetitorPostsGrid, CompetitorPhotosGrid } from "../competitor-proof"
import CompetitorHandles from "../competitor-handles"
import { humanizeRef } from "@/lib/skills/evidence-format"
import "../competitors.css"

function fmtShortDate(dateKey: string): string {
  const d = new Date(`${dateKey.slice(0, 10)}T12:00:00`)
  return Number.isNaN(d.getTime())
    ? dateKey
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

const SOCIAL_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <path d="M10 8l6 4-6 4z" />
  </svg>
)
const SIGNAL_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M3 3v18h18" />
    <path d="M7 14l4-4 3 3 5-6" />
  </svg>
)

export default async function CompetitorDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [c, op] = await Promise.all([loadOperatorCompetitorDetail(id), resolveOperator()])
  if (!c) notFound()
  const [{ posts, photos }, handles] = await Promise.all([
    loadCompetitorProof(id),
    loadCompetitorHandles(id),
  ])

  // Hero canvas: the rival's strongest persisted photo if we have one (real imagery,
  // contract group-note); otherwise the kit's branded gradient canvas.
  const heroImage = photos[0]?.imageUrl ?? null
  const heroPhoto = heroImage ? (
    <div
      className="tk-photo"
      style={{ backgroundImage: `url(${heroImage})` } as CSSProperties}
      data-label={c.name}
      role="img"
      aria-label={`${c.name} — Google Business photo`}
    >
      <div className="tk-veil" />
    </div>
  ) : undefined

  const meta = [
    c.rating != null
      ? `★ ${c.rating}${c.reviewCount != null ? ` · ${c.reviewCount.toLocaleString()} reviews` : ""}`
      : null,
    c.priceLevel,
    c.cuisine,
  ].filter(Boolean) as string[]

  return (
    <div className="pv-page tk-comp">
      <Link href="/competitors" className="tk-back">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        The Set
      </Link>

      {/* ── HERO: the rival's file lead ── */}
      <RevealOnView>
        <TkHero
          className="tk-comp-hero"
          title={c.name}
          chips={<TkChip family="competitive">Watched competitor</TkChip>}
          photo={heroPhoto}
          photoLabel={heroImage ? undefined : c.name}
          lede={
            <>
              What we&apos;re reading on {c.name} — their signals, live posts, and the accounts we watch.
            </>
          }
        >
          {meta.length ? (
            <div className="tk-hero-meta">
              {meta.map((m, i) => (
                <span className="tk-hm" key={i}>
                  {m.startsWith("★") ? (
                    <>
                      <span className="tk-star">★</span>
                      {m.slice(1)}
                    </>
                  ) : (
                    m
                  )}
                </span>
              ))}
            </div>
          ) : null}
          {c.address ? <p className="tk-addr">{c.address}</p> : null}
        </TkHero>
      </RevealOnView>

      {/* ── WHAT WE'RE SEEING (recent signals) ── */}
      <section className="tk-comp-sec">
        <TkSectionHead title="What we're seeing" sub="Recent signals from this competitor" />
        {c.insights.length ? (
          <RevealOnView className="tk-sig-grid" stagger>
            {c.insights.map((s, i) => (
              <div key={i} style={{ "--tk-i": i } as CSSProperties}>
                <TkCard className="tk-sig-card">
                  <span className="tk-sig-type">
                    {humanizeRef(s.type)}
                    {s.dateKey ? ` · ${fmtShortDate(s.dateKey)}` : ""}
                  </span>
                  <span className="tk-sig-title">{s.title}</span>
                  {s.summary ? <p className="tk-sig-sum">{s.summary}</p> : null}
                </TkCard>
              </div>
            ))}
          </RevealOnView>
        ) : (
          <TkEmptyState
            icon={SIGNAL_ICON}
            title="Nothing has moved yet"
            description="No signals tracked for this competitor so far. As their pricing, reviews, social, or menu shift, the change shows up here and in your brief."
          />
        )}
      </section>

      {/* ── THEIR RECENT POSTS ── */}
      <section className="tk-comp-sec">
        <TkSectionHead title="Their recent posts" sub="Live social activity, with the numbers" />
        {posts.length ? (
          <RevealOnView>
            <CompetitorPostsGrid posts={posts} />
          </RevealOnView>
        ) : (
          <TkEmptyState
            icon={SOCIAL_ICON}
            title="Their accounts are quiet"
            description="No current social activity — either they're posting little, or we don't have the right handles yet. Add or fix the accounts we watch below and the next pull picks them up."
          />
        )}
      </section>

      {/* ── WATCHED ACCOUNTS (the manage-handles surface) ── */}
      <CompetitorHandles
        competitorId={id}
        competitorName={c.name}
        handles={handles}
        locationId={op.locationId}
      />

      {/* ── THEIR PHOTOS ── */}
      {photos.length ? (
        <section className="tk-comp-sec">
          <TkSectionHead title="Their photos" sub="What their Google presence shows" />
          <RevealOnView>
            <CompetitorPhotosGrid photos={photos} />
          </RevealOnView>
        </section>
      ) : null}
    </div>
  )
}
