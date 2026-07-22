import type { ReactNode } from "react"
import type { SocialPlatform } from "@/lib/social/types"
import { tkcx as cx } from "./primitives"

// ALT-372: a small channel badge for social insight cards, so a social insight reads its
// platform at a glance (not only in the Social section). Renders ONLY when the platform is a
// known SocialPlatform — non-social insights, or cross-platform ones with no single network,
// show nothing. Glyphs match the Social surface (social-posts-pass.tsx); the model only
// supports Instagram / Facebook / TikTok today.

const NET_LABEL: Record<SocialPlatform, string> = {
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

const KNOWN = new Set<string>(["instagram", "facebook", "tiktok"])

export function SocialChannelChip({
  platform,
  className,
}: {
  platform?: string | null
  className?: string
}) {
  if (!platform) return null
  const key = String(platform).toLowerCase()
  if (!KNOWN.has(key)) return null
  const p = key as SocialPlatform
  return (
    <span className={cx("tk-chip", "tk-chip-net", className)}>
      {NET_ICON[p]}
      {NET_LABEL[p]}
    </span>
  )
}
