// The two market-pulse blocks on /home (beta rescue Phase 3.2): "You vs your market" and
// "What changed near you".
//
// Server component, presentational only. Every decision — whether there is enough data, which
// rows count as a change, how a line is worded — was already made by the pure modules behind
// `loadMarketPulse`. Nothing here computes, and nothing here costs a model call.
//
// These are NOT insights, so they do not use the unified insight card and the copy does not
// call them insights. They are the section idiom the brief already uses: a <TkSectionHead/>
// over a <TkCard/>, with the row treatment the "what we checked" coverage list established.
//
// Each block self-hides independently. An empty changelog means nothing changed that we can
// name, and the honest render for that is nothing at all — never a padded list, never a line
// saying we looked. The list is capped and hands off to /insights rather than growing into a
// second uncapped feed.

import Link from "next/link"
import { RevealOnView, TkCard, TkSectionHead, TkCompetitorLink } from "@/components/ticket"
import { formatBenchmarkLine, MIN_REVIEWS_FOR_COMPARISON } from "@/lib/insights/market-benchmark"
import { CHANGELOG_WINDOW_DAYS } from "@/lib/insights/market-changes"
import type { MarketPulse } from "@/lib/insights/market-pulse"

function fmtDay(dateKey: string): string {
  const d = new Date(`${dateKey.slice(0, 10)}T12:00:00`)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export default function MarketPulseSection({ pulse }: { pulse: MarketPulse | null }) {
  if (!pulse) return null
  const { benchmark, changes } = pulse
  if (!benchmark && changes.length === 0) return null

  return (
    <>
      {benchmark ? (
        <>
          <TkSectionHead
            title="You vs your market"
            sub="Listing ratings across your tracked set"
            className="pass-sec"
          />
          <RevealOnView>
            <TkCard className="pass-bench-card">
              <p className="pass-bench">{formatBenchmarkLine(benchmark)}</p>
              <p className="pass-bench-foot">
                A median, not a ranking. Locations with fewer than {MIN_REVIEWS_FOR_COMPARISON} reviews
                are left out on both sides, so a thin rating cannot move the middle.
              </p>
            </TkCard>
          </RevealOnView>
        </>
      ) : null}

      {changes.length ? (
        <>
          <TkSectionHead
            title="What changed near you"
            sub={`Last ${CHANGELOG_WINDOW_DAYS} days · your tracked set`}
            className="pass-sec"
          />
          <RevealOnView>
            <TkCard className="pass-changes-card">
              <ul className="pass-changes">
                {changes.map((c) => (
                  <li key={c.id} className="pass-change">
                    <div className="pass-change-top">
                      <span className="pass-change-who">
                        <TkCompetitorLink id={c.competitorId} name={c.competitorName} />
                      </span>
                      <span className="pass-change-when">{fmtDay(c.dateKey)}</span>
                    </div>
                    <span className="pass-change-what">{c.what}</span>
                  </li>
                ))}
              </ul>
              <Link className="pass-pool-link" href="/insights">
                Open your insights &rarr;
              </Link>
            </TkCard>
          </RevealOnView>
        </>
      ) : null}
    </>
  )
}
