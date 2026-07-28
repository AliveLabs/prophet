"use client"

// The Pass — page-local re-implementation of the social "dashboard" standing.
//
// Replaces the shared <SocialDashboard/> (recharts bars + matrix) with the kit:
//   • a platform-presence row of TkSoftPanels (you / competitors-only / untracked)
//   • a standing LADDER on the two honest signals we have: followers and per-post
//     engagement. No invented $/covers, no fabricated trend lines.
//
// ALT-270: the ladder replaced a you-vs-the-STRONGEST head-to-head. That comparison
// only ever named one competitor, so a set of four read as a set of one and the
// operator could not tell whether the others were missing or just not shown. Every
// tracked account is now a row, with your own highlighted and your rank stated.
//
// Same ProfileData shape the server already builds. Presentation only.

import { useMemo, type CSSProperties, type ReactNode } from "react"
import Link from "next/link"
import {
  TkSoftPanel,
  TkChip,
  TkConfidence,
  RevealOnView,
  tkcx,
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

function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`
}

export default function SocialStandingPass({
  profiles,
  section = "both",
}: {
  profiles: ProfileData[]
  /** Which half to render. The page splits these across its own/competitors
   *  sections (ALT-197): "presence" → network coverage under Your social;
   *  "h2h" → you-vs-the-set under Competitors. "both" keeps legacy behavior. */
  section?: "presence" | "h2h" | "both"
}) {
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

  const me = useMemo(() => profiles.find((p) => p.entityType === "location") ?? null, [profiles])
  const comps = useMemo(() => profiles.filter((p) => p.entityType === "competitor"), [profiles])

  // ── ALT-270: one standing per ACCOUNT, not per profile row. A competitor we read on
  //    both Instagram and Facebook is two `profiles` but one account, so followers sum
  //    across their tracked networks and engagement is the mean of their profiles. The
  //    tracked networks ride along on each row, because summing means an account we read
  //    on more networks looks bigger, and the operator should be able to see that. ──
  const standings = useMemo(() => {
    const byAccount = new Map<
      string,
      { name: string; isYou: boolean; followers: number; rates: number[]; platforms: string[] }
    >()
    for (const p of profiles) {
      const key = `${p.entityType}:${p.entityName}`
      const row =
        byAccount.get(key) ??
        {
          name: p.entityName,
          isYou: p.entityType === "location",
          followers: 0,
          rates: [] as number[],
          platforms: [] as string[],
        }
      row.followers += p.followerCount
      if (p.engagementRate > 0) row.rates.push(p.engagementRate)
      if (!row.platforms.includes(p.platform)) row.platforms.push(p.platform)
      byAccount.set(key, row)
    }
    return [...byAccount.entries()].map(([key, r]) => ({
      key,
      name: r.name,
      isYou: r.isYou,
      followers: r.followers,
      engagement: r.rates.length ? r.rates.reduce((s, v) => s + v, 0) / r.rates.length : 0,
      platforms: r.platforms.filter((p) => PLATFORM_LABEL[p]).sort(),
    }))
  }, [profiles])

  // Each ladder ranks only accounts we actually have a reading for on that signal: a 0
  // usually means "not read yet", not "zero followers", and ranking an account last on
  // missing data would be a claim we cannot support. The unread ones are counted in the
  // note instead, so the row count is never quietly short.
  const ladders = useMemo(() => {
    const build = (
      key: string,
      title: string,
      value: (s: (typeof standings)[number]) => number,
      display: (n: number) => string,
      unit: string,
      note: string,
    ) => {
      const rated = standings.filter((s) => value(s) > 0).sort((a, b) => value(b) - value(a))
      if (rated.length < 2) return null
      const max = value(rated[0])
      const yourIndex = rated.findIndex((s) => s.isYou)
      return {
        key,
        title,
        rows: rated.map((s) => ({
          key: s.key,
          name: s.name,
          isYou: s.isYou,
          platforms: s.platforms,
          width: Math.max(3, Math.round((value(s) / max) * 100)),
          display: display(value(s)),
        })),
        verdict:
          yourIndex >= 0
            ? `You rank ${ordinal(yourIndex + 1)} of ${rated.length} on ${unit}.`
            : `We have no ${unit} reading for your own account yet.`,
        note:
          standings.length > rated.length
            ? `${note} ${standings.length - rated.length} tracked account${standings.length - rated.length === 1 ? " has" : "s have"} no reading yet.`
            : note,
      }
    }

    return [
      build(
        "audience",
        "Audience size",
        (s) => s.followers,
        formatNumber,
        "audience size",
        "Followers, summed across the networks we track for each account.",
      ),
      build(
        "engagement",
        "Engagement / post",
        (s) => s.engagement,
        (n) => `${n.toFixed(1)}%`,
        "engagement per post",
        "Average interactions per post divided by followers, not how often an account posts.",
      ),
    ].filter((l): l is NonNullable<typeof l> => l !== null)
  }, [standings])

  if (profiles.length === 0) return null

  const showPresence = section !== "h2h"
  const showH2H = section !== "presence"

  return (
    <div className="sp-standing">
      {/* Network coverage — where you stand, per network (ALT-202c).
          Small network glyphs + an honest "you + N competitors" read. */}
      {showPresence && (
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
                      You + 0 · {p.competitorCount} competitor{p.competitorCount !== 1 ? "s" : ""} here
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
      )}

      {/* ── ALT-270: the standing ladder — every tracked account, your own highlighted ── */}
      {showH2H && (ladders.length > 0 ? (
        <RevealOnView className="sp-ladders" stagger>
          {ladders.map((l, li) => (
            <div key={l.key} style={{ "--tk-i": li } as CSSProperties}>
              <TkSoftPanel className="sp-ladder">
                <div className="sp-ladder-head">
                  <h4>{l.title}</h4>
                  <TkConfidence level="directional" showLabel={false} className="sp-h2h-conf" />
                </div>
                <p className="sp-ladder-verdict">{l.verdict}</p>
                <ol className="sp-ladder-rows">
                  {l.rows.map((r, i) => (
                    <li key={r.key} className={tkcx("sp-lrow", r.isYou && "sp-lrow-you")}>
                      <span className="sp-lrank">{i + 1}</span>
                      <span className="sp-lname">
                        {r.isYou ? "You" : r.name}
                        {r.platforms.length ? (
                          <span className="sp-lplats">
                            {r.platforms.map((p) => PLATFORM_LABEL[p]).join(" · ")}
                          </span>
                        ) : null}
                      </span>
                      <span className="sp-lbar" aria-hidden="true">
                        <i style={{ width: `${r.width}%` }} />
                      </span>
                      <span className="sp-lval">{r.display}</span>
                    </li>
                  ))}
                </ol>
                <p className="sp-ladder-note">{l.note}</p>
              </TkSoftPanel>
            </div>
          ))}
        </RevealOnView>
      ) : me && comps.length === 0 ? (
        <TkSoftPanel className="sp-h2h-empty">
          <TkChip family="social">Just you so far</TkChip>
          <p>
            Add the competitors you want to measure against on{" "}
            <Link href="/competitors">Competitors</Link>, and we&apos;ll line up followers and
            engagement side by side once we&apos;re watching their accounts.
          </p>
        </TkSoftPanel>
      ) : (
        // ALT-270: accounts are tracked but fewer than two have a reading on either
        // signal, so there is nothing we can rank yet. Say that plainly instead of
        // rendering an empty gap or a comparison against a missing number.
        <TkSoftPanel className="sp-h2h-empty">
          <TkChip family="social">Still reading their accounts</TkChip>
          <p>
            We&apos;re watching {comps.length} competitor account
            {comps.length === 1 ? "" : "s"} here but don&apos;t have enough follower or engagement
            readings yet to rank anyone. This fills in as their posts come through.
          </p>
        </TkSoftPanel>
      ))}
    </div>
  )
}
