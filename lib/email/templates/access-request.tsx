import { Section, Text, Link } from "@react-email/components"
import { EmailLayout, emailStyles } from "./layout"

interface AccessRequestProps {
  ownerName: string
  requesterName: string
  requesterEmail: string
  orgName: string
  teamUrl: string
  /** true for the day-4 reminder sent by the access-requests cron. */
  nudge?: boolean
}

/**
 * Sent to an org owner (and admins) when someone signs up for Ticket and picks a
 * restaurant that already lives under this org (duplicate-org prevention, beta rescue
 * phase 3.5). The same template covers the initial notice and the cron's reminder.
 * Granting happens through the existing Settings -> Team invite flow; nothing in this
 * email grants anything by itself.
 */
export function AccessRequest({
  ownerName,
  requesterName,
  requesterEmail,
  orgName,
  teamUrl,
  nudge = false,
}: AccessRequestProps) {
  const previewText = nudge
    ? `Reminder: ${requesterName} is waiting to join ${orgName} on Ticket`
    : `${requesterName} is asking to join ${orgName} on Ticket`

  return (
    <EmailLayout preview={previewText}>
      <Section>
        <Text style={emailStyles.heading}>
          {nudge
            ? `${requesterName} is still waiting to join ${orgName}.`
            : `${requesterName} wants to join ${orgName} on Ticket.`}
        </Text>
        <Text style={emailStyles.paragraph}>
          Hi {ownerName},{" "}
          {nudge
            ? "a few days ago someone from your team asked to join your Ticket account and they have not been added yet."
            : "someone just signed up for Ticket and picked your restaurant, which is already set up under your account."}
        </Text>

        <Section style={emailStyles.infoBox}>
          <Text style={emailStyles.infoItem}>
            <strong style={emailStyles.strongText}>Name:</strong> {requesterName}
          </Text>
          <Text style={emailStyles.infoItem}>
            <strong style={emailStyles.strongText}>Email:</strong> {requesterEmail}
          </Text>
          <Text style={emailStyles.infoItem}>
            <strong style={emailStyles.strongText}>Account:</strong> {orgName}
          </Text>
        </Section>

        <Text style={emailStyles.paragraph}>
          If they are on your team, add them from your Team settings and they will get
          access right away.
        </Text>

        <Section style={emailStyles.ctaContainer}>
          <Link href={teamUrl} style={emailStyles.ctaButton}>
            Open Team settings
          </Link>
        </Section>

        <Text style={emailStyles.footnote}>
          Don&rsquo;t recognize them? You can ignore this email. Nothing changes on your
          account unless you add them yourself.
        </Text>

        <Text style={emailStyles.signoff}>The Ticket Team</Text>
      </Section>
    </EmailLayout>
  )
}
