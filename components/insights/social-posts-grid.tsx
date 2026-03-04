"use client"

import { useState } from "react"
import type { NormalizedSocialPost, SocialMediaType } from "@/lib/social/types"

type PostWithMeta = NormalizedSocialPost & {
  entityName: string
  entityType: "location" | "competitor"
}

type Props = {
  posts: PostWithMeta[]
}

const PLATFORM_BADGES: Record<string, { label: string; bg: string; text: string }> = {
  instagram: { label: "Instagram", bg: "bg-gradient-to-r from-pink-500 to-purple-500", text: "text-white" },
  facebook: { label: "Facebook", bg: "bg-blue-600", text: "text-white" },
  tiktok: { label: "TikTok", bg: "bg-gray-900", text: "text-white" },
}

const MEDIA_ICONS: Record<SocialMediaType, string> = {
  image: "🖼️",
  video: "🎬",
  reel: "🎞️",
  carousel: "📸",
  link: "🔗",
  status: "📝",
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
  if (days === 1) return "1 day ago"
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  if (months === 1) return "1 month ago"
  if (months < 12) return `${months} months ago`
  const years = Math.floor(months / 12)
  return years === 1 ? "1 year ago" : `${years} years ago`
}

function PostCard({ post, rank }: { post: PostWithMeta; rank: number }) {
  const badge = PLATFORM_BADGES[post.platform] ?? PLATFORM_BADGES.instagram
  const engagement = post.likesCount + post.commentsCount + post.sharesCount
  const isOwn = post.entityType === "location"

  return (
    <div className={`group relative overflow-hidden rounded-2xl border bg-white shadow-sm transition-all hover:shadow-md ${isOwn ? "border-indigo-200" : "border-slate-200"}`}>
      {/* Rank badge */}
      <div className="absolute left-2.5 top-2.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-xs font-bold text-slate-700 shadow-sm backdrop-blur-sm">
        {rank}
      </div>

      {/* Platform badge */}
      <div className={`absolute right-2.5 top-2.5 z-10 rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.bg} ${badge.text} shadow-sm`}>
        {badge.label}
      </div>

      {/* Image */}
      <PostImage post={post} />

      {/* Content */}
      <div className="space-y-2.5 p-3.5">
        {/* Entity label */}
        <div className="flex items-center gap-1.5">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${isOwn ? "bg-indigo-500" : "bg-slate-400"}`} />
          <span className="text-[11px] font-medium text-slate-500">{post.entityName}</span>
          {post.createdTime && (
            <span className="ml-auto text-[10px] text-slate-400">{timeAgo(post.createdTime)}</span>
          )}
        </div>

        {/* Caption */}
        {post.text && (
          <p className="line-clamp-3 text-xs leading-relaxed text-slate-700">
            {post.text}
          </p>
        )}

        {/* Hashtags */}
        {post.hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {post.hashtags.slice(0, 4).map((tag) => (
              <span key={tag} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600">
                #{tag}
              </span>
            ))}
            {post.hashtags.length > 4 && (
              <span className="text-[10px] text-slate-400">+{post.hashtags.length - 4}</span>
            )}
          </div>
        )}

        {/* Engagement stats */}
        <div className="flex items-center gap-3 border-t border-slate-100 pt-2.5">
          <Stat icon="❤️" value={post.likesCount} label="Likes" />
          <Stat icon="💬" value={post.commentsCount} label="Comments" />
          {post.sharesCount > 0 && <Stat icon="🔄" value={post.sharesCount} label="Shares" />}
          {post.viewsCount != null && post.viewsCount > 0 && (
            <Stat icon="👁" value={post.viewsCount} label="Views" />
          )}
          <div className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
            {formatNumber(engagement)} total
          </div>
        </div>
      </div>
    </div>
  )
}

function PostImage({ post }: { post: PostWithMeta }) {
  const [failed, setFailed] = useState(false)

  if (!post.mediaUrl || failed) {
    const gradients: Record<string, string> = {
      instagram: "from-pink-50 via-purple-50 to-indigo-50",
      facebook: "from-blue-50 to-indigo-50",
      tiktok: "from-gray-50 to-slate-100",
    }
    return (
      <div className={`flex aspect-[4/3] flex-col items-center justify-center gap-2 bg-gradient-to-br ${gradients[post.platform] ?? "from-slate-50 to-slate-100"}`}>
        <span className="text-3xl opacity-40">{MEDIA_ICONS[post.mediaType]}</span>
        {post.text && (
          <p className="mx-4 line-clamp-3 text-center text-[11px] leading-relaxed text-slate-400">
            {post.text.slice(0, 100)}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="relative aspect-square w-full overflow-hidden bg-slate-100">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={post.mediaUrl}
        alt={post.text?.slice(0, 60) ?? "Social post"}
        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        loading="lazy"
        onError={() => setFailed(true)}
      />
      <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white backdrop-blur-sm">
        <span>{MEDIA_ICONS[post.mediaType]}</span>
        <span className="capitalize">{post.mediaType}</span>
      </div>
    </div>
  )
}

function Stat({ icon, value, label }: { icon: string; value: number; label: string }) {
  return (
    <div className="flex items-center gap-1" title={label}>
      <span className="text-xs">{icon}</span>
      <span className="text-xs font-semibold text-slate-700">{formatNumber(value)}</span>
    </div>
  )
}

export default function SocialPostsGrid({ posts }: Props) {
  if (posts.length === 0) return null

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-pink-100 to-purple-100">
          <svg className="h-4 w-4 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Top Recent Posts</h3>
          <p className="text-[11px] text-slate-500">
            {posts.length} highest-engagement posts across your profiles and competitors
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {posts.map((post, i) => (
          <PostCard key={`${post.platform}-${post.platformPostId}`} post={post} rank={i + 1} />
        ))}
      </div>
    </div>
  )
}
