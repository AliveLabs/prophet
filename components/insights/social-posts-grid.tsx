"use client"

import { useState, useMemo, type ReactNode } from "react"
import type { NormalizedSocialPost, SocialMediaType, SocialPlatform } from "@/lib/social/types"

type PostWithMeta = NormalizedSocialPost & {
  entityName: string
  entityType: "location" | "competitor"
}

type Props = {
  posts: PostWithMeta[]
}

const PLATFORMS: Array<{ key: SocialPlatform | "all"; label: string; icon: ReactNode }> = [
  {
    key: "all",
    label: "All",
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    ),
  },
  {
    key: "instagram",
    label: "Instagram",
    icon: (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
      </svg>
    ),
  },
  {
    key: "facebook",
    label: "Facebook",
    icon: (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
    ),
  },
  {
    key: "tiktok",
    label: "TikTok",
    icon: (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 0010.86 4.46V13a8.26 8.26 0 005.58 2.17V11.7a4.83 4.83 0 01-3.77-1.78V6.69h3.77z" />
      </svg>
    ),
  },
]

const PLATFORM_COLORS: Record<string, { bg: string; text: string; activeBg: string; activeText: string }> = {
  all: { bg: "bg-slate-100", text: "text-slate-600", activeBg: "bg-slate-900", activeText: "text-white" },
  instagram: { bg: "bg-pink-50", text: "text-pink-600", activeBg: "bg-gradient-to-r from-pink-500 to-purple-500", activeText: "text-white" },
  facebook: { bg: "bg-blue-50", text: "text-blue-600", activeBg: "bg-blue-600", activeText: "text-white" },
  tiktok: { bg: "bg-slate-100", text: "text-slate-700", activeBg: "bg-slate-900", activeText: "text-white" },
}

const PLATFORM_BADGE: Record<string, { bg: string }> = {
  instagram: { bg: "bg-gradient-to-r from-pink-500 to-purple-500" },
  facebook: { bg: "bg-blue-600" },
  tiktok: { bg: "bg-slate-900" },
}

