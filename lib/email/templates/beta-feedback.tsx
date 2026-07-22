import { Section, Text } from "@react-email/components"
import { EmailLayout, emailStyles } from "./layout"

interface BetaFeedbackEmailProps {
  message: string
  /** Quick tag the operator picked, if any (idea / issue / confusing / praise). */
  category?: string
  /** The route they were on when they sent it. */
  pagePath?: string
  /** Enriched server-side from the session — never trust a client-supplied value here. */
  userEmail?: string
  /** Enriched server-side from the user's org membership. */
  orgName?: string
}

/**
 * Internal OPS alert (clientFacing:false) — fires when a beta user submits feedback via the
 * left-nav "Share feedback" affordance (ALT-371). The row is the source of truth; this email
 * is a best-effort live ping so the beta-learning loop doesn't depend on polling the table.
 * user/org are enriched server-side from the session.
 */
export function BetaFeedbackEmail({
  message,
  category,
  pagePath,
  userEmail,
  orgName,
}: BetaFeedbackEmailProps) {
  return (
    <EmailLayout preview={`Beta feedback${orgName ? ` · ${orgName}` : ""}`}>
      <Section>
        <Text style={emailStyles.kicker}>OPS ALERT · BETA FEEDBACK</Text>
        <Text style={emailStyles.heading}>A beta user shared feedback</Text>

        <Section style={emailStyles.infoBox}>
          <Text style={emailStyles.infoItem}>
            <strong style={emailStyles.strongText}>Organization:</strong> {orgName ?? "Unavailable"}
          </Text>
          <Text style={emailStyles.infoItem}>
            <strong style={emailStyles.strongText}>User:</strong> {userEmail ?? "Unavailable"}
          </Text>
          {category ? (
            <Text style={emailStyles.infoItem}>
              <strong style={emailStyles.strongText}>Tag:</strong> {category}
            </Text>
          ) : null}
          {pagePath ? (
            <Text style={emailStyles.infoItem}>
              <strong style={emailStyles.strongText}>Page:</strong> {pagePath}
            </Text>
          ) : null}
        </Section>

        <Text style={emailStyles.infoItem}>
          <strong style={emailStyles.strongText}>Feedback:</strong>
        </Text>
        <Text style={emailStyles.infoItem}>{message}</Text>

        <Text style={emailStyles.signoff}>— Ticket beta</Text>
      </Section>
    </EmailLayout>
  )
}
