"use client"

// The Pass — page-local re-implementation of the recent-posts grid.
//
// Replaces the shared <SocialPostsGrid/> presentation with the kit's
// <TkSocialEmbed/> cards (the group's centerpiece). Same data shape
// (PostWithMeta), same client-side platform/entity filtering — only the
// PRESENTATION changes. Engagement is framed HONESTLY as a percent share of
// the visible set (no fake $/covers), with the raw counts as labeled stats.

import { useState, useMemo, type ReactNode } from "react"
import type { NormalizedSocialPost, SocialPlatform, SocialPostAnalysis } from "@/lib/social/types"
import { TkSocialEmbed, TkChip, TkPhotoFallback, RevealOnView } from "@/components/ticket"

type PostWithMeta = NormalizedSocialPost & {
  entityName: string
  entityType: "location" | "competitor"
}

const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
}

const NET_ICON: Record<SocialPlatform, ReactNode> = {
  instagram: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.16c3.2 0 3.58.01 4.85.07 3.25.15 4.77 1.69 4.92 4.92.06 1.27.07 1.64.07 4.85 0 3.2-.01 3.58-.07 4.85-.15 3.23-1.66 4.77-4.92 4.92-1.27.06-1.64.07-4.85.07-3.2 0-3.58-.01-4.85-.07-3.26-.15-4.77-1.7-4.92-4.92C2.17 15.58 2.16 15.2 2.16 12c0-3.2.01-3.58.07-4.85.15-3.23 1.66-4.77 4.92-4.92C8.42 2.17 8.8 2.16 12 2.16Zm0 3.68a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32Zm0 10.16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.41-11.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88Z" />
    </svg>
  ),
  facebook: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M24 12.07C24 5.44 18.63.07 12 .07S0 5.44 0 12.07c0 5.99 4.39 10.95 10.13 11.85v-8.38H7.08v-3.47h3.05V9.43c0-3.01 1.79-4.67 4.53-4.67 1.31 0 2.69.24 2.69.24v2.95h-1.51c-1.49 0-1.96.93-1.96 1.87v2.25h3.33l-.53 3.47h-2.8v8.38C19.61 23.02 24 18.06 24 12.07Z" />
    </svg>
  ),
  tiktok: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 1 1-2.1-2.79v-3.5a6.34 6.34 0 1 0 5.55 6.29V8.7a8.26 8.26 0 0 0 5.58 2.17V7.4a4.83 4.83 0 0 1-1.81-.71Z" />
    </svg>
  ),
}

const PLATFORMS: Array<{ key: SocialPlatform | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "instagram", label: "Instagram" },
  { key: "facebook", label: "Facebook" },
  { key: "tiktok", label: "TikTok" },
]

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return ""
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  if (days <= 0) return "Today"
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

// ── Per-post visual read (ALT-160) ──────────────────────────────────────────
// Turn the post's stored visualAnalysis into a compact, HONEST chip row: the
// image-quality tier the vision tagger read, the content type, and the standout
// cues it actually found. Strictly descriptive — it sits next to the "% of peak"
// engagement stat so an operator can SEE what a strong post looked like, but we
// never claim a cue CAUSED the engagement.
const CONTENT_LABEL: Partial<Record<SocialPostAnalysis["contentCategory"], string>> = {
  food_dish: "Dish",
  drink_cocktail: "Drink",
  interior_ambiance: "Interior",
  exterior_facade: "Exterior",
  patio_outdoor: "Patio",
  event_live: "Event",
  staff_team: "Team",
  behind_the_scenes: "Behind the scenes",
  customer_ugc: "Customer post",
  menu_promo: "Menu / promo",
  seasonal_holiday: "Seasonal",
  product_merchandise: "Product",
  community_collab: "Collab",
}