const MEDIA_ICONS: Record<SocialMediaType, string> = {
  image: "photo",
  video: "video",
  reel: "reel",
  carousel: "carousel",
  link: "link",
  status: "text",
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return ""
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (days === 0) return "Today"
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function PostCard({ post }: { post: PostWithMeta }) {
  const [imgFailed, setImgFailed] = useState(false)
  const badge = PLATFORM_BADGE[post.platform]
  const engagement = post.likesCount + post.commentsCount + post.sharesCount
  const isOwn = post.entityType === "location"

  return (
    <div className={`group relative flex flex-col overflow-hidden rounded-xl border bg-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${isOwn ? "border-indigo-200/80 ring-1 ring-indigo-100/50" : "border-slate-200"}`}>
      {/* Platform chip */}
      <div className={`absolute right-2 top-2 z-10 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow ${badge?.bg ?? "bg-slate-800"}`}>
        {post.platform}
      </div>

      {/* Image area */}
      {post.mediaUrl && !imgFailed ? (
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={post.mediaUrl}
            alt={post.text?.slice(0, 60) ?? "Social post"}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/40 to-transparent" />
          <div className="absolute bottom-1.5 left-2 flex items-center gap-1 rounded-md bg-black/50 px-1.5 py-0.5 text-[9px] font-medium text-white/90 backdrop-blur-sm">
            {MEDIA_ICONS[post.mediaType]}
          </div>
          {isOwn && (
            <div className="absolute bottom-1.5 right-2 rounded-md bg-indigo-500/80 px-1.5 py-0.5 text-[9px] font-semibold text-white backdrop-blur-sm">
              You
            </div>
          )}
        </div>
      ) : (
        <div className={`flex aspect-[4/3] flex-col items-center justify-center gap-1.5 ${post.platform === "instagram" ? "bg-gradient-to-br from-pink-50 via-purple-50 to-indigo-50" : post.platform === "facebook" ? "bg-gradient-to-br from-blue-50 to-indigo-50" : "bg-gradient-to-br from-slate-50 to-slate-100"}`}>
          <div className="rounded-lg bg-white/60 p-2 shadow-sm">
            <svg className="h-5 w-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          </div>
          {post.text && (
            <p className="mx-3 line-clamp-2 text-center text-[10px] leading-relaxed text-slate-400">
              {post.text.slice(0, 80)}
            </p>
          )}
          {isOwn && (
            <span className="rounded-md bg-indigo-100 px-1.5 py-0.5 text-[9px] font-semibold text-indigo-600">You</span>
          )}
        </div>
      )}

      {/* Content area */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        {/* Entity + time */}
        <div className="flex items-center gap-1.5">
          <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${isOwn ? "bg-indigo-500" : "bg-slate-400"}`} />
          <span className="truncate text-[11px] font-medium text-slate-600">{post.entityName}</span>
          {post.createdTime && (
            <span className="ml-auto shrink-0 text-[10px] text-slate-400">{timeAgo(post.createdTime)}</span>
          )}
        </div>

        {/* Caption */}
        {post.text && (
          <p className="line-clamp-2 text-[11px] leading-relaxed text-slate-600">
            {post.text}
          </p>
        )}

        {/* Hashtags */}
        {post.hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {post.hashtags.slice(0, 3).map((tag) => (
              <span key={tag} className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-500">
                #{tag}
              </span>
            ))}
            {post.hashtags.length > 3 && (
              <span className="text-[9px] text-slate-400">+{post.hashtags.length - 3}</span>
            )}
          </div>
        )}

        {/* Engagement row */}
        <div className="mt-auto flex items-center gap-2.5 border-t border-slate-100 pt-2">
          <EngagementStat icon={<HeartIcon />} value={post.likesCount} />
          <EngagementStat icon={<CommentIcon />} value={post.commentsCount} />
          {post.sharesCount > 0 && <EngagementStat icon={<ShareIcon />} value={post.sharesCount} />}
          {post.viewsCount != null && post.viewsCount > 0 && (
            <EngagementStat icon={<ViewIcon />} value={post.viewsCount} />
          )}
          <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-700">
            {formatNumber(engagement)}
          </span>
        </div>
      </div>
    </div>
  )
}

function EngagementStat({ icon, value }: { icon: ReactNode; value: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {icon}
      <span className="text-[10px] font-semibold tabular-nums text-slate-600">{formatNumber(value)}</span>
    </div>
  )
}

function HeartIcon() {
  return <svg className="h-3 w-3 text-rose-400" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" /></svg>
}
function CommentIcon() {
  return <svg className="h-3 w-3 text-blue-400" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zm-4 0H9v2h2V9z" clipRule="evenodd" /></svg>
}
function ShareIcon() {
  return <svg className="h-3 w-3 text-emerald-400" viewBox="0 0 20 20" fill="currentColor"><path d="M15 8a3 3 0 10-2.977-2.63l-4.94 2.47a3 3 0 100 4.319l4.94 2.47a3 3 0 10.895-1.789l-4.94-2.47a3.027 3.027 0 000-.74l4.94-2.47C13.456 7.68 14.19 8 15 8z" /></svg>
}
function ViewIcon() {
  return <svg className="h-3 w-3 text-slate-400" viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z" /><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" /></svg>
}

export default function SocialPostsGrid({ posts }: Props) {
  const [activePlatform, setActivePlatform] = useState<SocialPlatform | "all">("all")
  const [activeEntity, setActiveEntity] = useState<string>("all")

  const entities = useMemo(() => {
    const map = new Map<string, { name: string; type: "location" | "competitor" }>()
    for (const p of posts) {
      if (!map.has(p.entityName)) {
        map.set(p.entityName, { name: p.entityName, type: p.entityType })
      }
    }
    const sorted = Array.from(map.values()).sort((a, b) => {
      if (a.type === "location" && b.type !== "location") return -1
      if (a.type !== "location" && b.type === "location") return 1
      return a.name.localeCompare(b.name)
    })
    return sorted
  }, [posts])

  const platformCounts = useMemo(() => {
    const counts: Record<string, number> = { all: posts.length }
    for (const p of posts) counts[p.platform] = (counts[p.platform] ?? 0) + 1
    return counts
  }, [posts])

  const filtered = useMemo(() => {
    return posts.filter((p) => {
      if (activePlatform !== "all" && p.platform !== activePlatform) return false
      if (activeEntity !== "all" && p.entityName !== activeEntity) return false
      return true
    })
  }, [posts, activePlatform, activeEntity])

  if (posts.length === 0) return null

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-100 to-pink-100">
            <svg className="h-4.5 w-4.5 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V5.25a1.5 1.5 0 00-1.5-1.5H3.75a1.5 1.5 0 00-1.5 1.5V19.5a1.5 1.5 0 001.5 1.5z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Social Media Posts</h3>
            <p className="text-[11px] text-slate-500">
              {filtered.length} post{filtered.length !== 1 ? "s" : ""} across your profiles &amp; competitors
            </p>
          </div>
        </div>

        {/* Entity filter dropdown */}
        {entities.length > 1 && (
          <select
            value={activeEntity}
            onChange={(e) => setActiveEntity(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          >
            <option value="all">All Entities ({posts.length})</option>
            {entities.map((e) => (
              <option key={e.name} value={e.name}>
                {e.type === "location" ? `${e.name} (You)` : e.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Platform tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {PLATFORMS.map((p) => {
          const count = platformCounts[p.key] ?? 0
          if (p.key !== "all" && count === 0) return null
          const isActive = activePlatform === p.key
          const colors = PLATFORM_COLORS[p.key]
          return (
            <button
              key={p.key}
              onClick={() => setActivePlatform(p.key as SocialPlatform | "all")}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${isActive ? `${colors.activeBg} ${colors.activeText} shadow-sm` : `${colors.bg} ${colors.text} hover:opacity-80`}`}
            >
              {p.icon}
              <span>{p.label}</span>
              <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${isActive ? "bg-white/20" : "bg-black/5"}`}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Posts grid */}
      {filtered.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.slice(0, 20).map((post, i) => (
            <PostCard key={`${post.entityType}-${post.entityName}-${post.platform}-${post.platformPostId}-${i}`} post={post} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 py-12">
          <svg className="h-8 w-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909" />
          </svg>
          <p className="mt-2 text-xs font-medium text-slate-500">No posts found for this filter</p>
        </div>
      )}
    </div>
  )
}
