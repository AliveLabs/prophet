// The Pass — a competitor's live posts + Places photos, rebuilt to the kit.
//
// Re-implements the shared <ProofGrid/> / <PhotoGrid/> presentation INSIDE the
// competitors route (the shared component is not in this group's lane). Posts render
// as <TkSocialEmbed/> with real image + engagement stats; photos as kit cards. Same
// real data (ProofPost / CompetitorPhoto from proof-data) — presentation only.

import type { CSSProperties } from "react"
import { TkSocialEmbed, TkCompetitorLink } from "@/components/ticket"
import type { ProofPost, CompetitorPhoto } from "../proof-data"

function fmtCount(n: number | null): string | null {
  if (n == null) return null
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
function fmtPostDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}
const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
}

const NET_ICON = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
  </svg>
)

export function CompetitorPostsGrid({ posts }: { posts: ProofPost[] }) {
  return (
    <div className="tk-posts-grid">
      {posts.map((p, i) => {
        const date = fmtPostDate(p.createdTime)
        const stats = [
          p.likes ? { value: fmtCount(p.likes), label: "Likes", highlight: true } : null,
          p.comments ? { value: fmtCount(p.comments), label: "Comments" } : null,
          p.shares ? { value: fmtCount(p.shares), label: "Shares" } : null,
          p.views != null && p.views > 0 ? { value: fmtCount(p.views), label: "Views" } : null,
        ].filter(Boolean) as Array<{ value: string; label: string; highlight?: boolean }>

        const photo = p.imageUrl ? (
          <div
            className="tk-post-photo"
            style={{ backgroundImage: `url(${p.imageUrl})` } as CSSProperties}
            role="img"
            aria-label={p.category ?? "Competitor post image"}
          />
        ) : (
          <div className="tk-post-photo tk-is-text">
            <span>
              {p.text ? `“${p.text.slice(0, 140)}${p.text.length > 140 ? "…" : ""}”` : "No image on this post"}
            </span>
          </div>
        )

        return (
          <div key={p.id} style={{ "--tk-i": i } as CSSProperties}>
            <TkSocialEmbed
              handle={`@${p.handle}`}
              subline={<TkCompetitorLink id={p.entityId} name={p.entityName} />}
              network={
                <>
                  {NET_ICON}
                  {PLATFORM_LABEL[p.platform] ?? p.platform}
                  {date ? ` · ${date}` : ""}
                </>
              }
              photo={photo}
              postUrl={p.postUrl}
              postUrlLabel={`Open ${p.entityName}'s post on ${PLATFORM_LABEL[p.platform] ?? p.platform}`}
              video={p.isVideo}
              caption={
                p.why ? (
                  <><b>Why it worked:</b> {p.why}</>
                ) : p.category ? (
                  <><b>Content:</b> {p.category}</>
                ) : (
                  // ALT-173: honest absence, never a fabricated read.
                  <span className="tk-muted">No confident read on this post yet.</span>
                )
              }
              stats={stats}
            />
          </div>
        )
      })}
    </div>
  )
}

export function CompetitorPhotosGrid({ photos }: { photos: CompetitorPhoto[] }) {
  return (
    <div className="tk-photo-grid">
      {photos.map((ph) => (
        <figure className="tk-card tk-photo-tile" key={ph.id}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="tk-pt-img" src={ph.imageUrl} alt={ph.category ?? "Competitor photo"} loading="lazy" />
          {(ph.category || ph.promotional || ph.detail) && (
            <figcaption className="tk-pt-cap">
              {ph.category ? <span className="tk-pt-cat">{ph.category}</span> : null}
              {ph.promotional ? (
                <span className="tk-pt-promo">Promo · {ph.promotional}</span>
              ) : ph.detail ? (
                <span className="tk-pt-detail">{ph.detail}</span>
              ) : null}
            </figcaption>
          )}
        </figure>
      ))}
    </div>
  )
}
