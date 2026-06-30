// The Pass — page-local rival-proof grid for the play DETAIL page.
//
// Re-implements the SHARED components/ProofGrid (app/(dashboard)/proof-grid.tsx)
// presentation with The Pass kit, scoped to THIS route (per the apply-agent rule:
// don't edit the shared component — re-author its presentation page-locally).
//
// Data wiring is unchanged: it takes the same ProofPost[] loadMarketProof() returns.
// Honest framing only — real engagement counts the rivals' posts actually carry,
// no POS/$/covers. Server-safe (presentational only).

import { TkCompetitorLink } from "@/components/ticket"
import type { ProofPost } from "../../proof-data"

function fmtCount(n: number | null): string | null {
  if (n == null || n <= 0) return null
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

const HEART = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 21s-7-4.5-9.5-9C.9 8.6 2.5 5 6 5c2 0 3.2 1.2 4 2.3C10.8 6.2 12 5 14 5c3.5 0 5.1 3.6 3.5 7-2.5 4.5-9.5 9-9.5 9z" />
  </svg>
)
const CHAT = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M21 11.5a8.5 8.5 0 0 1-12.5 7.5L3 21l2-5.5A8.5 8.5 0 1 1 21 11.5z" />
  </svg>
)
const SHARE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
  </svg>
)
const PLAY = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M5 3l14 9-14 9z" />
  </svg>
)
const EXTERNAL = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <path d="M15 3h6v6M10 14L21 3" />
  </svg>
)

function ProofCard({ p }: { p: ProofPost }) {
  const stats: Array<{ icon: typeof HEART; value: string; label: string }> = []
  const likes = fmtCount(p.likes)
  const comments = fmtCount(p.comments)
  const shares = fmtCount(p.shares)
  const views = fmtCount(p.views)
  if (likes) stats.push({ icon: HEART, value: likes, label: "likes" })
  if (comments) stats.push({ icon: CHAT, value: comments, label: "comments" })
  if (shares) stats.push({ icon: SHARE, value: shares, label: "shares" })
  if (views) stats.push({ icon: PLAY, value: views, label: "views" })
  const date = fmtPostDate(p.createdTime)

  return (
    <figure className="pd-proof">
      <div className="pd-proof-media">
        {p.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="pd-proof-img" src={p.imageUrl} alt={p.category ?? `Post from ${p.entityName}`} loading="lazy" />
        ) : (
          <div className="pd-proof-img pd-proof-img-text tk-photo">
            <span>
              {p.text ? `“${p.text.slice(0, 120)}${p.text.length > 120 ? "…" : ""}”` : "No image"}
            </span>
          </div>
        )}
        {/* ALT-175: flag video/reel posts (the frame shown is the cover; frame SELECTION
            is a pipeline concern — see FLAG in the report). */}
        {p.isVideo ? (
          <span className="pd-proof-vid" aria-label="Video post">
            <span className="pd-proof-vid-ic" aria-hidden="true">{PLAY}</span>
            Video
          </span>
        ) : null}
        <span className="pd-proof-net">{PLATFORM_LABEL[p.platform] ?? p.platform}</span>
        {/* ALT-174: open the original post in a new tab; hidden when no URL is derivable. */}
        {p.postUrl ? (
          <a
            className="pd-proof-open"
            href={p.postUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${p.entityName}'s original post on ${PLATFORM_LABEL[p.platform] ?? p.platform} (opens in a new tab)`}
            title="Open original post"
          >
            {EXTERNAL}
          </a>
        ) : null}
      </div>
      <figcaption className="pd-proof-meta">
        <div className="pd-proof-who">
          <span className="pd-proof-name">
            <TkCompetitorLink id={p.entityId} name={p.entityName} />
          </span>
          <span className="pd-proof-handle">
            @{p.handle}
            {date ? ` · ${date}` : ""}
          </span>
        </div>
        {stats.length ? (
          <div className="pd-proof-stats">
            {stats.map((s, i) => (
              <span className="pd-proof-stat" key={i} title={`${s.value} ${s.label}`}>
                <span className="pd-proof-stat-ic" aria-hidden="true">{s.icon}</span>
                <span className="tk-mono">{s.value}</span>
                <span className="pd-proof-stat-k">{s.label}</span>
              </span>
            ))}
          </div>
        ) : null}
        {p.why ? (
          <p className="pd-proof-why">
            <span className="pd-proof-why-label">Why it landed</span>
            {p.why}
          </p>
        ) : p.category ? (
          <p className="pd-proof-why">
            <span className="pd-proof-why-label">Content</span>
            {p.category}
          </p>
        ) : (
          /* ALT-173: no usable read — say so honestly rather than leaving a blank label
             or crediting the post with an aesthetic we can't verify. */
          <p className="pd-proof-why pd-proof-why-none">
            <span className="pd-proof-why-label">Why it landed</span>
            We don&apos;t have a confident read on this one yet.
          </p>
        )}
      </figcaption>
    </figure>
  )
}

export function PlayProofGrid({ posts }: { posts: ProofPost[] }) {
  return (
    <div className="pd-proof-grid">
      {posts.map((p) => (
        <ProofCard key={p.id} p={p} />
      ))}
    </div>
  )
}
