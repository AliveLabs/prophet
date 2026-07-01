"use client"

// ALT-246 — client island for the Source Quality queue's flag list: the open/resolved status
// filter (defaults to "open" so the queue reads as "what's left to triage") + the per-flag
// "Mark resolved"/"Reopen" buttons. The rest of the page (header, stats, by-source rollup)
// stays a read-only server component — this is the one stateful piece, mirroring
// knowledge-review-table.tsx's client-side kind filter.

import { useMemo, useState } from "react"
import { filterByReviewStatus, type SourceQualityFlag } from "@/lib/skills/source-quality"
import { FlagReviewActions } from "./flag-review-actions"

const whenFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })
function formatWhen(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : whenFmt.format(d)
}

type StatusFilter = "open" | "resolved" | "all"

export function FlagQueueList({ flags, canManage }: { flags: SourceQualityFlag[]; canManage: boolean }) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open")
  const filtered = useMemo(() => filterByReviewStatus(flags, statusFilter), [flags, statusFilter])

  return (
    <div>
      <div className="sq-toolbar">
        <label className="sr-only" htmlFor="sq-status">
          Filter by triage status
        </label>
        <select
          id="sq-status"
          className="sq-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
        >
          <option value="open">Open (needs triage)</option>
          <option value="resolved">Resolved</option>
          <option value="all">All</option>
        </select>
        <span className="sq-count">
          {filtered.length} of {flags.length} {flags.length === 1 ? "flag" : "flags"}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="sq-sub" style={{ marginTop: 14 }}>
          {statusFilter === "open" ? "Nothing open — everything is triaged." : "No flags match this filter."}
        </p>
      ) : (
        <ul className="sq-list" style={{ marginTop: 14 }}>
          {filtered.map((f) => (
            <FlagCard key={f.id} flag={f} canManage={canManage} />
          ))}
        </ul>
      )}
    </div>
  )
}

function FlagCard({ flag, canManage }: { flag: SourceQualityFlag; canManage: boolean }) {
  const kindLabel = flag.kind === "brief_play" ? "Brief play" : "Insight"
  const sourceNoun = flag.kind === "brief_play" ? "play" : "insight"
  return (
    <li className="sq-card">
      <div className="sq-card-top">
        <span className={`sq-kind sq-kind--${flag.kind}`}>{kindLabel}</span>
        <span className="sq-fam">{flag.sourceFamily}</span>
        <span className={`sq-status sq-status--${flag.reviewedStatus}`}>
          <span className="sq-dot" aria-hidden />
          {flag.reviewedStatus}
        </span>
        {flag.flaggedAt && (
          <time className="sq-when" dateTime={flag.flaggedAt}>
            {formatWhen(flag.flaggedAt)}
          </time>
        )}
      </div>

      <h3 className="sq-title">{flag.title}</h3>
      <div className="sq-loc">
        {flag.locationName}
        {flag.orgName ? <span className="sq-org"> · {flag.orgName}</span> : null}
      </div>

      {flag.note ? <blockquote className="sq-note">{flag.note}</blockquote> : null}
      {flag.summary ? <p className="sq-summary">{flag.summary}</p> : null}

      {flag.sources.length > 0 ? (
        <div className="sq-sources">
          <span className="sq-sources-label">Sources in this {sourceNoun}</span>
          <ul className="sq-chips">
            {flag.sources.map((s) => (
              <li key={s} className="sq-chip">
                {s}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {canManage ? (
        <FlagReviewActions flagRef={flag.id} reviewedStatus={flag.reviewedStatus} />
      ) : (
        <p className="sq-readonly">Read-only · triage is restricted to admins.</p>
      )}
    </li>
  )
}