function qualityRead(a: SocialPostAnalysis): { label: string; tier: "high" | "mid" | "low" } | null {
  switch (a.visualQuality?.lighting) {
    case "professional": return { label: "Pro-shot", tier: "high" }
    case "natural_good": return { label: "Natural light", tier: "high" }
    case "amateur": return { label: "Casual shot", tier: "mid" }
    case "poor": return { label: "Low-quality shot", tier: "low" }
    default: return null
  }
}

function gradeCues(a: SocialPostAnalysis): string[] {
  const out: string[] = []
  if (a.steamOrMotion) out.push("Steam / motion")
  if (a.ownerOrStaffPresent) out.push("Owner & staff")
  else if (a.peoplePresent) out.push("People in frame")
  if (a.foodPresentation?.platingQuality === "high") out.push("Strong plating")
  if (a.foodPresentation?.colorVibrancy === "vibrant") out.push("Vibrant color")
  if (a.trendingSound) out.push("Trending sound")
  if (a.promotionalContent) out.push("Promo")
  return out.slice(0, 3)
}

function PostGrade({ a }: { a: SocialPostAnalysis }) {
  // Confidence floor: a shaky read is worse than none — hide it.
  if ((a.confidence ?? 0) < 0.5) return null
  const q = qualityRead(a)
  const cat = CONTENT_LABEL[a.contentCategory]
  const cues = gradeCues(a)
  if (!q && !cat && cues.length === 0) return null
  return (
    <div className="sp-grade" aria-label="What our vision read found in this post">
      {q && <span className={`sp-grade-q sp-grade-q-${q.tier}`}>{q.label}</span>}
      {cat && <span className="sp-grade-cat">{cat}</span>}
      {cues.map((c) => (
        <span key={c} className="sp-grade-cue">{c}</span>
      ))}
    </div>
  )
}

