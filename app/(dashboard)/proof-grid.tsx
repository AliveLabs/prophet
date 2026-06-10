// Proof grid (complete-picture · Batch 1) — the rival's actual posts: persisted image,
// engagement numbers, and the vision read on why it worked. Server component; images are
// permanent Supabase Storage URLs (persisted at collect time), never expiring CDN links.

import type { ProofPost, CompetitorPhoto } from "./proof-data"

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

export function ProofGrid({ posts, showEntity = true }: { posts: ProofPost[]; showEntity?: boolean }) {
  return (
    <div className="pv-proof-grid">
      {posts.map((p) => {
        const stats = [
          p.likes ? `♥ ${fmtCount(p.likes)}` : null,
          p.comments ? `💬 ${fmtCount(p.comments)}` : null,
          p.shares ? `↗ ${fmtCount(p.shares)}` : null,
          p.views != null && p.views > 0 ? `▶ ${fmtCount(p.views)}` : null,
        ].filter(Boolean) as string[]
        const date = fmtPostDate(p.createdTime)
        return (
          <figure className="pv-proof" key={p.id}>
            {p.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="pv-proof__img" src={p.imageUrl} alt={p.category ?? "Competitor post"} loading="lazy" />
            ) : (
              <div className="pv-proof__img pv-proof__img--text">
                <span>{p.text ? `“${p.text.slice(0, 120)}${p.text.length > 120 ? "…" : ""}”` : "No image"}</span>
              </div>
            )}
            <figcaption className="pv-proof__meta">
              <div className="pv-proof__who">
                {showEntity ? <span className="pv-proof__name">{p.entityName}</span> : null}
                <span className="pv-proof__handle">
                  {PLATFORM_LABEL[p.platform] ?? p.platform} · @{p.handle}{date ? ` · ${date}` : ""}
                </span>
              </div>
              {stats.length ? <div className="pv-proof__stats">{stats.join("   ")}</div> : null}
              {p.why ? (
                <p className="pv-proof__why"><span className="pv-proof__why-label">Why it worked</span>{p.why}</p>
              ) : p.category ? (
                <p className="pv-proof__why"><span className="pv-proof__why-label">Content</span>{p.category}</p>
              ) : null}
            </figcaption>
          </figure>
        )
      })}
    </div>
  )
}

export function PhotoGrid({ photos }: { photos: CompetitorPhoto[] }) {
  return (
    <div className="pv-proof-grid pv-proof-grid--photos">
      {photos.map((ph) => (
        <figure className="pv-proof" key={ph.id}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="pv-proof__img" src={ph.imageUrl} alt={ph.category ?? "Competitor photo"} loading="lazy" />
          <figcaption className="pv-proof__meta">
            {ph.category ? <div className="pv-proof__who"><span className="pv-proof__name">{ph.category}</span></div> : null}
            {ph.promotional ? (
              <p className="pv-proof__why"><span className="pv-proof__why-label">Promo</span>{ph.promotional}</p>
            ) : ph.detail ? (
              <p className="pv-proof__why">{ph.detail}</p>
            ) : null}
          </figcaption>
        </figure>
      ))}
    </div>
  )
}
