"use client"

// The Pass — page-local re-implementation of the social "dashboard" standing.
//
// Replaces the shared <SocialDashboard/> (recharts bars + matrix) with the kit:
//   • a platform-presence row of TkSoftPanels (you / competitors-only / untracked)
//   • a you-vs-the-set head-to-head (TkH2HBars) on the two honest signals we have:
//     followers and per-post engagement. We compare YOUR profile to the strongest
//     competitor in the set, framed as "you vs them" with a half-width-from-center
//     bar — no invented $/covers, no fabricated trend lines.
//
// Same ProfileData shape the server already builds. Presentation only.

import { useMemo, type CSSProperties, type ReactNode } from "react"
import {
  TkSoftPanel,
  TkH2HBars,
  TkChip,
  TkConfidence,
  RevealOnView,
} from "@/components/ticket"
import type { SocialPlatform } from "@/lib/social/types"

type ProfileData = {
  entityName: string
  entityType: "location" | "competitor"
  platform: string
  handle: string
  followerCount: number
  engagementRate: number
  postingFrequency: number
  postingWindowDays: number | null
  avgLikesPerPost: number
  avgCommentsPerPost: number
  topHashtags: string[]
}

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
}

const NET_ICON: Record<string, ReactNode> = {
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

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export default function SocialStandingPass({ profiles }: { profiles: ProfileData[] }) {
  // Platform presence (you / competitors-only / untracked) — honest matrix.
  const presence = useMemo(() => {
    return (["instagram", "facebook", "tiktok"] as SocialPlatform[]).map((plat) => ({
      platform: plat,
      you: profiles.some((p) => p.entityType === "location" && p.platform === plat),
      competitorCount: profiles.filter(
        (p) => p.entityType === "competitor" && p.platform === plat,
      ).length,
    }))
  }, [profiles])

  // You vs the set — strongest competitor on each honest signal.
  const me = useMemo(() => profiles.find((p) => p.entityType === "location") ?? null, [profiles])
  const comps = useMemo(() => profiles.filter((p) => p.entityType === "competitor"), [profiles])

  const h2hRows = useMemo(() => {
    if (!me || comps.length === 0) return []
    const rows: Array<{
      metric: ReactNode
      side: "you" | "them"
      width: number
      verdict: ReactNode
      tip?: string
      tipValue?: string
    }> = []

    // Followers: who has more, scaled by the larger of the two.
    const topFollow = comps.reduce((a, b) => (b.followerCount > a.followerCount ? b : a))
    if (me.followerCount > 0 || topFollow.followerCount > 0) {
      const meWins = me.followerCount >= topFollow.followerCount
      const hi = Math.max(me.followerCount, topFollow.followerCount, 1)
      const lo = Math.min(me.followerCount, topFollow.followerCount)
      const gap = Math.round((1 - lo / hi) * 100)
      rows.push({
        metric: "Audience size",
        side: meWins ? "you" : "them",
        width: Math.min(100, 30 + gap),
        verdict: meWins
          ? `You lead · ${formatNumber(me.followerCount)}`
          : `${topFollow.entityName} · ${formatNumber(topFollow.followerCount)}`,
        tip: "Follower counts, you vs the strongest competitor we track. Bar grows with the gap.",
        tipValue: `You ${formatNumber(me.followerCount)} · them ${formatNumber(topFollow.followerCount)}`,
      })
    }

    // Per-post engagement rate: who converts attention better.
    const topEng = comps.reduce((a, b) => (b.engagementRate > a.engagementRate ? b : a))
    if (me.engagementRate > 0 || topEng.engagementRate > 0) {
      const meWins = me.engagementRate >= topEng.engagementRate
      const hi = Math.max(me.engagementRate, topEng.engagementRate, 0.01)
      const lo = Math.min(me.engagementRate, topEng.engagementRate)
      const gap = Math.round((1 - lo / hi) * 100)
      rows.push({
        metric: "Engagement / post",
        side: meWins ? "you" : "them",
        width: Math.min(100, 30 + gap),
        verdict: meWins
          ? `You lead · ${me.engagementRate.toFixed(1)}%`
          : `${topEng.entityName} · ${topEng.engagementRate.toFixed(1)}%`,
        tip: "Average engagement when a post goes out (interactions ÷ followers) — not a measure of how often you post.",
        tipValue: `You ${me.engagementRate.toFixed(1)}% · them ${topEng.engagementRate.toFixed(1)}%`,
      })
    }

    return rows
  }, [me, comps])

  if (profiles.length === 0) return null

  return (
    <div className="sp-standing">
      {/* Platform presence */}
      <RevealOnView className="sp-presence" stagger>
        {presence.map((p, i) => {
          const state = p.you ? "you" : p.competitorCount > 0 ? "gap" : "off"
          return (
            <div key={p.platform} style={{ "--tk-i": i } as CSSProperties}>
              <TkSoftPanel className={`sp-plat sp-plat-${state}`}>
                <div className="sp-plat-top">
                  <span className="sp-plat-ic">{NET_ICON[p.platform]}</span>
                  <span className="sp-plat-name">{PLATFORM_LABEL[p.platform]}</span>
                </div>
                <div className="sp-plat-state">
                  {p.you ? (
                    <span className="sp-plat-good">
                      You + {p.competitorCount} competitor{p.competitorCount !== 1 ? "s" : ""}
                    </span>
                  ) : p.competitorCount > 0 ? (
                    <span className="sp-plat-warn">
                      {p.competitorCount} competitor{p.competitorCount !== 1 ? "s" : ""} · you&apos;re not here
                    </span>
                  ) : (
                    <span className="sp-plat-muted">Not tracked</span>
                  )}
                </div>
              </TkSoftPanel>
            </div>
          )
        })}
      </RevealOnView>

      {/* You vs the set */}
      {h2hRows.length > 0 ? (
        <RevealOnView className="sp-h2h-wrap">
          <TkH2HBars
            title={
              <>
                You vs your set
                <TkConfidence level="directional" showLabel={false} className="sp-h2h-conf" />
              </>
            }
            rows={h2hRows}
            note="Compared against the strongest competitor on each signal. Followers and engagement are the two we can read honestly today."
          />
        </RevealOnView>
      ) : me && comps.length === 0 ? (
        <TkSoftPanel className="sp-h2h-empty">
          <TkChip family="social">Just you so far</TkChip>
          <p>
            Add the competitors you want to measure against on{" "}
            <a href="/competitors">Competitors</a> — we&apos;ll line up followers and engagement
            side by side once we&apos;re watching their accounts.
          </p>
        </TkSoftPanel>
      ) : null}
    </div>
  )
}
