// ALT-243: shared client-side logic for the route error boundaries (app/error.tsx,
// app/global-error.tsx). Pure/testable on purpose — the boundary components just wire this up to a
// button. Primary path: POST to /api/error-report (server enriches with user/org from the session).
// Fallback: a prefilled mailto: link, used when the POST fails or as a simpler always-available
// alternative next to the button while the POST is in flight / unsupported (e.g. no JS fetch).

// Reuse the same ops distribution convention as the server-side default (lib/ops + the
// vendor-health cron) so the mailto fallback lands in the same inboxes as the POST path.
export const ERROR_REPORT_FALLBACK_EMAIL = "support@getticket.ai"

export interface ErrorReportPayload {
  digest?: string
  url: string
  timestamp: string
  message?: string
}

/** Build the POST body from an error boundary's `error` object and the current location. */
export function buildErrorReportPayload(
  error: { digest?: string; message?: string },
  href: string,
  now: Date = new Date()
): ErrorReportPayload {
  return {
    digest: error.digest,
    url: href,
    timestamp: now.toISOString(),
    message: error.message || undefined,
  }
}

/** Build the mailto: fallback link — subject `Error ref {digest}` plus a plain-text body with the
 *  reference, URL, and timestamp so the team has enough to triage even without the POST landing. */
export function buildMailtoHref(payload: ErrorReportPayload, to: string = ERROR_REPORT_FALLBACK_EMAIL): string {
  const subject = payload.digest ? `Error ref ${payload.digest}` : "Error report"
  const lines = [
    payload.digest ? `Reference: ${payload.digest}` : null,
    `URL: ${payload.url}`,
    `Time: ${payload.timestamp}`,
    payload.message ? `Message: ${payload.message}` : null,
    "",
    "What were you doing when this happened?",
  ].filter((l): l is string => l !== null)

  const params = new URLSearchParams({ subject, body: lines.join("\n") })
  // URLSearchParams encodes spaces as "+"; mailto: needs "%20".
  return `mailto:${to}?${params.toString().replace(/\+/g, "%20")}`
}

export type ReportOutcome = "sent" | "failed"

/** POST the report to /api/error-report. Never throws — network/parse errors are treated the same
 *  as an { ok:false } response so the caller can uniformly fall back to the mailto link. */
export async function submitErrorReport(payload: ErrorReportPayload): Promise<ReportOutcome> {
  try {
    const res = await fetch("/api/error-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return "failed"
    const body = (await res.json().catch(() => null)) as { ok?: boolean } | null
    return body?.ok ? "sent" : "failed"
  } catch {
    return "failed"
  }
}