export default function SocialPostsPass({
  posts,
  variant = "all",
}: {
  posts: PostWithMeta[]
  /** Drives the responsive column count (ALT-201): your own posts get fewer,
   *  roomier columns; competitors' get more, denser ones for scanning the set. */
  variant?: "own" | "competitors" | "all"
}) {
  const [activePlatform, setActivePlatform] = useState<SocialPlatform | "all">("all")
  const [activeEntity, setActiveEntity] = useState<string>("all")

  const entities = useMemo(() => {
    const map = new Map<string, { name: string; type: "location" | "competitor" }>()
    for (const p of posts) {
      if (!map.has(p.entityName)) map.set(p.entityName, { name: p.entityName, type: p.entityType })
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.type === "location" && b.type !== "location") return -1
      if (a.type !== "location" && b.type === "location") return 1
      return a.name.localeCompare(b.name)
    })
  }, [posts])

  const platformCounts = useMemo(() => {
    const counts: Record<string, number> = { all: posts.length }
    for (const p of posts) counts[p.platform] = (counts[p.platform] ?? 0) + 1
    return counts
  }, [posts])

  const filtered = useMemo(
    () =>
      posts.filter((p) => {
        if (activePlatform !== "all" && p.platform !== activePlatform) return false
        if (activeEntity !== "all" && p.entityName !== activeEntity) return false
        return true
      }),
    [posts, activePlatform, activeEntity],
  )

  // Honest engagement framing: each post's TOTAL engagement as a share of the
  // single most-engaged post in the visible set. No invented $/covers — this is
  // a relative-strength read across what we actually pulled.
  // Competitor grids run more columns, so show more cards to fill the rows.
  const cap = variant === "competitors" ? 15 : 12
  const visible = filtered.slice(0, cap)
  const peakEngagement = useMemo(
    () => Math.max(1, ...visible.map((p) => p.likesCount + p.commentsCount + p.sharesCount)),
    [visible],
  )

  if (posts.length === 0) return null

  return (
    <div className={`sp-posts sp-posts-${variant}`}>
      {/* Filter bar — platform pills + entity select */}
      <div className="sp-postbar">
        <div className="sp-pills" role="tablist" aria-label="Filter by platform">
          {PLATFORMS.map((p) => {
            const count = platformCounts[p.key] ?? 0
            if (p.key !== "all" && count === 0) return null
            const isActive = activePlatform === p.key
            return (
              <button
                key={p.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActivePlatform(p.key)}
                className={`sp-pill${isActive ? " sp-pill-on" : ""}`}
              >
                {p.key !== "all" && <span className="sp-pill-ic">{NET_ICON[p.key]}</span>}
                {p.label}
                <span className="sp-pill-n">{count}</span>
              </button>
            )
          })}
        </div>

        {entities.length > 1 && (
          <label className="sp-entsel">
            <span className="sr-only">Filter by account</span>
            <select value={activeEntity} onChange={(e) => setActiveEntity(e.target.value)}>
              <option value="all">All accounts ({posts.length})</option>
              {entities.map((e) => (
                <option key={e.name} value={e.name}>
                  {e.type === "location" ? `${e.name} (You)` : e.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {visible.length > 0 ? (
        <RevealOnView className="tk-grid sp-grid" stagger>
          {visible.map((post, i) => {
            const engagement = post.likesCount + post.commentsCount + post.sharesCount
            const sharePct = Math.round((engagement / peakEngagement) * 100)
            const isOwn = post.entityType === "location"
            const caption = post.text ? post.text.slice(0, 140) : null
            const photo =
              post.mediaUrl ? (
                <PostPhoto url={post.mediaUrl} alt={caption ?? "Social post"} label={post.entityName} />
              ) : undefined
            return (
              <div key={`${post.entityName}-${post.platform}-${post.platformPostId}-${i}`}>
                <TkSocialEmbed
                  handle={post.entityName}
                  verified={isOwn}
                  subline={
                    <>
                      {isOwn ? "Your account" : "Competitor"}
                      {post.createdTime ? ` · ${timeAgo(post.createdTime)}` : ""}
                    </>
                  }
                  network={
                    <>
                      {NET_ICON[post.platform]}
                      {PLATFORM_LABEL[post.platform]}
                    </>
                  }
                  photo={photo}
                  photoLabel={post.entityName}
                  postUrl={post.postUrl}
                  postUrlLabel={`Open this ${PLATFORM_LABEL[post.platform]} post`}
                  video={post.mediaType === "video" || post.mediaType === "reel"}
                  caption={caption}
                  tags={
                    post.hashtags.length
                      ? post.hashtags.slice(0, 3).map((t) => `#${t}`).join(" ")
                      : undefined
                  }
                  grade={post.visualAnalysis ? <PostGrade a={post.visualAnalysis} /> : undefined}
                  stats={[
                    { value: formatNumber(post.likesCount), label: "Likes" },
                    { value: formatNumber(post.commentsCount), label: "Comments" },
                    ...(post.sharesCount > 0
                      ? [{ value: formatNumber(post.sharesCount), label: "Shares" }]
                      : []),
                    {
                      value: `${sharePct}%`,
                      label: "of peak",
                      tip: "This post's total engagement as a share of the most-engaged post in view — a relative-strength read across what we pulled.",
                      tipValue: `${formatNumber(engagement)} total interactions`,
                    },
                  ]}
                />
              </div>
            )
          })}
        </RevealOnView>
      ) : (
        <div className="sp-noposts">
          <TkChip family="social">No posts match</TkChip>
          <p>Try a different platform or account.</p>
        </div>
      )}
    </div>
  )
}

/* Render a real post image into the embed's photo slot, falling back to the
   kit's gradient placeholder if it fails to load. */
function PostPhoto({ url, alt, label }: { url: string; alt: string; label?: string }) {
  const [failed, setFailed] = useState(false)
  // (1) real image; (3) clean neutral fallback if it fails to load. The Google
  // Places photo fallback (2) is not wired — the post data carries no place_id
  // (see ALT-152 report).
  if (failed) return <TkPhotoFallback label={label} />
  return (
    <div className="tk-photo sp-photo-img">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} loading="lazy" onError={() => setFailed(true)} />
    </div>
  )
}
