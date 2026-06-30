// Per-competitor detail — "the file" on one watched rival, rebuilt to The Pass.
//
// STRUCTURE rebuild (contract §0): the page-title chrome stays on-system; the BODY is
// re-authored with the kit — a TkHero lead (real Places photo when we have one), kit
// section heads, signal cards, live posts as TkSocialEmbed, the watched-accounts roster,
// and a photos grid. Empty/"quiet" sections render TkEmptyState. All loaders unchanged.

import type { CSSProperties } from "react"
import { notFound } from "next/navigation"
import Link from "next/link"
import { loadOperatorCompetitorDetail } from "../../operator-data"
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
import CompetitorLabelForm from "../competitor-label-form"
import { humanizeRef } from "@/lib/skills/evidence-format"
import { priceLevelToSymbols } from "@/lib/places/format"
import type { ManagedHandle } from "../../proof-data"
import "../competitors.css"

function fmtShortDate(dateKey: string): string {
  const d = new Date(`${dateKey.slice(0, 10)}T12:00:00`)
  return Number.isNaN(d.getTime())
    ? dateKey
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

// ALT-187: a one-line summary of which social networks we have for this competitor.
const PLATFORM_LABELS: Record<ManagedHandle["platform"], string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
}
function joinNetworks(names: string[]): string {
  if (names.length <= 1) return names.join("")
  if (names.length === 2) return `${names[0]} & ${names[1]}`
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`
}
function networksSummary(handles: ManagedHandle[]): string | null {
  const names = Array.from(
    new Set(handles.map((h) => PLATFORM_LABELS[h.platform]).filter(Boolean))
  )
  if (!names.length) return null
  return `On ${joinNetworks(names)}`
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

export default async function CompetitorDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; success?: string }>
}) {
  const { id } = await params
  const sp = await searchParams
  const c = await loadOperatorCompetitorDetail(id)
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

  // ALT-188: price level depicted visually ($ / $$ / $$$), category labeled + humanized.
  const priceSymbols = priceLevelToSymbols(c.priceLevel) // "" when unknown
  const ratingLabel =
    c.rating != null
      ? `${c.rating}${c.reviewCount != null ? ` · ${c.reviewCount.toLocaleString()} reviews` : ""}`
      : null
  // ALT-187: networks summary + address (shown for chains so the location is clear).
  const networks = networksSummary(handles)

  return (
    <div className="pv-page tk-comp">
      <Link href="/competitors" className="tk-back">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Competitors
      </Link>

      {sp.error ? <p className="tk-comp-status tk-comp-status-err">{sp.error}</p> : null}
      {sp.success ? <p className="tk-comp-status">{sp.success}</p> : null}

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
          {ratingLabel || priceSymbols || c.cuisine || networks ? (
            <div className="tk-hero-meta">
              {ratingLabel ? (
                <span className="tk-hm">
                  <span className="tk-star">★</span> {ratingLabel}
                </span>
              ) : null}
              {priceSymbols ? (
                <span className="tk-hm tk-price" aria-label={`Price level ${priceSymbols.length} of 4`}>
                  <span className="tk-price-on">{priceSymbols}</span>
                  <span className="tk-price-off" aria-hidden="true">
                    {"$$$$".slice(priceSymbols.length)}
                  </span>
                </span>
              ) : null}
              {networks ? <span className="tk-hm">{networks}</span> : null}
            </div>
          ) : null}
          {c.cuisine ? (
            <p className="tk-meta-line">
              <span className="tk-meta-lbl">Category</span> {c.cuisine}
            </p>
          ) : null}
          {c.address ? <p className="tk-addr">{c.address}</p> : null}
        </TkHero>
      </RevealOnView>

      {/* ── DISPLAY LABEL (ALT-225): what we call this competitor in your dashboard ── */}
      <section className="tk-comp-sec">
        <TkSectionHead
          title="Display label"
          sub="What we call this competitor in your dashboard"
        />
        <TkCard>
          <CompetitorLabelForm
            competitorId={id}
            displayLabel={c.displayLabel}
            sourceName={c.sourceName}
          />
        </TkCard>
      </section>

      {/* ── WATCHED ACCOUNTS (the manage-handles surface) ──
          ALT-189: sits directly under the competitor details, above the signals
          and recent posts. */}
      <CompetitorHandles
        competitorId={id}
        competitorName={c.name}
        handles={handles}
      />

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
            description={
              c.reviewCount != null && c.reviewCount < 5
                ? "Not enough reviews yet to read what guests are saying, and nothing else has shifted. As their reviews build up — and their pricing, social, or menu change — the signals show up here and in your brief."
                : "No signals tracked for this competitor so far. As their pricing, reviews, social, or menu shift, the change shows up here and in your brief."
            }
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
            description="No current social activity — either they're posting little, or we don't have the right handles yet. Add or fix the accounts we watch above and the next pull picks them up."
          />
        )}
      </section>

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
