import { Section, Text } from "@react-email/components"
import { EmailLayout, emailStyles } from "./layout"

interface ErrorReportEmailProps {
  digest?: string
  url: string
  timestamp: string
  message?: string
  /** Enriched server-side from the session — never trust a client-supplied value here. */
  userEmail?: string
  /** Enriched server-side from the user's org membership. */
  orgName?: string
}

/**
 * Internal OPS alert (clientFacing:false) — fires when a customer hits the route error boundary
 * (app/error.tsx / app/global-error.tsx) and the client successfully POSTs to /api/error-report.
 * user/org fields are enriched server-side from the session, since a hard crash can't reliably
 * read that context client-side.
 */
export function ErrorReportEmail({
  digest,
  url,
  timestamp,
  message,
  userEmail,
  orgName,
}: ErrorReportEmailProps) {
  return (
    <EmailLayout preview={`Error report${digest ? ` · ${digest}` : ""}`}>
      <Section>
        <Text style={emailStyles.kicker}>OPS ALERT · ERROR REPORT</Text>
        <Text style={emailStyles.heading}>A customer hit the error page</Text>

        <Section style={emailStyles.infoBox}>
          {digest ? (
            <Text style={emailStyles.infoItem}>
              <strong style={emailStyles.strongText}>Reference:</strong> {digest}
            </Text>
          ) : null}
          <Text style={emailStyles.infoItem}>
            <strong style={emailStyles.strongText}>Page:</strong> {url}
          </Text>
          <Text style={emailStyles.infoItem}>
            <strong style={emailStyles.strongText}>Time:</strong> {timestamp}
          </Text>
          {message ? (
            <Text style={emailStyles.infoItem}>
              <strong style={emailStyles.strongText}>Message:</strong> {message}
            </Text>
          ) : null}
          <Text style={emailStyles.infoItem}>
            <strong style={emailStyles.strongText}>User:</strong> {userEmail ?? "Not signed in / unavailable"}
          </Text>
          <Text style={emailStyles.infoItem}>
            <strong style={emailStyles.strongText}>Organization:</strong> {orgName ?? "Unavailable"}
          </Text>
        </Section>

        <Text style={emailStyles.signoff}>— Ticket error monitor</Text>
      </Section>
    </EmailLayout>
  )
}
