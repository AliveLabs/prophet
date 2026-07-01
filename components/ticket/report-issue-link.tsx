"use client"

// ALT-243: "Report this" control for the route error boundaries (app/error.tsx, app/global-error.tsx).
// Primary path: POST /api/error-report (server enriches with user/org from the session). Fallback:
// a prefilled mailto: link to the team, shown once the POST fails so the reference/URL/timestamp
// still reach someone even if the API call itself is broken.

import {
  buildErrorReportPayload,
  buildMailtoHref,
  submitErrorReport,
  type ReportOutcome,
} from "@/lib/error-report/client"

export type ReportState = "idle" | "sending" | "sent" | "failed"

interface ReportIssueLinkProps {
  error: { digest?: string; message?: string }
  state: ReportState
  onStateChange: (state: ReportState) => void
}

export function ReportIssueLink({ error, state, onStateChange }: ReportIssueLinkProps) {
  const href = typeof window !== "undefined" ? window.location.href : ""
  const payload = buildErrorReportPayload(error, href)
  const mailtoHref = buildMailtoHref(payload)

  async function handleReport() {
    onStateChange("sending")
    const outcome: ReportOutcome = await submitErrorReport(payload)
    onStateChange(outcome === "sent" ? "sent" : "failed")
  }

  if (state === "sent") {
    return <p className="chrome-report-status">Thanks — the report went through.</p>
  }

  return (
    <div className="chrome-report">
      <button
        type="button"
        className="chrome-report-link"
        onClick={handleReport}
        disabled={state === "sending"}
      >
        {state === "sending" ? "Sending report…" : "Report this"}
      </button>
      {state === "failed" ? (
        <p className="chrome-report-status">
          Couldn&apos;t send that automatically.{" "}
          <a className="chrome-link" href={mailtoHref}>
            Email us the details instead
          </a>
          .
        </p>
      ) : null}
    </div>
  )
}
