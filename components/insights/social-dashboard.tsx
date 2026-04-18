"use client"

import { useSyncExternalStore, useMemo } from "react"
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts"
import { useChartColors } from "@/lib/hooks/use-chart-colors"

type SocialProfileData = {
  entityName: string
  entityType: "location" | "competitor"
  platform: string
  handle: string
  followerCount: number
  engagementRate: number
  postingFrequency: number
  avgLikesPerPost: number
  avgCommentsPerPost: number
  topHashtags: string[]
}

type Props = {
  profiles: SocialProfileData[]
}

function useIsClient() {
  return useSyncExternalStore(() => () => {}, () => true, () => false)
}

const PLATFORM_ICONS: Record<string, string> = {
  instagram: "📸",
  facebook: "📘",
  tiktok: "🎵",
}

function ChartTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ name?: string; value?: number; fill?: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-border bg-card px-3.5 py-2.5 shadow-lg">
      <p className="text-[11px] font-semibold text-foreground">{label}</p>
      {payload.map((entry, idx) => (
        <p key={idx} className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{entry.value?.toLocaleString()}</span>
          {" "}{entry.name}
        </p>
      ))}
    </div>
  )
}

export default function SocialDashboard({ profiles }: Props) {
  const isClient = useIsClient()
  const chartColors = useChartColors()

  const locationProfile = profiles.find((p) => p.entityType === "location")

  const followerData = useMemo(() => {
    return profiles
      .sort((a, b) => b.followerCount - a.followerCount)
      .slice(0, 8)
      .map((p) => ({
        name: p.entityName.length > 12 ? p.entityName.slice(0, 12) + "…" : p.entityName,
        followers: p.followerCount,
        fill: p.entityType === "location" ? chartColors.foreground : chartColors.mutedForeground,
      }))
  }, [profiles, chartColors])

  const engagementData = useMemo(() => {
    return profiles
      .filter((p) => p.engagementRate > 0)
      .sort((a, b) => b.engagementRate - a.engagementRate)
      .slice(0, 8)
      .map((p) => ({
        name: p.entityName.length > 12 ? p.entityName.slice(0, 12) + "…" : p.entityName,
        rate: Math.round(p.engagementRate * 100) / 100,
        fill: p.entityType === "location" ? chartColors.foreground : chartColors.mutedForeground,
      }))
  }, [profiles, chartColors])

  const platformPresence = useMemo(() => {
    const platforms: Array<{ platform: string; you: boolean; competitorCount: number }> = []
    for (const plat of ["instagram", "facebook", "tiktok"]) {
      const hasYou = profiles.some((p) => p.entityType === "location" && p.platform === plat)
      const compCount = profiles.filter((p) => p.entityType === "competitor" && p.platform === plat).length
      platforms.push({ platform: plat, you: hasYou, competitorCount: compCount })
    }
    return platforms
  }, [profiles])

  if (profiles.length === 0) return null

  return (
    <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 to-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15">
          <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
          </svg>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Social Media Intelligence</h3>
          <p className="text-[11px] text-muted-foreground">
            Tracking {profiles.length} social profile{profiles.length !== 1 ? "s" : ""} across {new Set(profiles.map((p) => p.platform)).size} platform{new Set(profiles.map((p) => p.platform)).size !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Platform presence matrix */}
      <div className="mb-5 grid grid-cols-3 gap-2">
        {platformPresence.map((p) => (
          <div
            key={p.platform}
            className={`rounded-xl border p-3 text-center ${
              p.you
                ? "border-primary/30 bg-primary/10"
                : p.competitorCount > 0
                  ? "border-signal-gold/30 bg-signal-gold/10"
                  : "border-border bg-secondary"
            }`}
          >
            <div className="text-lg">{PLATFORM_ICONS[p.platform]}</div>
            <div className="text-xs font-semibold capitalize text-foreground">{p.platform}</div>
            <div className="mt-1 text-[10px]">
              {p.you ? (
                <span className="text-primary">You + {p.competitorCount} competitor{p.competitorCount !== 1 ? "s" : ""}</span>
              ) : p.competitorCount > 0 ? (
                <span className="text-signal-gold">{p.competitorCount} competitor{p.competitorCount !== 1 ? "s" : ""} only</span>
              ) : (
                <span className="text-muted-foreground">Not tracked</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Charts grid */}
      {isClient && (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Follower comparison */}
          {followerData.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h4 className="mb-3 text-xs font-semibold text-foreground">Follower Comparison</h4>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={followerData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={45} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="followers" radius={[6, 6, 0, 0]} maxBarSize={32}>
                      {followerData.map((entry, i) => (
                        <rect key={i} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Engagement rate comparison */}
          {engagementData.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h4 className="mb-3 text-xs font-semibold text-foreground">Engagement Rate (%)</h4>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={engagementData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={35} tickFormatter={(v: number) => `${v}%`} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="rate" name="engagement" radius={[6, 6, 0, 0]} maxBarSize={32}>
                      {engagementData.map((entry, i) => (
                        <rect key={i} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quick stats row */}
      {locationProfile && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard
            label="Your Followers"
            value={formatNumber(locationProfile.followerCount)}
            platform={locationProfile.platform}
          />
          <StatCard
            label="Engagement Rate"
            value={`${locationProfile.engagementRate.toFixed(1)}%`}
            platform={locationProfile.platform}
          />
          <StatCard
            label="Posts/Week"
            value={String(locationProfile.postingFrequency)}
            platform={locationProfile.platform}
          />
          <StatCard
            label="Avg Likes/Post"
            value={formatNumber(locationProfile.avgLikesPerPost)}
            platform={locationProfile.platform}
          />
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, platform }: { label: string; value: string; platform: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-center">
      <div className="text-[10px] font-medium text-muted-foreground">{label}</div>
      <div className="text-sm font-bold text-foreground">{value}</div>
      <div className="text-[9px] capitalize text-muted-foreground">{platform}</div>
    </div>
  )
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
