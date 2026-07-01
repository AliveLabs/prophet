import { RevealOnView } from "@/components/ticket"
import type { SourceQualityFlag, SourceAggregate } from "@/lib/skills/source-quality"
import { FlagQueueList } from "./flag-queue-list"

// Read-only presentation for the Source Quality review queue. No client state of its own —
// purely renders the normalized flags + the by-source rollup the server page computed.
// RevealOnView is a client kit component rendered from this server component (RSC-safe: we
// render it, we don't call it). The one stateful piece — the open/resolved filter + the
// per-flag "Mark resolved"/"Reopen" buttons (ALT-246) — lives in the FlagQueueList client
// island so this file stays the read-only surface the ALT-172 isolation guard checks.

export function SourceQualityQueue({
  flags,
  aggregates,
  windowDays,
  canManage,
}: {
  flags: SourceQualityFlag[]
  aggregates: SourceAggregate[]
  windowDays: number
  canManage: boolean
}) {
  const total = flags.length
  const briefCount = flags.filter((f) => f.kind === "brief_play").length
  const insightCount = total - briefCount
  const maxCount = aggregates[0]?.count ?? 0

  return (
    <div className="sq-surface">
      <RevealOnView as="header" className="sq-head">
        <span className="sq-eyebrow">
          <span className="sq-pulse" aria-hidden />
          Data quality · source review
        </span>
        <h1>Source Quality</h1>
        <p className="sq-lede">
          When an operator flags a brief play or an insight as &ldquo;this looks wrong,&rdquo; it lands here —
          not in the recommendation model. These are reports of bad source data to go check (a wrong listing,
          stale hours, a mislabeled place), from the last {windowDays} days, grouped so a repeatedly-flagged
          source stands out.
        </p>
      </RevealOnView>

      <RevealOnView className="sq-stats" stagger>
        <Stat label="Flags" value={total} accent />
        <Stat label="From briefs" value={briefCount} />
        <Stat label="From insights" value={insightCount} />
        <Stat label="Sources flagged" value={aggregates.length} />
      </RevealOnView>

      {total === 0 ? (
        <RevealOnView className="sq-empty">
          <p>No source-quality flags in the last {windowDays} days.</p>
          <p className="sq-empty-sub">
            When an operator marks a play or insight &ldquo;this looks wrong,&rdquo; it&rsquo;ll appear here to
            review against the third-party source.
          </p>
        </RevealOnView>
      ) : (
        <>
          <RevealOnView as="section" className="sq-section">
            <h2 className="sq-h2">Flagged sources</h2>
            <p className="sq-sub">Grouped by source. The most-flagged sit at the top — start there.</p>
            <ul className="sq-rollup">
              {aggregates.map((a) => (
                <li key={a.family} className="sq-rollup-row">
                  <span className="sq-rollup-fam">{a.family}</span>
                  <div className="sq-rollup-meter" aria-hidden>
                    <span
                      className="sq-rollup-fill"
                      style={{ "--w": `${maxCount > 0 ? Math.round((a.count / maxCount) * 100) : 0}%` } as React.CSSProperties}
                    />
                  </div>
                  <span className="sq-rollup-count">{a.count}</span>
                  <span className="sq-rollup-kinds">
                    {a.briefCount} brief · {a.insightCount} insight
                  </span>
                </li>
              ))}
            </ul>
          </RevealOnView>

          <RevealOnView as="section" className="sq-section">
            <h2 className="sq-h2">Every flag</h2>
            <FlagQueueList flags={flags} canManage={canManage} />
          </RevealOnView>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`sq-stat${accent ? " sq-stat-accent" : ""}`}>
      <div className="sq-k">{label}</div>
      <div className="sq-v">{value}</div>
    </div>
  )
}
