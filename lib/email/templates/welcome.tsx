import { Section, Text, Link } from "@react-email/components"
import { EmailLayout, emailStyles } from "./layout"

interface VerticalEmailCopy {
  subject: string
  headline: string
  intro: string
  tipHeader: string
  tipBody: string
}

interface WelcomeProps {
  /** ALT-675: null when we have no full name on file. Never the email handle, which is
   *  what this used to fall back to ("Welcome to Ticket, chrishershberger."). Same rule
   *  PR #231 established for the first-brief subject. */
  userName: string | null
  locationName: string
  competitorCount: number
  dashboardUrl: string
  verticalCopy?: VerticalEmailCopy
}

export function Welcome({
  userName,
  locationName,
  competitorCount,
  dashboardUrl,
  verticalCopy,
}: WelcomeProps) {
  const previewText = verticalCopy?.subject ?? "Welcome to Ticket: your feed is live"
  const tipText = verticalCopy?.tipBody ?? "Bookmark your dashboard so you can check it between the lunch and dinner rush."

  return (
    <EmailLayout preview={previewText}>
      <Section>
        <Text style={emailStyles.heading}>
          {userName ? `Welcome to Ticket, ${userName}.` : "Welcome to Ticket."}
        </Text>
        <Text style={emailStyles.paragraph}>
          Your competitive intelligence is now live. Here&rsquo;s a quick recap
          of what we set up:
        </Text>

        <Section style={emailStyles.infoBox}>
          <Text style={emailStyles.infoItem}>
            <strong style={emailStyles.strongText}>Location:</strong>{" "}
            {locationName}
          </Text>
          <Text style={emailStyles.infoItem}>
            <strong style={emailStyles.strongText}>Competitors tracked:</strong>{" "}
            {competitorCount}
          </Text>
          <Text style={emailStyles.infoItem}>
            <strong style={emailStyles.strongText}>Monitoring:</strong> Active
          </Text>
        </Section>

        <Text style={emailStyles.heading2}>What happens now?</Text>
        <Text style={emailStyles.paragraph}>
          {/* ALT-730: this promised "your first weekly intelligence briefing: the 5 most
              important things" in the FIRST email a customer receives. The weekly digest exists but
              its sends are gated OFF by WEEKLY_DIGEST_EMAILS_ENABLED, which is not set in
              production, so no digest has ever gone out and the specific "5 most important things"
              is not a shape anything produces. Promising it in the welcome email meant every new
              operator was told to expect something that would never arrive.
              Replaced with what actually happens. */}
          Ticket is already collecting data on your competitors. Within 24 hours
          you&rsquo;ll see your first brief, and a fresh one lands on your
          dashboard on your plan&rsquo;s schedule from then on.
        </Text>

        <Section style={emailStyles.ctaContainer}>
          <Link href={dashboardUrl} style={emailStyles.ctaButton}>
            Go to your dashboard
          </Link>
        </Section>

        <Text style={emailStyles.footnote}>
          Tip: {tipText}
        </Text>

        <Text style={emailStyles.signoff}>The Ticket Team</Text>
      </Section>
    </EmailLayout>
  )
}
