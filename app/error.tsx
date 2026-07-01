"use client"

import { useState } from "react"
import "./chrome.css"
import { ReportIssueLink } from "@/components/ticket/report-issue-link"

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [reportState, setReportState] = useState<"idle" | "sending" | "sent" | "failed">("idle")

  return (
    <main className="ticket-chrome">
      <div className="chrome-card">
        <span className="chrome-kicker">Something broke</span>
        <h1 className="chrome-h">That didn&apos;t <em>go through</em>.</h1>
        <p className="chrome-sub">A hiccup on our end, not yours. Try again — and if it keeps happening, we&apos;re on it.</p>
        <div className="chrome-actions">
          <button className="chrome-btn" onClick={() => reset()}>Try again</button>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- error boundary: force a full reload to recover from a corrupted React tree */}
          <a className="chrome-btn chrome-btn--ghost" href="/home">Back to your brief</a>
        </div>
        {error?.digest ? <p className="chrome-foot">Reference · {error.digest}</p> : null}
        <ReportIssueLink error={error} state={reportState} onStateChange={setReportState} />
      </div>
    </main>
  )
}
